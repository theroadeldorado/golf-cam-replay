"""
Camera capture engine with person detection, network camera support,
and per-camera transforms (zoom, rotate, flip).

Includes a fallback MJPEG reader (MJPEGCapture) for macOS where
opencv-python from pip lacks FFMPEG HTTP streaming support.
"""

import logging
import os
import socket
import time
import threading
import urllib.request
import urllib.error
from typing import Optional, List, Dict, Any

import cv2
import numpy as np
from PyQt6.QtCore import QThread, pyqtSignal

# Tell FFMPEG to use TCP for RTSP (more reliable, less packet loss than UDP)
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

from config import AppConfig, CameraPreset

logger = logging.getLogger(__name__)


# ============================================================================
# Fallback MJPEG HTTP Reader
# ============================================================================

class MJPEGCapture:
    """HTTP MJPEG stream reader — fallback when OpenCV's VideoCapture
    can't open HTTP URLs (common on macOS pip installs).

    Provides a read() interface compatible with cv2.VideoCapture.
    """

    def __init__(self, url: str, timeout: float = 10.0):
        self._url = url
        self._timeout = timeout
        self._stream = None
        self._opened = False
        self._busy = False
        self._buffer = b""
        self._open()

    @property
    def busy(self) -> bool:
        """True if the camera server reported it's busy (e.g. DroidCam one-client limit)."""
        return self._busy

    def _open(self):
        try:
            req = urllib.request.Request(self._url)
            self._stream = urllib.request.urlopen(req, timeout=self._timeout)
            content_type = self._stream.headers.get("Content-Type", "unknown")
            logger.info("MJPEGCapture: opened %s (Content-Type: %s)", self._url, content_type)

            # DroidCam returns text/html with "Busy" page when another client is connected
            if "text/html" in content_type:
                body = self._stream.read(2048).decode("utf-8", errors="replace")
                if "busy" in body.lower():
                    logger.warning("MJPEGCapture: DroidCam is busy (another client connected) at %s", self._url)
                    self._busy = True
                else:
                    logger.debug("MJPEGCapture: got HTML instead of video from %s", self._url)
                self._stream.close()
                self._stream = None
                self._opened = False
                return

            self._opened = True
            self._busy = False
        except Exception as e:
            logger.debug("MJPEGCapture: failed to open %s: %s", self._url, e)
            self._opened = False
            self._busy = False

    def isOpened(self) -> bool:
        return self._opened

    def read(self):
        """Read one JPEG frame from the MJPEG stream.

        Returns (success, frame) like cv2.VideoCapture.read().
        """
        if not self._opened or self._stream is None:
            return False, None

        try:
            # Read chunks until we find a complete JPEG (SOI + EOI markers)
            total_read = 0
            while True:
                chunk = self._stream.read(4096)
                if not chunk:
                    logger.debug("MJPEGCapture: stream returned empty (read %d bytes total)", total_read)
                    return False, None
                total_read += len(chunk)
                self._buffer += chunk

                if total_read <= 4096:
                    # Log first chunk to understand content type
                    logger.debug("MJPEGCapture: first chunk (%d bytes), starts with: %s",
                                 len(chunk), chunk[:80])

                # Look for JPEG start (FFD8) and end (FFD9)
                soi = self._buffer.find(b"\xff\xd8")
                if soi == -1:
                    # No JPEG start yet, trim buffer
                    self._buffer = self._buffer[-2:]
                    continue

                eoi = self._buffer.find(b"\xff\xd9", soi + 2)
                if eoi == -1:
                    # Have start but no end yet, keep reading
                    # Limit buffer to 5MB to prevent memory runaway
                    if len(self._buffer) > 5 * 1024 * 1024:
                        logger.debug("MJPEGCapture: buffer overflow (5MB), no complete frame found")
                        self._buffer = b""
                    continue

                # Extract the complete JPEG
                jpeg_data = self._buffer[soi:eoi + 2]
                self._buffer = self._buffer[eoi + 2:]

                # Decode JPEG to numpy array
                arr = np.frombuffer(jpeg_data, dtype=np.uint8)
                frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if frame is not None:
                    return True, frame

                # Corrupt JPEG, try next frame
                logger.debug("MJPEGCapture: corrupt JPEG frame (%d bytes), skipping", len(jpeg_data))

        except (urllib.error.URLError, OSError, ConnectionError) as e:
            logger.debug("MJPEGCapture: stream read error: %s", e)
            self._opened = False
            return False, None
        except Exception as e:
            logger.debug("MJPEGCapture: unexpected error: %s", e)
            self._opened = False
            return False, None

    def set(self, prop_id, value):
        """No-op for compatibility with cv2.VideoCapture.set()."""
        pass

    def release(self):
        if self._stream:
            try:
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        self._opened = False
        self._buffer = b""


# ============================================================================
# Camera Capture Thread
# ============================================================================

class CameraCapture(QThread):
    """Thread for capturing video from a USB or network camera."""

    frame_ready = pyqtSignal(object, np.ndarray, float)  # camera_id (int or str), frame, timestamp
    fps_update = pyqtSignal(object, float)  # camera_id, measured fps
    connection_state = pyqtSignal(object, str)  # camera_id, "connecting"|"connected"|"disconnected"

    def __init__(self, camera_id, fps: int = 30, preset: Optional[CameraPreset] = None):
        super().__init__()
        self.camera_id = camera_id
        self.fps = fps
        self.preset = preset or CameraPreset(id=camera_id)
        self.running = False
        self.cap = None

        self._lock = threading.Lock()
        self._zoom = self.preset.zoom
        self._rotation = self.preset.rotation
        self._flip_h = self.preset.flip_h
        self._flip_v = self.preset.flip_v

    # --- Transform setters (thread-safe) ---

    def set_zoom(self, zoom: float):
        with self._lock:
            self._zoom = max(1.0, min(4.0, zoom))

    def set_rotation(self, degrees: int):
        with self._lock:
            self._rotation = degrees % 360

    def set_flip_h(self, flip: bool):
        with self._lock:
            self._flip_h = flip

    def set_flip_v(self, flip: bool):
        with self._lock:
            self._flip_v = flip

    def run(self):
        self.running = True
        is_network = isinstance(self.camera_id, str)

        logger.info("Camera thread starting for %s (network=%s)", self.camera_id, is_network)

        if is_network:
            self.connection_state.emit(self.camera_id, "connecting")
            # Brief pause for DroidCam — it needs time to release the previous
            # client session (e.g. from the connection test) before accepting
            # a new one.  Only applies to known DroidCam port.
            if ":4747/" in str(self.camera_id):
                time.sleep(1.0)
            self.cap = self._open_network_camera(self.camera_id)
        else:
            self.cap = self._open_usb_camera(self.camera_id)

        if self.cap is None or not self.cap.isOpened():
            logger.error("Failed to open camera %s", self.camera_id)
            if is_network:
                self._reconnect_loop()
            return

        self.connection_state.emit(self.camera_id, "connected")
        logger.info("Camera %s opened successfully", self.camera_id)

        if not is_network:
            # Try to set preferred resolution/fps. If it fails (some MSMF
            # cameras crash on stream reconfiguration), just use the default
            # resolution the camera already opened with.
            try:
                self.cap.set(cv2.CAP_PROP_FPS, self.fps)
                # Only attempt resolution change if camera supports it
                cur_w = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
                cur_h = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
                if cur_w < 1280 or cur_h < 720:
                    logger.info("Camera %s: native %dx%d, keeping default resolution",
                                self.camera_id, int(cur_w), int(cur_h))
                else:
                    logger.info("Camera %s: native %dx%d", self.camera_id, int(cur_w), int(cur_h))
            except Exception as e:
                logger.debug("Camera %s: failed to set properties: %s", self.camera_id, e)

        # Log first frame attempt
        ret, frame = self.cap.read()
        if ret:
            brightness = float(np.mean(frame))
            logger.info("Camera %s: first frame OK (%dx%d, brightness=%.1f)",
                        self.camera_id, frame.shape[1], frame.shape[0], brightness)
            if brightness < 5.0:
                logger.warning("Camera %s: frame is nearly black — may be a virtual camera", self.camera_id)
            frame = self._apply_transforms(frame)
            self.frame_ready.emit(self.camera_id, frame, time.time())
        else:
            logger.warning("Camera %s: first frame read FAILED", self.camera_id)

        frame_interval = 1.0 / self.fps
        consecutive_failures = 0
        total_frames = 1 if ret else 0

        # FPS tracking
        fps_interval_start = time.time()
        fps_frame_count = 0
        fps_log_interval = 5.0  # log FPS every 5 seconds
        self._current_fps = 0.0

        try:
            while self.running:
                start_time = time.time()

                # read() blocks until a frame arrives (network) or is captured (USB).
                # With CAP_PROP_BUFFERSIZE=1 on network cameras, OpenCV only keeps
                # the latest frame so we always get near-live video.
                ret, frame = self.cap.read()
                timestamp = time.time()

                if ret and frame is not None:
                    consecutive_failures = 0
                    total_frames += 1
                    fps_frame_count += 1
                    frame = self._apply_transforms(frame)
                    self.frame_ready.emit(self.camera_id, frame, timestamp)
                else:
                    consecutive_failures += 1
                    if consecutive_failures == 1:
                        logger.debug("Camera %s: frame read failed (consecutive: %d)", self.camera_id, consecutive_failures)
                    if is_network and consecutive_failures > 30:
                        logger.warning("Camera %s: %d consecutive failures, reconnecting...", self.camera_id, consecutive_failures)
                        self.connection_state.emit(self.camera_id, "disconnected")
                        self.cap.release()
                        self._reconnect_loop()
                        if not self.running:
                            return
                        if self.cap is None or not self.cap.isOpened():
                            logger.error("Camera %s: reconnect failed, exiting thread", self.camera_id)
                            return
                        self.connection_state.emit(self.camera_id, "connected")
                        consecutive_failures = 0
                        total_frames = 0
                        fps_frame_count = 0
                        fps_interval_start = time.time()
                    elif not is_network and consecutive_failures > 30:
                        logger.warning("USB camera %s: %d consecutive failures, attempting reconnect...", self.camera_id, consecutive_failures)
                        self.connection_state.emit(self.camera_id, "disconnected")
                        self.cap.release()
                        self._reconnect_usb()
                        if not self.running:
                            return
                        if self.cap is None or not self.cap.isOpened():
                            logger.error("USB camera %s: reconnect failed, exiting thread", self.camera_id)
                            return
                        self.connection_state.emit(self.camera_id, "connected")
                        consecutive_failures = 0
                        total_frames = 0
                        fps_frame_count = 0
                        fps_interval_start = time.time()
                    elif is_network:
                        # Small sleep on failure to avoid tight-looping
                        time.sleep(0.05)
                    else:
                        # USB failure below threshold — sleep to prevent busy-loop
                        time.sleep(0.1)

                # FPS calculation and logging
                now = time.time()
                elapsed_since_fps_log = now - fps_interval_start
                if elapsed_since_fps_log >= fps_log_interval:
                    self._current_fps = fps_frame_count / elapsed_since_fps_log
                    logger.info("Camera %s: %.1f FPS (frames: %d)", self.camera_id, self._current_fps, total_frames)
                    self.fps_update.emit(self.camera_id, self._current_fps)
                    fps_frame_count = 0
                    fps_interval_start = now

                # Throttle USB cameras to target FPS; network streams are
                # naturally paced by read() blocking on the next frame
                if not is_network:
                    elapsed = time.time() - start_time
                    sleep_time = frame_interval - elapsed
                    if sleep_time > 0:
                        time.sleep(sleep_time)
        except Exception as e:
            logger.exception("Camera %s thread crashed: %s", self.camera_id, e)
        finally:
            if self.cap:
                self.cap.release()
            logger.info("Camera %s stopped (%d frames)", self.camera_id, total_frames)

    def _open_usb_camera(self, camera_id):
        """Try multiple backends to open a USB camera.

        On Windows: tries DirectShow, MSMF, then default.
        On macOS/Linux: skips Windows-only backends, uses default (AVFoundation/V4L2).
        """
        import sys
        if sys.platform == "win32":
            backends = [("DSHOW", cv2.CAP_DSHOW), ("MSMF", cv2.CAP_MSMF), ("default", cv2.CAP_ANY)]
        else:
            backends = [("default", cv2.CAP_ANY)]

        for backend_name, backend in backends:
            logger.debug("Camera %s: trying %s backend...", camera_id, backend_name)
            cap = cv2.VideoCapture(camera_id, backend)
            ret = False
            try:
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        logger.info("Camera %s: opened with %s", camera_id, backend_name)
                        return cap
                    logger.debug("Camera %s: %s opened but read() failed", camera_id, backend_name)
                else:
                    logger.debug("Camera %s: %s backend isOpened()=False", camera_id, backend_name)
            except Exception as e:
                logger.debug("Camera %s: %s backend exception: %s", camera_id, backend_name, e)
            finally:
                if not ret:
                    cap.release()

        logger.error("Camera %s: no working backend found", camera_id)
        return None

    def _open_network_camera(self, url):
        """Try to open a network camera (MJPEG, RTSP, or any URL OpenCV supports).

        Uses FFMPEG backend first to avoid AVFoundation conflicts with USB cameras on macOS.
        Falls back to MJPEGCapture for HTTP URLs when OpenCV backends fail.
        """
        # TCP-only reachability check — avoids opening a full HTTP stream which
        # would occupy DroidCam's single-client slot and race with the real
        # OpenCV connection that follows.
        if url.startswith("http"):
            if not _tcp_reachable(url):
                logger.info("Network camera %s: not reachable", url)
                return None

        # FFMPEG first — avoids AVFoundation probing HTTP URLs which can
        # deadlock or timeout when a USB camera already holds the session.
        for backend_name, backend in [("FFMPEG", cv2.CAP_FFMPEG), ("default", cv2.CAP_ANY)]:
            logger.debug("Network camera %s: trying %s backend...", url, backend_name)
            cap = cv2.VideoCapture(url, backend)
            ret = False
            try:
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    # Set read timeout to 5 seconds to avoid infinite blocking
                    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                    ret, _ = cap.read()
                    if ret:
                        logger.info("Network camera opened (%s backend): %s", backend_name, url)
                        return cap
                    logger.debug("Network camera %s: %s opened but read() returned False", url, backend_name)
                else:
                    logger.debug("Network camera %s: %s backend isOpened()=False", url, backend_name)
            except Exception as e:
                logger.debug("Network camera %s: %s backend exception: %s", url, backend_name, e)
            finally:
                if not ret:
                    cap.release()

        # Fallback: use our custom MJPEG reader for HTTP URLs
        # (opencv-python on macOS often lacks FFMPEG HTTP streaming)
        if url.startswith("http://") or url.startswith("https://"):
            logger.info("Network camera %s: OpenCV backends failed, trying MJPEGCapture fallback...", url)
            cap = MJPEGCapture(url, timeout=5.0)
            if cap.busy:
                logger.warning("Network camera %s: camera is busy (close other clients first)", url)
                return None
            if cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None:
                    logger.info("Network camera opened (MJPEGCapture fallback): %s", url)
                    return cap
                logger.debug("Network camera %s: MJPEGCapture opened but read() failed", url)
            cap.release()

        logger.error("Network camera %s: could not open with any backend", url)
        return None

    def _reconnect_loop(self):
        """Try to reconnect to a network camera with backoff."""
        backoff = 1.0
        attempts = 0
        while self.running:
            attempts += 1
            self.connection_state.emit(self.camera_id, "connecting")
            logger.info("Reconnect attempt #%d to %s (waiting %.0fs)...", attempts, self.camera_id, backoff)
            time.sleep(backoff)
            if not self.running:
                return
            self.cap = self._open_network_camera(self.camera_id)
            if self.cap is not None and self.cap.isOpened():
                logger.info("Reconnected to %s", self.camera_id)
                return
            backoff = min(backoff * 2, 30.0)

    def _reconnect_usb(self):
        """Try to reconnect to a USB camera with exponential backoff."""
        backoff = 1.0
        attempts = 0
        while self.running:
            attempts += 1
            self.connection_state.emit(self.camera_id, "connecting")
            logger.info("USB reconnect attempt #%d for camera %s (waiting %.0fs)...", attempts, self.camera_id, backoff)
            time.sleep(backoff)
            if not self.running:
                return
            self.cap = self._open_usb_camera(self.camera_id)
            if self.cap is not None and self.cap.isOpened():
                logger.info("USB camera %s reconnected", self.camera_id)
                return
            backoff = min(backoff * 2, 30.0)

    def _apply_transforms(self, frame: np.ndarray) -> np.ndarray:
        """Apply zoom, rotation, and flip transforms."""
        with self._lock:
            zoom = self._zoom
            rotation = self._rotation
            flip_h = self._flip_h
            flip_v = self._flip_v

        # Zoom (center crop)
        if zoom > 1.0:
            h, w = frame.shape[:2]
            crop_w = int(w / zoom)
            crop_h = int(h / zoom)
            x1 = (w - crop_w) // 2
            y1 = (h - crop_h) // 2
            frame = frame[y1:y1 + crop_h, x1:x1 + crop_w]
            frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_LINEAR)

        # Rotation
        if rotation == 90:
            frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
        elif rotation == 180:
            frame = cv2.rotate(frame, cv2.ROTATE_180)
        elif rotation == 270:
            frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
        elif rotation != 0:
            h, w = frame.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, -rotation, 1.0)
            frame = cv2.warpAffine(frame, M, (w, h))

        # Flip
        if flip_h and flip_v:
            frame = cv2.flip(frame, -1)
        elif flip_h:
            frame = cv2.flip(frame, 1)
        elif flip_v:
            frame = cv2.flip(frame, 0)

        return frame

    def stop(self):
        self.running = False
        if isinstance(self.camera_id, str):
            self.connection_state.emit(self.camera_id, "disconnected")
        self.wait(5000)


# ============================================================================
# Person Detector
# ============================================================================

class PersonDetector:
    """Detects people using OpenCV HOG+SVM descriptor.

    Rate-limited to check every ~500ms. Uses hysteresis:
    - 3 consecutive detections to confirm presence (~1.5s)
    - 6 consecutive absences to confirm departure (~3s)
    """

    def __init__(self):
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

        self._detect_size = (320, 240)
        self._person_present = False
        self._consecutive_present = 0
        self._consecutive_absent = 0
        self._presence_threshold = 3
        self._absence_threshold = 12
        self._last_check_time = 0.0
        self._check_interval = 0.5  # seconds

    @property
    def person_present(self) -> bool:
        return self._person_present

    def check(self, frame: np.ndarray) -> Optional[bool]:
        """Check frame for person presence.

        Returns:
            None if rate-limited (no state change),
            True if person just became present,
            False if person just left,
        """
        now = time.time()
        if now - self._last_check_time < self._check_interval:
            return None
        self._last_check_time = now

        small = cv2.resize(frame, self._detect_size)
        rects, _ = self.hog.detectMultiScale(
            small, winStride=(8, 8), padding=(4, 4), scale=1.05
        )
        detected = len(rects) > 0

        if detected:
            self._consecutive_present += 1
            self._consecutive_absent = 0
        else:
            self._consecutive_absent += 1
            self._consecutive_present = 0

        old_state = self._person_present

        if not self._person_present and self._consecutive_present >= self._presence_threshold:
            self._person_present = True
        elif self._person_present and self._consecutive_absent >= self._absence_threshold:
            self._person_present = False

        if self._person_present != old_state:
            return self._person_present

        return None


# ============================================================================
# Network Camera Scanner
# ============================================================================

def droidcam_url(ip: str) -> str:
    """Build the correct DroidCam MJPEG stream URL for OpenCV."""
    return f"http://{ip}:4747/mjpegfeed"


def test_droidcam_connection(ip: str) -> tuple:
    """Try to connect to DroidCam at the given IP and read a frame.

    Returns (success: bool, message: str, url: str).
    """
    url = droidcam_url(ip)
    success, message = test_network_camera(url)
    return success, message, url


def _tcp_reachable(url: str, timeout: float = 3.0) -> bool:
    """Quick TCP-only reachability check for a camera URL.

    Does NOT open an HTTP connection — avoids occupying DroidCam's
    single-client stream slot.
    """
    from urllib.parse import urlparse
    parsed = urlparse(url)
    host, port = parsed.hostname, parsed.port or 80
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def test_network_camera(url: str) -> tuple:
    """Test if a URL serves video frames.

    For DroidCam URLs on port 4747, tries both /video and /mjpegfeed.
    Fast-fails on unreachable cameras via TCP check (no HTTP pre-check
    to avoid occupying DroidCam's single-client slot).
    Falls back to MJPEGCapture when OpenCV backends don't support HTTP.

    Returns (success: bool, message: str).
    """
    urls_to_try = [url]

    # DroidCam port 4747: try both /video and /mjpegfeed since iOS and
    # Android serve on different paths
    if ":4747/" in url:
        if url.endswith("/mjpegfeed"):
            urls_to_try.append(url.rsplit("/", 1)[0] + "/video")
        elif url.endswith("/video"):
            urls_to_try.append(url.rsplit("/", 1)[0] + "/mjpegfeed")

    for try_url in urls_to_try:
        # TCP-only reachability check — does not open an HTTP stream,
        # so DroidCam won't count this as a client session.
        if try_url.startswith("http") and not _tcp_reachable(try_url):
            logger.info("Camera at %s: not reachable", try_url)
            continue

        logger.info("Camera at %s: reachable, testing video...", try_url)

        # Try OpenCV backends (FFMPEG first to avoid AVFoundation conflicts on macOS)
        for backend_name, backend in [("FFMPEG", cv2.CAP_FFMPEG), ("default", cv2.CAP_ANY)]:
            logger.info("Testing camera at %s (%s backend)", try_url, backend_name)
            try:
                cap = cv2.VideoCapture(try_url, backend)
                try:
                    if cap.isOpened():
                        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                        ret, frame = cap.read()
                        if ret and frame is not None:
                            h, w = frame.shape[:2]
                            suffix = f" (via {try_url})" if try_url != url else ""
                            return True, f"Connected! Receiving {w}x{h} video{suffix}"
                        logger.debug("Camera at %s (%s): opened but read() failed", try_url, backend_name)
                    else:
                        logger.debug("Camera at %s (%s): isOpened()=False", try_url, backend_name)
                finally:
                    cap.release()
            except Exception as e:
                logger.debug("Test failed for %s (%s): %s", try_url, backend_name, e)

        # Fallback: MJPEGCapture for HTTP URLs (macOS pip OpenCV lacks FFMPEG HTTP)
        if try_url.startswith("http"):
            logger.info("Testing camera at %s (MJPEGCapture fallback)", try_url)
            try:
                cap = MJPEGCapture(try_url, timeout=5.0)
                if cap.busy:
                    cap.release()
                    return False, "DroidCam is busy \u2014 close other apps connected to it, then try again"
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        h, w = frame.shape[:2]
                        suffix = f" (via {try_url})" if try_url != url else ""
                        cap.release()
                        return True, f"Connected! Receiving {w}x{h} video{suffix}"
                cap.release()
            except Exception as e:
                logger.debug("MJPEGCapture test failed for %s: %s", try_url, e)

    return False, f"Could not connect to {url}"


class DroidCamScanner(QThread):
    """Scans local subnet for DroidCam instances (port 4747)."""

    DROIDCAM_PORT = 4747

    scan_progress = pyqtSignal(int, int)  # current, total
    camera_found = pyqtSignal(str, str)  # url, description
    scan_complete = pyqtSignal(list)  # list of (url, description) tuples

    def __init__(self):
        super().__init__()
        self._running = True

    def run(self):
        found = []
        try:
            subnet = self._get_local_subnet()
            if not subnet:
                logger.warning("Could not determine local subnet for DroidCam scan")
                self.scan_complete.emit(found)
                return

            total = 254
            for i in range(1, 255):
                if not self._running:
                    break
                self.scan_progress.emit(i, total)
                ip = f"{subnet}.{i}"

                if self._check_port(ip, self.DROIDCAM_PORT):
                    url = droidcam_url(ip)
                    desc = f"DroidCam ({ip})"
                    logger.info("Found DroidCam: %s", url)
                    found.append((url, desc))
                    self.camera_found.emit(url, desc)
        except Exception as e:
            logger.exception("DroidCam scanner thread crashed: %s", e)

        self.scan_complete.emit(found)

    def _get_local_subnet(self) -> Optional[str]:
        """Get local subnet prefix (e.g. '192.168.1')."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(("8.8.8.8", 80))
                ip = s.getsockname()[0]
            finally:
                s.close()
            parts = ip.split(".")
            return ".".join(parts[:3])
        except Exception:
            return None

    @staticmethod
    def _check_port(ip: str, port: int, timeout: float = 0.2) -> bool:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                s.settimeout(timeout)
                result = s.connect_ex((ip, port))
                return result == 0
            finally:
                s.close()
        except Exception:
            return False

    def stop(self):
        self._running = False
        self.wait(3000)
