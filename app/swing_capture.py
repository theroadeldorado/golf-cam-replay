"""
ReplaySwing - Multi-Camera Swing Recording System
==================================================
Records golf swings triggered by audio detection with multi-camera sync support.
Features:
- Audio-triggered recording (2s pre-buffer + 4s post-trigger)
- Multi-camera synchronization with network camera support
- Audio feature extraction and classification (heuristic + learned)
- Person detection for auto-arm/disarm
- Looping playback with speed control and frame stepping
- Picture-in-Picture overlay window (always on top)
- Drawing overlay (lines, circles) with persistence
- Side-by-side comparison view
- Session-based organization with thumbnails
- Settings persistence across sessions
- Keyboard shortcuts
"""

import sys
import os
import logging
import logging.handlers
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict

import cv2
import numpy as np

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QSlider, QComboBox, QFrame,
    QGroupBox, QSpinBox, QDoubleSpinBox,
    QCheckBox, QMessageBox, QFileDialog, QMenu, QStatusBar,
    QSizePolicy, QDialog, QDialogButtonBox, QListWidget, QListWidgetItem,
    QProgressBar, QTabWidget, QLineEdit, QToolBar,
)
from PyQt6.QtCore import (
    Qt, QTimer, QThread, pyqtSignal, QSize, QPoint, QRect,
)
from PyQt6.QtGui import (
    QImage, QPixmap, QPainter, QColor, QFont, QPen,
    QIcon, QAction, QPalette, QCursor, QShortcut, QKeySequence,
    QDesktopServices,
)
from PyQt6.QtCore import QUrl

# Local imports
from version import __version__
from config import (
    AppConfig, CameraPreset, load_settings, save_settings,
    SETTINGS_FILE, TRAINING_DATA_DIR, LOG_DIR,
)
from updater import UpdateChecker, UpdateBanner, _load_update_state, _save_update_state
from audio_engine import AudioDetector, AudioClassifier, MicPreview, enumerate_audio_devices, find_virtual_mic, AUDIO_AVAILABLE
from camera_engine import CameraCapture, PersonDetector, DroidCamScanner, test_droidcam_connection, test_network_camera, droidcam_url
from recording import RecordingManager, FrameBuffer
from drawing_overlay import DrawingOverlay, LineShape, CircleShape
from comparison_view import ComparisonWindow
from ui_components import (
    VideoPlayer, PiPWindow, ThumbnailWidget, ClipGallery,
    QTextEditLogHandler, LogPanel, composite_grid, SessionListWidget,
)


# ============================================================================
# Logging Setup
# ============================================================================

def setup_logging() -> QTextEditLogHandler:
    """Configure logging with file and UI handlers."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / "swing_capture.log"

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    # File handler (rotating)
    fh = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S"
    ))
    root.addHandler(fh)

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    root.addHandler(ch)

    # UI handler
    ui_handler = QTextEditLogHandler()
    ui_handler.setLevel(logging.INFO)
    ui_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))
    root.addHandler(ui_handler)

    return ui_handler


logger = logging.getLogger(__name__)


# ============================================================================
# QR Code Helper
# ============================================================================

try:
    import qrcode as _qrcode_mod
    QR_AVAILABLE = True
except ImportError:
    QR_AVAILABLE = False


def _make_qr_pixmap(data: str, size: int = 180) -> Optional[QPixmap]:
    """Generate a QR code QPixmap. Returns None if qrcode lib unavailable."""
    if not QR_AVAILABLE:
        return None
    try:
        qr = _qrcode_mod.QRCode(
            version=None, error_correction=_qrcode_mod.constants.ERROR_CORRECT_M,
            box_size=1, border=2,
        )
        qr.add_data(data)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        rows = len(matrix)
        cols = len(matrix[0]) if rows else 0
        # Render into QImage
        scale = max(1, size // max(rows, cols, 1))
        img_w, img_h = cols * scale, rows * scale
        img = QImage(img_w, img_h, QImage.Format.Format_RGB888)
        img.fill(QColor(255, 255, 255))
        painter = QPainter(img)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(0, 0, 0))
        for r, row in enumerate(matrix):
            for c, cell in enumerate(row):
                if cell:
                    painter.drawRect(c * scale, r * scale, scale, scale)
        painter.end()
        pixmap = QPixmap.fromImage(img).scaled(
            size, size, Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.FastTransformation,
        )
        return pixmap
    except Exception:
        return None


# ============================================================================
# Clip Share Server (QR code share to phone)
# ============================================================================

import http.server
import socket
import threading as _threading


class _ClipShareHandler(http.server.BaseHTTPRequestHandler):
    """Serves a single MP4 file."""

    clip_path = None  # set before server starts

    def do_GET(self):
        if self.clip_path and Path(self.clip_path).exists():
            data = Path(self.clip_path).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Disposition", f'attachment; filename="{Path(self.clip_path).name}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        pass  # suppress console output


class ClipShareServer:
    """HTTP server that serves a single clip on a random port."""

    def __init__(self, clip_path: str):
        self.clip_path = clip_path
        self._server = None
        self._thread = None
        self._port = 0
        self._ip = self._get_local_ip()

    @staticmethod
    def _get_local_ip() -> str:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    @property
    def url(self) -> str:
        return f"http://{self._ip}:{self._port}/clip.mp4"

    def start(self):
        handler = type("Handler", (_ClipShareHandler,), {"clip_path": self.clip_path})
        self._server = http.server.HTTPServer(("0.0.0.0", 0), handler)
        self._port = self._server.server_address[1]
        self._thread = _threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._server = None


class ShareDialog(QDialog):
    """QR code dialog for sharing a clip to a phone."""

    def __init__(self, clip_path: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Share to Phone")
        self.setFixedSize(320, 400)
        self.setStyleSheet("""
            QDialog { background-color: #1e1e1e; }
            QLabel { color: #ccc; }
        """)

        self._server = ClipShareServer(clip_path)
        self._server.start()

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Scan to download clip")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 16px; font-weight: bold; color: #fff;")
        layout.addWidget(title)

        qr_label = QLabel()
        qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        pixmap = _make_qr_pixmap(self._server.url, 200)
        if pixmap:
            qr_label.setPixmap(pixmap)
        else:
            qr_label.setText("QR code library not installed.\npip install qrcode")
            qr_label.setStyleSheet("color: #e74c3c;")
        layout.addWidget(qr_label)

        url_label = QLabel(self._server.url)
        url_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        url_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        url_label.setStyleSheet("color: #4a9eff; font-size: 11px;")
        layout.addWidget(url_label)

        hint = QLabel("Phone must be on the same WiFi network")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hint.setStyleSheet("color: #666; font-size: 11px;")
        layout.addWidget(hint)

        close_btn = QPushButton("Done")
        close_btn.setStyleSheet(
            "background-color: #4a9eff; color: white; border: none; "
            "border-radius: 6px; padding: 8px; font-weight: bold;"
        )
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn)

    def closeEvent(self, event):
        self._server.stop()
        super().closeEvent(event)

    def accept(self):
        self._server.stop()
        super().accept()


# ============================================================================
# Network Camera Dialog (replaces PhoneSetupDialog)
# ============================================================================

DROIDCAM_CLIENT_URL = "https://droidcam.app/go/droidCam.client.setup.exe"
DROIDCAM_CLIENT_FILENAME = "DroidCam.Client.Setup.exe"

CAMERA_APP_PRESETS = [
    {
        "name": "DroidCam (Android)",
        "url_template": "http://{ip}:4747/mjpegfeed",
        "help": "Open DroidCam on Android phone. Enter IP shown in the app.",
        "default_port": 4747,
    },
    {
        "name": "IP Webcam (Android)",
        "url_template": "http://{ip}:8080/video",
        "help": "Install 'IP Webcam' from Play Store. Start server, enter IP shown.",
        "default_port": 8080,
    },
    {
        "name": "DroidCam (iOS)",
        "url_template": "http://{ip}:4747/video",
        "help": "Install DroidCam from the App Store on your iPhone.\n"
                "Open the app and note the IP address shown.\n"
                "Both phone and PC must be on the same WiFi network.\n"
                "Tip: For USB connection, install the DroidCam desktop client instead.",
        "default_port": 4747,
    },
    {
        "name": "DroidCam Desktop Client (USB)",
        "url_template": None,
        "help": "For wired USB connection (iOS or Android):\n"
                "1. Install the DroidCam desktop client (click below)\n"
                "2. Connect phone via USB cable\n"
                "3. Open DroidCam on phone and desktop client on PC\n"
                "4. Connect via the desktop client, then use 'Detect USB' in camera settings.",
        "show_installer": True,
    },
    {
        "name": "EpocCam / Camo (iOS)",
        "url_template": None,
        "help": "EpocCam or Camo create a virtual webcam on your PC.\n"
                "1. Install the app on your iPhone and the desktop driver on PC\n"
                "2. Connect via WiFi or USB\n"
                "3. The camera appears as a USB webcam - use 'Detect USB' to find it.\n"
                "No IP address needed.",
    },
    {
        "name": "Custom URL (MJPEG/RTSP)",
        "url_template": None,
        "help": "Enter the full stream URL. Examples:\n"
                "  http://192.168.1.50:8080/video\n"
                "  rtsp://192.168.1.50:554/stream\n"
                "  http://192.168.1.50:4747/mjpegfeed",
    },
]

_DIALOG_SS = """
    QDialog { background-color: #1c1c1c; }
    QLabel { color: #d4d4d4; }
    QPushButton {
        background-color: #4a9eff; color: white; border: none;
        border-radius: 6px; padding: 10px 20px; font-weight: bold; font-size: 13px;
    }
    QPushButton:hover { background-color: #5aafff; }
    QPushButton:disabled { background-color: #3a3a3a; color: #666; }
    QLineEdit {
        background-color: #252525; color: #d4d4d4;
        border: 1px solid #3a3a3a; border-radius: 4px; padding: 6px 10px; font-size: 13px;
    }
    QLineEdit:focus { border-color: #4a9eff; }
    QProgressBar {
        background-color: #252525; border: none; border-radius: 4px;
    }
    QProgressBar::chunk { background-color: #4a9eff; border-radius: 3px; }
"""

_PRESET_BTN_SS = """
    QPushButton {
        background-color: #252525; color: #d4d4d4; border: 1px solid #3a3a3a;
        border-radius: 6px; padding: 8px 16px; font-size: 13px;
        text-align: left;
    }
    QPushButton:hover { background-color: #333333; border-color: #4a9eff; }
    QPushButton:checked { background-color: #4a9eff; color: white; border-color: #4a9eff; }
"""


class _ConnectionTestThread(QThread):
    """Background thread for testing network camera connections."""

    result_ready = pyqtSignal(bool, str)  # success, message

    def __init__(self, url: str):
        super().__init__()
        self._url = url

    def run(self):
        try:
            success, message = test_network_camera(self._url)
            self.result_ready.emit(success, message)
        except Exception as e:
            logger.exception("Connection test thread crashed: %s", e)
            self.result_ready.emit(False, f"Test error: {e}")


class NetworkCameraDialog(QDialog):
    """Dialog for adding any network camera (DroidCam, IP Webcam, RTSP, MJPEG, etc.)."""

    camera_added = pyqtSignal(str, str)  # url, label

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Add Network Camera")
        self.setFixedSize(520, 640)
        self.setStyleSheet(_DIALOG_SS)

        self._selected_preset = None

        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        # Title
        title = QLabel("Add Network Camera")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 18px; font-weight: bold; color: #fff; padding: 4px;")
        layout.addWidget(title)

        # ---- Quick Setup (pick an app) ----
        preset_group = QGroupBox("Quick Setup (pick an app)")
        preset_group.setStyleSheet(
            "QGroupBox { color: #d4d4d4; font-weight: bold; border: none; "
            "margin-top: 12px; padding-top: 16px; }"
        )
        preset_layout = QVBoxLayout(preset_group)
        preset_layout.setSpacing(4)

        self._preset_buttons = []
        for i, preset in enumerate(CAMERA_APP_PRESETS):
            btn = QPushButton(preset["name"])
            btn.setCheckable(True)
            btn.setStyleSheet(_PRESET_BTN_SS)
            btn.clicked.connect(lambda checked, idx=i: self._on_preset_selected(idx))
            preset_layout.addWidget(btn)
            self._preset_buttons.append(btn)

        layout.addWidget(preset_group)

        # ---- Connection section ----
        self.conn_frame = QGroupBox("Connection")
        self.conn_frame.setStyleSheet(
            "QGroupBox { color: #d4d4d4; font-weight: bold; border: none; "
            "margin-top: 12px; padding-top: 16px; }"
        )
        conn_layout = QVBoxLayout(self.conn_frame)
        conn_layout.setSpacing(8)

        # Help text
        self.help_label = QLabel("Select a camera app above to get started.")
        self.help_label.setWordWrap(True)
        self.help_label.setStyleSheet("color: #9a9a9a; font-size: 12px; padding: 2px;")
        conn_layout.addWidget(self.help_label)

        # URL row (shown for Custom URL preset)
        self.url_row = QWidget()
        url_row_layout = QHBoxLayout(self.url_row)
        url_row_layout.setContentsMargins(0, 0, 0, 0)
        url_row_layout.addWidget(QLabel("URL:"))
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("http://192.168.1.50:8080/video")
        url_row_layout.addWidget(self.url_input, stretch=1)
        self.url_row.setVisible(False)
        conn_layout.addWidget(self.url_row)

        # IP row (shown for presets with url_template)
        self.ip_row = QWidget()
        ip_row_layout = QHBoxLayout(self.ip_row)
        ip_row_layout.setContentsMargins(0, 0, 0, 0)
        ip_row_layout.addWidget(QLabel("IP:"))
        self.ip_input = QLineEdit()
        self.ip_input.setPlaceholderText("192.168.1.50")
        ip_row_layout.addWidget(self.ip_input, stretch=1)
        self.ip_row.setVisible(False)
        conn_layout.addWidget(self.ip_row)

        # Test button
        self.test_btn = QPushButton("Test Connection")
        self.test_btn.setEnabled(False)
        self.test_btn.clicked.connect(self._test_connection)
        conn_layout.addWidget(self.test_btn)

        # Status
        self.status_label = QLabel("")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setWordWrap(True)
        self.status_label.setStyleSheet("color: #666; font-size: 12px; padding: 4px;")
        conn_layout.addWidget(self.status_label)

        layout.addWidget(self.conn_frame)

        # ---- DroidCam Desktop Client section (hidden by default) ----
        self.client_frame = QGroupBox("DroidCam Desktop Client (iOS)")
        self.client_frame.setStyleSheet(
            "QGroupBox { color: #d4d4d4; font-weight: bold; border: none; "
            "margin-top: 12px; padding-top: 16px; }"
        )
        client_layout = QVBoxLayout(self.client_frame)
        client_layout.setSpacing(6)

        client_label = QLabel(
            '<p style="color:#9a9a9a; font-size:11px;">'
            'iOS DroidCam requires the Windows desktop client to create a virtual webcam. '
            'After installing, connect via the DroidCam client, then use "Detect USB" '
            'in camera settings.</p>'
        )
        client_label.setTextFormat(Qt.TextFormat.RichText)
        client_label.setWordWrap(True)
        client_layout.addWidget(client_label)

        self.install_client_btn = QPushButton("Download && Install DroidCam Client")
        self.install_client_btn.setStyleSheet(
            "background-color: #e67e22; font-size: 13px; padding: 10px; border-radius: 6px;"
        )
        self.install_client_btn.clicked.connect(self._download_and_install_client)
        client_layout.addWidget(self.install_client_btn)

        self.client_status_label = QLabel("")
        self.client_status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.client_status_label.setStyleSheet("color: #666; font-size: 11px; padding: 2px;")
        self.client_status_label.setWordWrap(True)
        client_layout.addWidget(self.client_status_label)

        self.client_progress = QProgressBar()
        self.client_progress.setVisible(False)
        self.client_progress.setFixedHeight(8)
        self.client_progress.setTextVisible(False)
        client_layout.addWidget(self.client_progress)

        self.client_frame.setVisible(False)
        layout.addWidget(self.client_frame)

        # Spacer
        layout.addStretch()

        # Done button
        done_btn = QPushButton("Done")
        done_btn.setStyleSheet(
            "background-color: #333333; color: #d4d4d4; border: 1px solid #3a3a3a;"
        )
        done_btn.clicked.connect(self.accept)
        layout.addWidget(done_btn)

    def _on_preset_selected(self, index: int):
        """Handle preset button click."""
        # Update button checked states
        for i, btn in enumerate(self._preset_buttons):
            btn.setChecked(i == index)

        preset = CAMERA_APP_PRESETS[index]
        self._selected_preset = preset

        # Update help text
        self.help_label.setText(preset["help"])

        has_template = preset.get("url_template") is not None
        is_custom = preset["name"].startswith("Custom")
        show_installer = preset.get("show_installer", False)

        # Show/hide IP vs URL input
        self.ip_row.setVisible(has_template)
        self.url_row.setVisible(is_custom)
        self.test_btn.setEnabled(has_template or is_custom)

        # Show/hide installer section
        self.client_frame.setVisible(show_installer)

        # Hide connection section for installer-only presets
        self.conn_frame.setVisible(has_template or is_custom)

        # Clear previous state
        self.status_label.setText("")
        self.ip_input.clear()
        self.url_input.clear()

    def _build_url(self) -> Optional[str]:
        """Build the stream URL from the current preset and input."""
        if self._selected_preset is None:
            return None

        template = self._selected_preset.get("url_template")
        if template:
            ip = self.ip_input.text().strip()
            if not ip:
                return None
            return template.format(ip=ip)

        # Custom URL mode
        url = self.url_input.text().strip()
        return url if url else None

    def _test_connection(self):
        """Test the network camera URL in a background thread."""
        url = self._build_url()
        if not url:
            self.status_label.setText("Please enter an IP address or URL.")
            self.status_label.setStyleSheet("color: #e74c3c; font-size: 12px; padding: 4px;")
            return

        self.test_btn.setEnabled(False)
        self.test_btn.setText("Testing...")
        self.status_label.setText(f"Testing {url}...")
        self.status_label.setStyleSheet("color: #f1c40f; font-size: 12px; padding: 4px;")

        self._test_url = url
        self._test_thread = _ConnectionTestThread(url)
        self._test_thread.result_ready.connect(self._on_test_result)
        self._test_thread.start()

    def _on_test_result(self, success: bool, message: str):
        """Handle test result from background thread."""
        url = self._test_url
        self.test_btn.setEnabled(True)
        self.test_btn.setText("Test Connection")

        if success:
            self.status_label.setText(f"{message}")
            self.status_label.setStyleSheet(
                "color: #2ecc71; font-size: 12px; padding: 4px; font-weight: bold;"
            )
            # Extract actual working URL if test_network_camera found an alternate
            actual_url = url
            if "(via " in message:
                # Message format: "Connected! ... (via http://...)"
                via_part = message.split("(via ")[-1].rstrip(")")
                if via_part.startswith("http"):
                    actual_url = via_part

            # Build label from preset name and IP/URL
            preset_name = self._selected_preset["name"] if self._selected_preset else "Network Camera"
            ip_or_url = self.ip_input.text().strip() or self.url_input.text().strip()
            label = f"{preset_name} ({ip_or_url})"
            self.camera_added.emit(actual_url, label)
            logger.info("Network camera verified: %s", actual_url)
        else:
            self.status_label.setText(f"Failed: {message}")
            self.status_label.setStyleSheet("color: #e74c3c; font-size: 12px; padding: 4px;")
            logger.warning("Network camera test failed for %s: %s", url, message)

    def _download_and_install_client(self):
        """Download and launch the DroidCam Windows client installer."""
        import tempfile
        import urllib.request
        import subprocess

        self.install_client_btn.setEnabled(False)
        self.install_client_btn.setText("Downloading...")
        self.client_progress.setVisible(True)
        self.client_progress.setValue(0)
        self.client_status_label.setText("Downloading DroidCam Client...")
        self.client_status_label.setStyleSheet("color: #f1c40f; font-size: 11px; padding: 2px;")
        QApplication.processEvents()

        download_dir = Path(tempfile.gettempdir())
        installer_path = download_dir / DROIDCAM_CLIENT_FILENAME

        try:
            def _progress_hook(block_num, block_size, total_size):
                if total_size > 0:
                    pct = min(100, int(block_num * block_size * 100 / total_size))
                    self.client_progress.setValue(pct)
                    QApplication.processEvents()

            urllib.request.urlretrieve(DROIDCAM_CLIENT_URL, str(installer_path), _progress_hook)

            self.client_progress.setValue(100)
            self.client_status_label.setText("Download complete. Launching installer...")
            self.client_status_label.setStyleSheet("color: #2ecc71; font-size: 11px; padding: 2px;")
            QApplication.processEvents()

            subprocess.Popen([str(installer_path)])

            self.client_status_label.setText(
                "Installer launched! Follow the setup wizard.\n"
                "After installing, open the DroidCam client and connect to your phone,\n"
                "then use 'Detect USB' in camera settings."
            )
            logger.info("DroidCam client installer launched from %s", installer_path)

        except Exception as e:
            self.client_status_label.setText(f"Download failed: {e}")
            self.client_status_label.setStyleSheet("color: #e74c3c; font-size: 11px; padding: 2px;")
            logger.error("DroidCam client download failed: %s", e)

        finally:
            self.client_progress.setVisible(False)
            self.install_client_btn.setEnabled(True)
            self.install_client_btn.setText("Download && Install DroidCam Client")


# ============================================================================
# Camera Settings Dialog
# ============================================================================

class CameraSettingsDialog(QDialog):
    """Dialog for configuring cameras with phone setup integration."""

    def __init__(self, config: AppConfig, parent=None):
        super().__init__(parent)
        self.config = config
        self.setWindowTitle("Camera Settings")
        self.setMinimumSize(550, 520)
        self.setStyleSheet("""
            QDialog { background-color: #1c1c1c; }
            QLabel { color: #d4d4d4; }
            QListWidget {
                background-color: #141414; border: 1px solid #3a3a3a;
                border-radius: 4px; color: #d4d4d4;
            }
            QListWidget::item:selected { background-color: #4a9eff; }
            QPushButton {
                background-color: #4a9eff; color: white; border: none;
                border-radius: 4px; padding: 8px 16px; font-weight: bold;
            }
            QPushButton:hover { background-color: #5aafff; }
            QLineEdit {
                background-color: #252525; color: #d4d4d4;
                border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px 8px;
            }
            QLineEdit:focus { border-color: #4a9eff; }
            QComboBox {
                background-color: #252525; border: 1px solid #3a3a3a;
                border-radius: 4px; padding: 4px 8px; color: #d4d4d4;
            }
            QSpinBox, QDoubleSpinBox {
                background-color: #252525; border: 1px solid #3a3a3a;
                border-radius: 4px; padding: 4px; color: #d4d4d4;
            }
            QCheckBox { color: #d4d4d4; }
        """)

        self._presets: List[CameraPreset] = [CameraPreset.from_dict(c.to_dict()) for c in config.cameras]
        self._current_edit_row = -1

        layout = QVBoxLayout(self)

        # ---- Add Network Camera (prominent) ----
        network_btn = QPushButton("Add Network Camera")
        network_btn.setStyleSheet(
            "background-color: #2ecc71; font-size: 14px; padding: 12px; border-radius: 8px;"
        )
        network_btn.clicked.connect(self._open_network_camera_setup)
        layout.addWidget(network_btn)

        # Camera list
        layout.addWidget(QLabel("Cameras:"))
        self.camera_list = QListWidget()
        self.camera_list.currentRowChanged.connect(self._on_selection_changed)
        layout.addWidget(self.camera_list)

        # Camera actions
        btn_row = QHBoxLayout()
        scan_usb_btn = QPushButton("Detect USB Cameras")
        scan_usb_btn.setToolTip("Scan for USB webcams and virtual cameras (DroidCam, EpocCam, Camo)")
        scan_usb_btn.clicked.connect(self._detect_usb)
        btn_row.addWidget(scan_usb_btn)

        remove_btn = QPushButton("Remove")
        remove_btn.setStyleSheet("background-color: #e74c3c;")
        remove_btn.clicked.connect(self._remove_camera)
        btn_row.addWidget(remove_btn)
        layout.addLayout(btn_row)

        # Per-camera settings
        settings_group = QGroupBox("Selected Camera Settings")
        settings_group.setStyleSheet(
            "QGroupBox { color: #d4d4d4; font-weight: bold; border: none; "
            "margin-top: 12px; padding-top: 12px; }"
        )
        sg_layout = QVBoxLayout(settings_group)

        label_row = QHBoxLayout()
        label_row.addWidget(QLabel("Label:"))
        self.label_input = QLineEdit()
        label_row.addWidget(self.label_input)
        sg_layout.addLayout(label_row)

        zoom_row = QHBoxLayout()
        zoom_row.addWidget(QLabel("Zoom:"))
        self.zoom_spin = QDoubleSpinBox()
        self.zoom_spin.setRange(1.0, 4.0)
        self.zoom_spin.setSingleStep(0.1)
        self.zoom_spin.setValue(1.0)
        zoom_row.addWidget(self.zoom_spin)
        sg_layout.addLayout(zoom_row)

        rot_row = QHBoxLayout()
        rot_row.addWidget(QLabel("Rotation:"))
        self.rotation_combo = QComboBox()
        self.rotation_combo.addItems(["0", "90", "180", "270"])
        rot_row.addWidget(self.rotation_combo)
        sg_layout.addLayout(rot_row)

        flip_row = QHBoxLayout()
        self.flip_h_check = QCheckBox("Flip Horizontal")
        self.flip_v_check = QCheckBox("Flip Vertical")
        flip_row.addWidget(self.flip_h_check)
        flip_row.addWidget(self.flip_v_check)
        sg_layout.addLayout(flip_row)

        layout.addWidget(settings_group)

        # Primary camera
        primary_row = QHBoxLayout()
        primary_row.addWidget(QLabel("Primary camera:"))
        self.primary_combo = QComboBox()
        primary_row.addWidget(self.primary_combo)
        layout.addLayout(primary_row)

        # Dialog buttons
        button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        button_box.accepted.connect(self._apply_and_accept)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

        self._refresh_list()

    def _open_network_camera_setup(self):
        dlg = NetworkCameraDialog(self)
        dlg.camera_added.connect(self._on_network_camera_added)
        dlg.exec()

    def _on_network_camera_added(self, url: str, desc: str):
        existing_urls = {p.id for p in self._presets if p.type == "network"}
        if url not in existing_urls:
            self._presets.append(CameraPreset(id=url, type="network", label=desc))
            self._refresh_list()

    def _refresh_list(self):
        self.camera_list.clear()
        self.primary_combo.clear()
        for p in self._presets:
            label = p.label or f"Camera {p.id}"
            type_str = "USB" if p.type == "usb" else "Network"
            self.camera_list.addItem(f"[{type_str}] {label}")
            self.primary_combo.addItem(f"{label}", p.id)
        # Restore saved primary camera selection
        for i in range(self.primary_combo.count()):
            if self.primary_combo.itemData(i) == self.config.primary_camera:
                self.primary_combo.setCurrentIndex(i)
                break

    def _save_row_settings(self, row: int):
        """Save current form values back to the preset at the given row."""
        if 0 <= row < len(self._presets):
            p = self._presets[row]
            p.label = self.label_input.text()
            p.zoom = self.zoom_spin.value()
            p.rotation = int(self.rotation_combo.currentText())
            p.flip_h = self.flip_h_check.isChecked()
            p.flip_v = self.flip_v_check.isChecked()
            # Update list item and primary combo text to reflect label changes
            label = p.label or f"Camera {p.id}"
            type_str = "USB" if p.type == "usb" else "Network"
            item = self.camera_list.item(row)
            if item:
                item.setText(f"[{type_str}] {label}")
            if row < self.primary_combo.count():
                self.primary_combo.setItemText(row, label)

    def _on_selection_changed(self, row: int):
        # Save previous camera's form values before switching
        if self._current_edit_row >= 0 and self._current_edit_row != row:
            self._save_row_settings(self._current_edit_row)
        if 0 <= row < len(self._presets):
            self._current_edit_row = row
            p = self._presets[row]
            self.label_input.setText(p.label)
            self.zoom_spin.setValue(p.zoom)
            rot_idx = {0: 0, 90: 1, 180: 2, 270: 3}.get(p.rotation, 0)
            self.rotation_combo.setCurrentIndex(rot_idx)
            self.flip_h_check.setChecked(p.flip_h)
            self.flip_v_check.setChecked(p.flip_v)

    def _apply_current_settings(self):
        self._save_row_settings(self.camera_list.currentRow())

    def _detect_usb(self):
        existing_usb_ids = {p.id for p in self._presets if p.type == "usb"}
        if sys.platform == "win32":
            backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
        else:
            backends = [cv2.CAP_ANY]

        # Hold found cameras open while scanning so the same physical
        # device can't respond at multiple indices.
        held_open: list = []
        try:
            for i in range(10):
                if i in existing_usb_ids:
                    continue
                for backend in backends:
                    cap = cv2.VideoCapture(i, backend)
                    if cap.isOpened():
                        ret, _ = cap.read()
                        if ret:
                            self._presets.append(CameraPreset(id=i, type="usb", label=f"USB Camera {i}"))
                            held_open.append(cap)
                            break
                    cap.release()
        finally:
            for cap in held_open:
                cap.release()
        self._refresh_list()

    def _remove_camera(self):
        row = self.camera_list.currentRow()
        if 0 <= row < len(self._presets):
            self._presets.pop(row)
            self._refresh_list()

    def _apply_and_accept(self):
        self._apply_current_settings()
        self.accept()

    def get_presets(self) -> List[CameraPreset]:
        return self._presets

    def get_primary_camera(self):
        return self.primary_combo.currentData() if self.primary_combo.count() > 0 else 0


# ============================================================================
# Help Overlay
# ============================================================================

class KeyboardHelpOverlay(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Keyboard Shortcuts")
        self.setMinimumWidth(350)
        self.setStyleSheet("""
            QDialog { background-color: #1c1c1c; }
            QLabel { color: #d4d4d4; font-size: 13px; }
        """)
        layout = QVBoxLayout(self)
        shortcuts = [
            ("Space", "Toggle play/pause"),
            ("Left Arrow", "Step back one frame"),
            ("Right Arrow", "Step forward one frame"),
            ("A", "Toggle arm/disarm"),
            ("T", "Manual trigger"),
            ("[", "Decrease playback speed"),
            ("]", "Increase playback speed"),
            ("P", "Toggle PiP window"),
            ("Delete", "Delete selected overlay shape"),
            ("Escape", "Deselect / exit drawing mode"),
            ("1", "Select tool"),
            ("2", "Line tool"),
            ("3", "Circle tool"),
            ("?", "Show this help"),
        ]
        for key, desc in shortcuts:
            row = QHBoxLayout()
            key_label = QLabel(f"  {key}  ")
            key_label.setStyleSheet(
                "background-color: #333333; border-radius: 4px; padding: 4px 8px; "
                "font-family: Consolas; font-weight: bold; color: #fff;"
            )
            key_label.setFixedWidth(120)
            row.addWidget(key_label)
            row.addWidget(QLabel(desc))
            row.addStretch()
            layout.addLayout(row)

        close_btn = QPushButton("Close")
        close_btn.setStyleSheet("background-color: #4a9eff; color: white; border: none; border-radius: 4px; padding: 8px;")
        close_btn.clicked.connect(self.close)
        layout.addWidget(close_btn)


# ============================================================================
# Main Application Window
# ============================================================================

class MainWindow(QMainWindow):
    """Main application window."""

    SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0]

    def __init__(self, log_handler: QTextEditLogHandler):
        super().__init__()

        self.config = AppConfig()
        load_settings(self.config)

        self.recording_manager = RecordingManager(self.config)

        # State
        self.camera_captures: Dict = {}
        self.frame_buffers: Dict = {}
        self.camera_fps: Dict = {}  # cam_id -> latest measured FPS
        self.audio_detector: Optional[AudioDetector] = None
        self.current_frames: Dict = {}

        self.is_armed = False
        self.is_recording = False
        self.recording_start_time = 0
        self.recorded_frames: Dict = {}
        self.last_trigger_confidence = 0.0
        self.last_trigger_timestamp: Optional[int] = None

        self.playback_clip_index = -1
        self.playback_frames: List[np.ndarray] = []
        self.playback_position = 0
        self.is_playing = False
        self.playback_speed = self.config.playback_speed

        # Multi-angle playback
        self.playback_all_frames: Dict[str, List[np.ndarray]] = {}  # cam_id -> frames
        self.playback_camera_labels: Dict[str, str] = {}  # cam_id -> label
        self.playback_active_camera: Optional[str] = None  # current angle cam_id
        self.playback_multi_view = False  # True = grid view of all cameras

        self.live_visible_cameras: set = set()  # cameras shown in live feed
        self.pip_window: Optional[PiPWindow] = None
        self.person_detector = PersonDetector()
        self.person_detected = False
        self._test_camera_server = None

        self.log_handler = log_handler

        # Debounce timer for save_settings (frequent changes like threshold slider)
        self._save_debounce_timer = QTimer()
        self._save_debounce_timer.setSingleShot(True)
        self._save_debounce_timer.setInterval(1000)
        self._save_debounce_timer.timeout.connect(lambda: save_settings(self.config))

        self._setup_ui()
        self._setup_timers()
        self._setup_shortcuts()
        self._start_cameras()
        self._load_existing_clips()
        self._refresh_session_list()

        self._update_checker = None
        self._update_banner = None
        self._device_warning_banner = None
        QTimer.singleShot(3000, self._check_for_updates)
        QTimer.singleShot(5000, self._check_device_status)

        logger.info("ReplaySwing v%s started (session: %s)", __version__, self.config.session_folder)

    # ------------------------------------------------------------------
    # UI Setup
    # ------------------------------------------------------------------

    def _setup_ui(self):
        self.setWindowTitle(f"ReplaySwing v{__version__}")
        self.setMinimumSize(1200, 800)

        if self.config.window_geometry:
            g = self.config.window_geometry
            if len(g) == 4 and g[2] > 100 and g[3] > 100 and g[0] >= -100 and g[1] >= -100:
                self.setGeometry(g[0], g[1], g[2], g[3])

        self.setStyleSheet("""
            QMainWindow { background-color: #1c1c1c; }
            QGroupBox {
                color: #d4d4d4; font-weight: bold; font-size: 13px;
                border: none;
                margin-top: 12px; padding-top: 8px;
            }
            QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 5px; }
            QLabel { color: #d4d4d4; font-size: 12px; }
            QPushButton {
                background-color: #333333; color: #d4d4d4;
                border: 1px solid #3a3a3a; border-radius: 6px;
                padding: 6px 14px; font-size: 12px;
            }
            QPushButton:hover { background-color: #4d4d4d; border-color: #4a4a4a; }
            QPushButton:pressed { background-color: #252525; }
            QPushButton:checked { background-color: #4a9eff; color: white; border-color: #4a9eff; }
            QSlider::groove:horizontal { height: 4px; background-color: #2e2e2e; border-radius: 2px; }
            QSlider::handle:horizontal {
                width: 14px; height: 14px; margin: -5px 0;
                background-color: #4a9eff; border-radius: 7px;
            }
            QSlider::sub-page:horizontal { background-color: #4a9eff; border-radius: 2px; }
            QTabWidget::pane { border: none; border-top: 1px solid #2e2e2e; }
            QTabBar::tab {
                background-color: transparent; color: #9a9a9a; padding: 6px 14px;
                border: none; border-bottom: 2px solid transparent;
            }
            QTabBar::tab:selected { color: #fff; border-bottom: 2px solid #4a9eff; }
            QTabBar::tab:hover { color: #d4d4d4; }
            QComboBox {
                background-color: #252525; color: #d4d4d4;
                border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px 8px;
            }
            QComboBox:hover { border-color: #4a4a4a; }
            QComboBox QAbstractItemView {
                background-color: #252525; color: #d4d4d4;
                border: 1px solid #3a3a3a; selection-background-color: rgba(74,158,255,0.2);
            }
        """)

        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(12, 12, 12, 12)
        main_layout.setSpacing(8)

        # Left panel
        left_panel = QWidget()
        self.left_layout = left_layout = QVBoxLayout(left_panel)
        left_layout.setSpacing(6)

        # Drawing toolbar
        drawing_toolbar = QHBoxLayout()
        self.select_tool_btn = QPushButton("Select")
        self.select_tool_btn.setCheckable(True)
        self.select_tool_btn.setChecked(True)
        self.select_tool_btn.clicked.connect(lambda: self._set_drawing_mode("select"))

        self.line_tool_btn = QPushButton("Line")
        self.line_tool_btn.setCheckable(True)
        self.line_tool_btn.clicked.connect(lambda: self._set_drawing_mode("line"))

        self.circle_tool_btn = QPushButton("Circle")
        self.circle_tool_btn.setCheckable(True)
        self.circle_tool_btn.clicked.connect(lambda: self._set_drawing_mode("circle"))

        self.clear_draw_btn = QPushButton("Clear All")
        self.clear_draw_btn.clicked.connect(self._clear_drawings)

        # Color palette buttons
        self.color_btns = []
        for color in DrawingOverlay.COLORS:
            btn = QPushButton()
            btn.setFixedSize(20, 20)
            btn.setStyleSheet(
                f"QPushButton {{ background-color: {color}; border: 1px solid #2e2e2e; "
                f"border-radius: 3px; padding: 0; min-width: 20px; min-height: 20px; }}"
                f"QPushButton:hover {{ border-color: #fff; }}"
            )
            btn.clicked.connect(lambda checked, c=color: self._set_drawing_color(c))
            self.color_btns.append(btn)

        tool_btn_style = """
            QPushButton {
                background-color: transparent; color: #9a9a9a;
                border: 1px solid #2e2e2e; padding: 2px 10px; font-size: 11px;
            }
            QPushButton:hover { border-color: #4a4a4a; color: #d4d4d4; }
            QPushButton:checked {
                background-color: rgba(74,158,255,0.15); color: #4a9eff; border-color: #4a9eff;
            }
        """
        self._tool_buttons = [self.select_tool_btn, self.line_tool_btn, self.circle_tool_btn]
        for btn in self._tool_buttons:
            btn.setFixedHeight(26)
            btn.setStyleSheet(tool_btn_style)
            drawing_toolbar.addWidget(btn)

        self.clear_draw_btn.setStyleSheet(
            "QPushButton { background-color: transparent; color: #666; border: none; font-size: 11px; }"
            "QPushButton:hover { color: #9a9a9a; }"
        )
        drawing_toolbar.addWidget(self.clear_draw_btn)

        # Separator
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.VLine)
        sep.setFixedHeight(20)
        sep.setStyleSheet("color: #2e2e2e;")
        drawing_toolbar.addWidget(sep)

        for btn in self.color_btns:
            drawing_toolbar.addWidget(btn)
        drawing_toolbar.addStretch()

        # Camera dropdown (right side of drawing toolbar)
        self.camera_dropdown_btn = QPushButton("Cameras")
        self.camera_dropdown_btn.setStyleSheet(
            "QPushButton { background-color: #333333; color: #d4d4d4; border: 1px solid #3a3a3a; "
            "border-radius: 4px; padding: 4px 12px; font-size: 12px; }"
            "QPushButton:hover { background-color: #4d4d4d; }"
            "QPushButton::menu-indicator { image: none; }"
        )
        self.camera_dropdown_menu = QMenu(self)
        self.camera_dropdown_menu.setStyleSheet(
            "QMenu { background-color: #2d2d2d; border: 1px solid #444; border-radius: 4px; padding: 4px; }"
            "QMenu::item { padding: 6px 20px; color: #ccc; }"
            "QMenu::item:selected { background-color: #4a9eff; color: white; }"
            "QMenu::indicator { width: 14px; height: 14px; }"
            "QMenu::indicator:checked { background-color: #4a9eff; border: 1px solid #4a9eff; border-radius: 2px; }"
            "QMenu::indicator:unchecked { background-color: #1a1a1a; border: 1px solid #555; border-radius: 2px; }"
        )
        self.camera_dropdown_btn.setMenu(self.camera_dropdown_menu)
        drawing_toolbar.addWidget(self.camera_dropdown_btn)

        left_layout.addLayout(drawing_toolbar)

        # Angle selector bar (hidden by default, shown when multi-camera clip loaded)
        self.angle_bar = QWidget()
        self.angle_bar_layout = QHBoxLayout(self.angle_bar)
        self.angle_bar_layout.setContentsMargins(4, 2, 4, 2)
        self.angle_bar_layout.setSpacing(4)
        self.angle_bar.setStyleSheet("background-color: #252525; border-radius: 4px;")
        self.angle_buttons: List[QPushButton] = []
        self.multi_view_btn: Optional[QPushButton] = None
        self.angle_bar.setVisible(False)
        left_layout.addWidget(self.angle_bar)

        # Video display with overlay stack
        self.video_container = QWidget()
        self.video_container.setMinimumSize(800, 450)
        video_stack_layout = QVBoxLayout(self.video_container)
        video_stack_layout.setContentsMargins(0, 0, 0, 0)

        self.video_player = VideoPlayer()
        self.video_player.setMinimumSize(800, 450)
        video_stack_layout.addWidget(self.video_player, stretch=1)

        # Drawing overlay sits on top of the video player
        self.drawing_overlay = DrawingOverlay(self.video_player)
        self.drawing_overlay.shapes_changed.connect(self._on_shapes_changed)
        self.drawing_overlay.load_shapes(self.config.drawing_overlays)

        left_layout.addWidget(self.video_container, stretch=1)

        # Playback controls
        playback_group = QWidget()
        playback_group.setStyleSheet("background-color: #1c1c1c;")
        playback_layout = QHBoxLayout(playback_group)

        ghost_btn_style = (
            "QPushButton { background-color: transparent; color: #9a9a9a; border: none; font-size: 12px; }"
            "QPushButton:hover { color: #d4d4d4; }"
        )

        self.live_btn = QPushButton("Live")
        self.live_btn.clicked.connect(self._go_to_live)
        playback_layout.addWidget(self.live_btn)
        self._update_live_btn_style()

        self.step_back_btn = QPushButton("\u25c0")
        self.step_back_btn.setFixedSize(28, 28)
        self.step_back_btn.setStyleSheet(ghost_btn_style)
        self.step_back_btn.clicked.connect(self._step_back)
        playback_layout.addWidget(self.step_back_btn)

        self.play_btn = QPushButton("Play")
        self.play_btn.setCheckable(True)
        self.play_btn.clicked.connect(self._toggle_playback)
        playback_layout.addWidget(self.play_btn)

        self.step_fwd_btn = QPushButton("\u25b6")
        self.step_fwd_btn.setFixedSize(28, 28)
        self.step_fwd_btn.setStyleSheet(ghost_btn_style)
        self.step_fwd_btn.clicked.connect(self._step_forward)
        playback_layout.addWidget(self.step_fwd_btn)

        self.playback_slider = QSlider(Qt.Orientation.Horizontal)
        self.playback_slider.setMinimum(0)
        self.playback_slider.setMaximum(100)
        self.playback_slider.valueChanged.connect(self._on_slider_changed)
        playback_layout.addWidget(self.playback_slider, stretch=1)

        self.frame_label = QLabel("0 / 0")
        self.frame_label.setFixedWidth(80)
        self.frame_label.setStyleSheet("color: #666; font-size: 11px;")
        playback_layout.addWidget(self.frame_label)

        # Speed selector
        playback_layout.addWidget(QLabel("Speed:"))
        self.speed_combo = QComboBox()
        for s in self.SPEED_OPTIONS:
            self.speed_combo.addItem(f"{s}x", s)
        default_idx = self.SPEED_OPTIONS.index(self.playback_speed) if self.playback_speed in self.SPEED_OPTIONS else 3
        self.speed_combo.setCurrentIndex(default_idx)
        self.speed_combo.currentIndexChanged.connect(self._on_speed_changed)
        playback_layout.addWidget(self.speed_combo)

        self.pip_btn = QPushButton("PiP")
        self.pip_btn.clicked.connect(self._toggle_pip)
        playback_layout.addWidget(self.pip_btn)

        self.compare_btn = QPushButton("Compare")
        self.compare_btn.clicked.connect(self._open_comparison)
        playback_layout.addWidget(self.compare_btn)

        self.share_btn = QPushButton("Share")
        self.share_btn.clicked.connect(self._on_share_btn_clicked)
        playback_layout.addWidget(self.share_btn)

        left_layout.addWidget(playback_group)

        # Recording controls (simplified: Arm + Trigger + level meter)
        record_group = QWidget()
        record_group.setStyleSheet("background-color: #1c1c1c;")
        record_layout = QHBoxLayout(record_group)

        self.arm_btn = QPushButton("Arm")
        self.arm_btn.setCheckable(True)
        self.arm_btn.setStyleSheet("""
            QPushButton:checked { background-color: #e84c3c; color: white; border-color: #e84c3c; }
        """)
        self.arm_btn.clicked.connect(self._toggle_armed)
        record_layout.addWidget(self.arm_btn)

        self.manual_trigger_btn = QPushButton("Manual Trigger")
        self.manual_trigger_btn.clicked.connect(self._manual_trigger)
        record_layout.addWidget(self.manual_trigger_btn)

        self.phone_btn = QPushButton("Connect Phone")
        self.phone_btn.clicked.connect(self._on_phone_btn_clicked)
        record_layout.addWidget(self.phone_btn)
        self._set_phone_btn_state("idle")

        record_layout.addStretch()

        # Audio level meter (kept in recording bar)
        self.audio_level = QProgressBar()
        self.audio_level.setFixedWidth(100)
        self.audio_level.setFixedHeight(4)
        self.audio_level.setMaximum(100)
        self.audio_level.setTextVisible(False)
        self.audio_level.setStyleSheet("""
            QProgressBar { background-color: #252525; border: none; border-radius: 2px; }
            QProgressBar::chunk { background-color: #4a9eff; border-radius: 2px; }
        """)
        record_layout.addWidget(self.audio_level)

        left_layout.addWidget(record_group)

        # Status
        self.status_label = QLabel("\u25cf  Ready - Arm to begin capturing")
        self.status_label.setStyleSheet(
            "QLabel { background-color: transparent; padding: 4px 8px; font-size: 12px; "
            "font-weight: normal; color: #9a9a9a; }"
        )
        left_layout.addWidget(self.status_label)

        main_layout.addWidget(left_panel, stretch=2)

        # Right panel - Tabbed
        right_panel = QWidget()
        right_panel.setFixedWidth(400)
        right_layout = QVBoxLayout(right_panel)
        right_layout.setSpacing(8)

        # Session browser
        self.session_list = SessionListWidget()
        self.session_list.session_selected.connect(self._on_session_selected)
        self.session_list.new_session_requested.connect(self._new_session)
        right_layout.addWidget(self.session_list)

        self.right_tabs = QTabWidget()

        # Tab 1: Shots (simplified - just the gallery)
        shots_tab = QWidget()
        shots_layout = QVBoxLayout(shots_tab)

        self.gallery = ClipGallery()
        self.gallery.clip_selected.connect(self._on_clip_selected)
        self.gallery.clip_deleted.connect(self._on_clip_delete_requested)
        self.gallery.clip_mark_not_shot.connect(self._on_mark_not_shot_requested)
        self.gallery.clip_pin_toggled.connect(self._on_clip_pin_toggled)
        self.gallery.clip_share_requested.connect(self._on_clip_share_requested)
        shots_layout.addWidget(self.gallery, stretch=1)

        self.right_tabs.addTab(shots_tab, "Shots")

        # Tab 2: Detection
        detection_tab = QWidget()
        det_layout = QVBoxLayout(detection_tab)

        self.auto_ready_check = QCheckBox("Auto-Ready (Person Detection)")
        self.auto_ready_check.setChecked(self.config.auto_ready_enabled)
        self.auto_ready_check.setStyleSheet("color: #d4d4d4;")
        self.auto_ready_check.toggled.connect(self._on_auto_ready_toggled)
        det_layout.addWidget(self.auto_ready_check)

        self.person_status_label = QLabel("Person: Not detected")
        self.person_status_label.setStyleSheet("color: #666; font-size: 11px; padding: 2px 0;")
        det_layout.addWidget(self.person_status_label)

        det_layout.addWidget(QLabel("Audio Classifier:"))
        self.classifier_mode_label = QLabel("Mode: heuristic")
        self.classifier_mode_label.setStyleSheet("color: #666; font-size: 11px; padding: 2px 0;")
        det_layout.addWidget(self.classifier_mode_label)

        self.training_count_label = QLabel("Training samples: 0")
        self.training_count_label.setStyleSheet("color: #666; font-size: 11px; padding: 2px 0;")
        det_layout.addWidget(self.training_count_label)

        self.last_confidence_label = QLabel("Last trigger confidence: --")
        self.last_confidence_label.setStyleSheet("color: #666; font-size: 11px; padding: 2px 0;")
        det_layout.addWidget(self.last_confidence_label)

        self.retrain_btn = QPushButton("Retrain Classifier")
        self.retrain_btn.clicked.connect(self._retrain_classifier)
        det_layout.addWidget(self.retrain_btn)

        det_layout.addStretch()
        self.right_tabs.addTab(detection_tab, "Detection")

        # Tab 3: Settings
        settings_tab = QWidget()
        settings_layout = QVBoxLayout(settings_tab)

        # Audio Settings group
        audio_group = QGroupBox("Audio Settings")
        audio_group_layout = QVBoxLayout(audio_group)

        audio_dev_row = QHBoxLayout()
        audio_dev_row.addWidget(QLabel("Audio Device:"))
        self.audio_device_combo = QComboBox()
        self.audio_device_combo.addItem("Default", None)
        virtual_mic_index = None
        for dev in enumerate_audio_devices():
            name = dev["name"][:30]
            if dev.get("is_virtual"):
                name += " (phone mic)"
            self.audio_device_combo.addItem(name, dev["index"])
            if dev.get("is_virtual") and virtual_mic_index is None:
                virtual_mic_index = self.audio_device_combo.count() - 1
        if self.config.audio_device_index is not None:
            # Try matching by saved device name first (indices shift across reboots)
            matched = False
            if self.config.audio_device_name:
                for i in range(self.audio_device_combo.count()):
                    if self.config.audio_device_name in (self.audio_device_combo.itemText(i) or ""):
                        self.audio_device_combo.setCurrentIndex(i)
                        self.config.audio_device_index = self.audio_device_combo.itemData(i)
                        matched = True
                        break
            # Fall back to saved index
            if not matched:
                for i in range(self.audio_device_combo.count()):
                    if self.audio_device_combo.itemData(i) == self.config.audio_device_index:
                        self.audio_device_combo.setCurrentIndex(i)
                        break
        elif virtual_mic_index is not None:
            # Auto-select phone virtual mic when no device is configured
            self.audio_device_combo.setCurrentIndex(virtual_mic_index)
            self.config.audio_device_index = self.audio_device_combo.itemData(virtual_mic_index)
            logger.info("Auto-selected virtual phone mic: %s",
                        self.audio_device_combo.currentText())
        self.audio_device_combo.currentIndexChanged.connect(self._on_audio_device_changed)
        audio_dev_row.addWidget(self.audio_device_combo, stretch=1)

        refresh_audio_btn = QPushButton("Refresh")
        refresh_audio_btn.setToolTip("Rescan audio devices (use after connecting DroidCam or other virtual mic)")
        refresh_audio_btn.setFixedWidth(70)
        refresh_audio_btn.clicked.connect(self._refresh_audio_devices)
        audio_dev_row.addWidget(refresh_audio_btn)

        self.test_mic_btn = QPushButton("Test")
        self.test_mic_btn.setToolTip("Preview audio level from the selected mic (auto-starts on device change)")
        self.test_mic_btn.setFixedWidth(50)
        self.test_mic_btn.clicked.connect(self._test_mic)
        audio_dev_row.addWidget(self.test_mic_btn)

        audio_group_layout.addLayout(audio_dev_row)

        self.mic_preview_bar = QProgressBar()
        self.mic_preview_bar.setMaximum(100)
        self.mic_preview_bar.setTextVisible(False)
        self.mic_preview_bar.setFixedHeight(12)
        self._mic_preview_level = 0
        self._update_mic_bar_style()
        audio_group_layout.addWidget(self.mic_preview_bar)

        self._mic_preview: Optional[MicPreview] = None

        thr_row = QHBoxLayout()
        thr_row.addWidget(QLabel("Threshold:"))
        self.threshold_slider = QSlider(Qt.Orientation.Horizontal)
        self.threshold_slider.setMinimum(1)
        self.threshold_slider.setMaximum(100)
        self.threshold_slider.setValue(int(self.config.audio_threshold * 100))
        self.threshold_slider.valueChanged.connect(self._on_threshold_changed)
        thr_row.addWidget(self.threshold_slider, stretch=1)
        self.threshold_label = QLabel(f"{int(self.config.audio_threshold * 100)}%")
        self.threshold_label.setFixedWidth(35)
        thr_row.addWidget(self.threshold_label)
        audio_group_layout.addLayout(thr_row)

        conf_row = QHBoxLayout()
        conf_row.addWidget(QLabel("Confidence:"))
        self.confidence_bar = QProgressBar()
        self.confidence_bar.setMaximum(100)
        self.confidence_bar.setTextVisible(True)
        self.confidence_bar.setStyleSheet("""
            QProgressBar { background-color: #252525; border: none; border-radius: 3px; color: #d4d4d4; font-size: 11px; }
            QProgressBar::chunk { background-color: #34d17e; border-radius: 3px; }
        """)
        conf_row.addWidget(self.confidence_bar, stretch=1)
        audio_group_layout.addLayout(conf_row)

        settings_layout.addWidget(audio_group)

        # Camera Settings group
        camera_group = QGroupBox("Camera Settings")
        camera_group_layout = QVBoxLayout(camera_group)

        self.camera_btn = QPushButton("Configure Cameras")
        self.camera_btn.clicked.connect(self._show_camera_settings)
        camera_group_layout.addWidget(self.camera_btn)

        self.test_camera_btn = QPushButton("Start Test Camera")
        self.test_camera_btn.setToolTip("Start a mock MJPEG camera on localhost for testing/demo")
        self.test_camera_btn.clicked.connect(self._toggle_test_camera)
        camera_group_layout.addWidget(self.test_camera_btn)

        self.camera_status = QLabel("Starting...")
        self.camera_status.setStyleSheet("color: #9a9a9a;")
        camera_group_layout.addWidget(self.camera_status)

        settings_layout.addWidget(camera_group)

        # Session group
        session_group = QGroupBox("Session")
        session_group_layout = QVBoxLayout(session_group)

        save_loc_row = QHBoxLayout()
        save_loc_row.addWidget(QLabel("Save Location:"))
        self.save_loc_label = QLabel(str(self.config.resolved_base_dir))
        self.save_loc_label.setStyleSheet("color: #666; font-size: 11px;")
        self.save_loc_label.setWordWrap(True)
        save_loc_row.addWidget(self.save_loc_label, stretch=1)
        change_loc_btn = QPushButton("Change...")
        change_loc_btn.setFixedWidth(80)
        change_loc_btn.clicked.connect(self._change_save_location)
        save_loc_row.addWidget(change_loc_btn)
        session_group_layout.addLayout(save_loc_row)

        self.open_folder_btn = QPushButton("Open Folder")
        self.open_folder_btn.clicked.connect(self._open_session_folder)
        session_group_layout.addWidget(self.open_folder_btn)

        self.new_session_btn = QPushButton("New Session")
        self.new_session_btn.clicked.connect(self._new_session)
        session_group_layout.addWidget(self.new_session_btn)

        settings_layout.addWidget(session_group)

        settings_layout.addStretch()
        self.right_tabs.addTab(settings_tab, "Settings")

        # Tab 4: Log
        self.log_panel = LogPanel()
        self.log_handler.signal.connect(self.log_panel.append_log)
        self.right_tabs.addTab(self.log_panel, "Log")

        right_layout.addWidget(self.right_tabs, stretch=1)
        main_layout.addWidget(right_panel)

        # Status bar
        self.statusBar().setStyleSheet("color: #555;")
        self.statusBar().showMessage(f"Session: {self.config.session_folder}")

    # ------------------------------------------------------------------
    # Timers
    # ------------------------------------------------------------------

    def _setup_timers(self):
        self.display_timer = QTimer()
        self.display_timer.timeout.connect(self._update_display)
        self.display_timer.start(33)

        self.recording_timer = QTimer()
        self.recording_timer.timeout.connect(self._check_recording)
        self.recording_timer.start(100)

        self.playback_timer = QTimer()
        self.playback_timer.timeout.connect(self._playback_tick)

        # Retry dead camera threads every 10 seconds
        self._camera_retry_timer = QTimer()
        self._camera_retry_timer.timeout.connect(self._retry_dead_cameras)
        self._camera_retry_timer.start(10000)

    # ------------------------------------------------------------------
    # Keyboard Shortcuts
    # ------------------------------------------------------------------

    def _setup_shortcuts(self):
        shortcuts = {
            "Space": self._toggle_playback_shortcut,
            "Left": self._step_back,
            "Right": self._step_forward,
            "A": self._shortcut_toggle_armed,
            "T": self._manual_trigger,
            "[": self._decrease_speed,
            "]": self._increase_speed,
            "P": self._toggle_pip,
            "Delete": self._delete_selected_shape,
            "Escape": self._deselect_drawing,
            "1": lambda: self._set_drawing_mode("select"),
            "2": lambda: self._set_drawing_mode("line"),
            "3": lambda: self._set_drawing_mode("circle"),
            "?": self._show_help,
        }
        for key, callback in shortcuts.items():
            sc = QShortcut(QKeySequence(key), self)
            sc.activated.connect(callback)

    def _toggle_playback_shortcut(self):
        self.play_btn.setChecked(not self.play_btn.isChecked())
        self._toggle_playback()

    def _shortcut_toggle_armed(self):
        self.arm_btn.setChecked(not self.arm_btn.isChecked())
        self._toggle_armed()

    def _decrease_speed(self):
        idx = self.speed_combo.currentIndex()
        if idx > 0:
            self.speed_combo.setCurrentIndex(idx - 1)

    def _increase_speed(self):
        idx = self.speed_combo.currentIndex()
        if idx < self.speed_combo.count() - 1:
            self.speed_combo.setCurrentIndex(idx + 1)

    def _show_help(self):
        dlg = KeyboardHelpOverlay(self)
        dlg.exec()

    # ------------------------------------------------------------------
    # Camera Management
    # ------------------------------------------------------------------

    def _find_phone_preset(self) -> Optional[CameraPreset]:
        """Return the first network camera preset, or None."""
        for p in self.config.cameras:
            if p.type == "network":
                return p
        return None

    def _on_phone_btn_clicked(self):
        """Handle phone button click based on current state."""
        preset = self._find_phone_preset()
        if preset is None:
            # No phone saved — open NetworkCameraDialog to add one
            dlg = NetworkCameraDialog(self)
            url_holder = {}

            def on_added(url, label):
                url_holder["url"] = url
                url_holder["label"] = label

            dlg.camera_added.connect(on_added)
            dlg.exec()

            if "url" in url_holder:
                new_preset = CameraPreset(
                    id=url_holder["url"], type="network", label=url_holder["label"]
                )
                self.config.cameras.append(new_preset)
                save_settings(self.config)
                self._start_camera(new_preset)
                self.live_visible_cameras.add(new_preset.id)
                self._rebuild_camera_dropdown()
                self._set_phone_btn_state("connecting")
                self._update_camera_status()
            return

        # Phone preset exists
        cam_id = preset.id
        if cam_id in self.current_frames:
            # Connected and has frames
            fps = self.camera_fps.get(cam_id)
            fps_str = f" ({fps:.0f} fps)" if fps else ""
            self.statusBar().showMessage(f"Phone connected{fps_str}", 3000)
            return

        if cam_id in self.camera_captures:
            # Thread exists but no frames yet — already reconnecting
            self._set_phone_btn_state("connecting")
            self.statusBar().showMessage("Phone connecting...", 2000)
            return

        # No thread — start camera
        self._start_camera(preset)
        self._set_phone_btn_state("connecting")

    def _set_phone_btn_state(self, state: str):
        """Update phone button appearance based on connection state."""
        styles = {
            "idle": ("color: #9a9a9a; border-color: #3a3a3a;", None),
            "connecting": ("color: #f0c040; border-color: #f0c040;", "Connecting..."),
            "connected": ("color: #34d17e; border-color: #34d17e;", "Phone Connected"),
            "disconnected": ("color: #e84c3c; border-color: #e84c3c;", "Reconnect Phone"),
        }
        style, text = styles.get(state, styles["idle"])
        self.phone_btn.setStyleSheet(
            f"QPushButton {{ {style} background-color: #333333; border: 1px solid; "
            f"border-radius: 6px; padding: 6px 14px; font-size: 12px; }}"
            f"QPushButton:hover {{ background-color: #4d4d4d; }}"
        )
        if text:
            self.phone_btn.setText(text)
        else:
            # idle — text depends on whether a phone preset exists
            preset = self._find_phone_preset()
            self.phone_btn.setText("Connect Phone" if preset else "Add Phone")

        # "connected" reverts to idle after 3 seconds
        if state == "connected":
            QTimer.singleShot(3000, lambda: self._set_phone_btn_state("idle"))

    def _on_camera_connection_state(self, camera_id, state: str):
        """Handle connection state changes from camera threads."""
        # Rebuild dropdown and update status for ALL cameras
        self._rebuild_camera_dropdown()
        self._update_camera_status()
        # Update phone button for phone camera
        preset = self._find_phone_preset()
        if preset is not None and camera_id == preset.id:
            self._set_phone_btn_state(state)

    def _refresh_phone_btn_state(self):
        """Set phone button state based on current camera status."""
        preset = self._find_phone_preset()
        if preset is None:
            self._set_phone_btn_state("idle")
            return
        cam_id = preset.id
        if cam_id in self.current_frames:
            self._set_phone_btn_state("connected")
        elif cam_id in self.camera_captures:
            self._set_phone_btn_state("connecting")
        else:
            self._set_phone_btn_state("idle")

    def _start_cameras(self):
        """Start cameras from config (or default)."""
        if not self.config.cameras:
            self.config.cameras = [CameraPreset(id=0, type="usb", label="Default")]
            self.config.primary_camera = 0

        for preset in self.config.cameras:
            self._start_camera(preset)

        # Show only the primary camera initially
        self.live_visible_cameras = {self.config.primary_camera}
        self._rebuild_camera_dropdown()
        self._update_camera_status()
        self._refresh_phone_btn_state()

    def _start_camera(self, preset: CameraPreset):
        cam_id = preset.id
        if cam_id in self.camera_captures:
            return

        capture = CameraCapture(cam_id, self.config.fps, preset)
        capture.frame_ready.connect(self._on_frame_ready)
        capture.fps_update.connect(self._on_fps_update)
        capture.connection_state.connect(self._on_camera_connection_state)
        capture.start()
        self.camera_captures[cam_id] = capture

        self.frame_buffers[cam_id] = FrameBuffer(
            self.config.pre_trigger_seconds, self.config.fps
        )
        logger.info("Started camera: %s (%s)", preset.label or cam_id, preset.type)

    def _stop_camera(self, cam_id):
        if cam_id in self.camera_captures:
            self.camera_captures[cam_id].stop()
            del self.camera_captures[cam_id]
            if cam_id in self.frame_buffers:
                del self.frame_buffers[cam_id]
            # Clean up stale frame references
            self.current_frames.pop(cam_id, None)
            self.camera_fps.pop(cam_id, None)
            self.live_visible_cameras.discard(cam_id)
            self._rebuild_camera_dropdown()
            self._sync_pip_cameras()

    def _retry_dead_cameras(self):
        """Restart camera threads that have exited (failed to open or crashed).

        Runs on a 10-second timer so cameras plugged in or started after the
        app launches (e.g. DroidCam) are picked up automatically.
        """
        restarted = False
        for preset in self.config.cameras:
            cam_id = preset.id
            capture = self.camera_captures.get(cam_id)
            if capture is not None and not capture.isRunning():
                # Thread exists but has exited — clean up and restart
                logger.info("Camera %s thread died, restarting...", preset.label or cam_id)
                del self.camera_captures[cam_id]
                self.frame_buffers.pop(cam_id, None)
                self.current_frames.pop(cam_id, None)
                self.camera_fps.pop(cam_id, None)
                self._start_camera(preset)
                restarted = True

        if restarted:
            self._update_camera_status()
            # Re-check device status after a few seconds to auto-dismiss warning
            QTimer.singleShot(5000, self._check_device_status)

    def _on_fps_update(self, camera_id, fps: float):
        self.camera_fps[camera_id] = fps
        self._update_camera_status()

    def _update_camera_status(self):
        parts = []
        for p in self.config.cameras:
            label = p.label or str(p.id)
            fps = self.camera_fps.get(p.id)
            has_frames = p.id in self.current_frames
            if fps is not None and has_frames:
                parts.append(f"[OK] {label} ({fps:.0f} fps)")
            elif has_frames:
                parts.append(f"[OK] {label}")
            else:
                parts.append(f"[--] {label}")
        self.camera_status.setText(" | ".join(parts))

    def _toggle_test_camera(self):
        """Start/stop a mock MJPEG camera server for testing."""
        if self._test_camera_server is not None:
            self._test_camera_server.stop()
            self._test_camera_server = None
            self.test_camera_btn.setText("Start Test Camera")
            logger.info("Test camera server stopped")
            return

        try:
            from tests.mock_camera_server import MockCameraServer
            self._test_camera_server = MockCameraServer(port=4747, fps=30)
            self._test_camera_server.start()
            url = self._test_camera_server.url + "/mjpegfeed"
            self.test_camera_btn.setText("Stop Test Camera")
            logger.info("Test camera server started at %s", url)

            QMessageBox.information(
                self, "Test Camera",
                f"Mock camera running at:\n{url}\n\n"
                "Add this as a network camera to test the app.",
            )
        except Exception as e:
            logger.error("Failed to start test camera: %s", e)
            QMessageBox.warning(self, "Error", f"Failed to start test camera:\n{e}")

    # ------------------------------------------------------------------
    # Audio Management
    # ------------------------------------------------------------------

    def _start_audio(self):
        if not AUDIO_AVAILABLE:
            return

        if self.audio_detector is None:
            self.audio_detector = AudioDetector(self.config)
            self.audio_detector.trigger_detected.connect(self._on_audio_trigger)
            self.audio_detector.level_update.connect(self._on_audio_level)

        dev_idx = self.audio_device_combo.currentData()
        self.audio_detector.set_device_index(dev_idx)

        if not self.audio_detector.isRunning():
            self.audio_detector.start()

    def _stop_audio(self):
        if self.audio_detector:
            self.audio_detector.stop()
            self.audio_detector = None

    def _on_audio_device_changed(self, idx):
        dev_idx = self.audio_device_combo.currentData()
        self.config.audio_device_index = dev_idx
        # Save device name for reliable matching across reboots (indices can shift)
        self.config.audio_device_name = self.audio_device_combo.currentText() or ""
        save_settings(self.config)
        # Restart audio if armed
        if self.is_armed:
            self._stop_audio()
            self._start_audio()
        else:
            # Auto-start mic preview so user can see levels immediately
            self._start_mic_preview()

    def _refresh_audio_devices(self):
        """Rescan audio devices and update the combo box."""
        current_idx = self.audio_device_combo.currentData()
        self.audio_device_combo.blockSignals(True)
        self.audio_device_combo.clear()
        self.audio_device_combo.addItem("Default", None)
        virtual_mic_index = None
        for dev in enumerate_audio_devices():
            name = dev["name"][:30]
            if dev.get("is_virtual"):
                name += " (phone mic)"
            self.audio_device_combo.addItem(name, dev["index"])
            if dev.get("is_virtual") and virtual_mic_index is None:
                virtual_mic_index = self.audio_device_combo.count() - 1

        # Try to re-select previously selected device
        restored = False
        if current_idx is not None:
            for i in range(self.audio_device_combo.count()):
                if self.audio_device_combo.itemData(i) == current_idx:
                    self.audio_device_combo.setCurrentIndex(i)
                    restored = True
                    break
        if not restored and virtual_mic_index is not None:
            self.audio_device_combo.setCurrentIndex(virtual_mic_index)
            self.config.audio_device_index = self.audio_device_combo.itemData(virtual_mic_index)
            logger.info("Auto-selected virtual phone mic: %s",
                        self.audio_device_combo.currentText())
        self.audio_device_combo.blockSignals(False)
        logger.info("Audio devices refreshed, %d devices found",
                    self.audio_device_combo.count() - 1)

    def _test_mic(self):
        """Toggle mic preview on/off."""
        if self._mic_preview is not None and self._mic_preview.isRunning():
            self._stop_mic_preview()
        else:
            self._start_mic_preview()

    def _start_mic_preview(self):
        """Start continuous mic preview on the currently selected device."""
        # Stop any existing preview first
        if self._mic_preview is not None and self._mic_preview.isRunning():
            self._mic_preview.stop()
            self._mic_preview.wait(2000)
        dev_idx = self.audio_device_combo.currentData()
        self._mic_preview = MicPreview(device_index=dev_idx, duration=0)
        self._mic_preview.level_update.connect(self._on_mic_preview_level)
        self._mic_preview.finished_preview.connect(self._on_mic_preview_finished)
        self.test_mic_btn.setText("Stop")
        self._mic_preview.start()

    def _stop_mic_preview(self):
        """Stop the running mic preview."""
        if self._mic_preview is not None and self._mic_preview.isRunning():
            self._mic_preview.stop()

    def _on_mic_preview_level(self, level: float):
        self._mic_preview_level = int(level * 100)
        self.mic_preview_bar.setValue(self._mic_preview_level)
        self._update_mic_bar_style()

    def _on_mic_preview_finished(self):
        self.test_mic_btn.setText("Test")
        self.mic_preview_bar.setValue(0)
        self._mic_preview_level = 0
        self._update_mic_bar_style()
        self._mic_preview = None

    def _update_mic_bar_style(self):
        """Update level bar color: green below threshold, red at/above threshold."""
        threshold_pct = int(self.config.audio_threshold * 100)
        level = self._mic_preview_level
        if level >= threshold_pct and level > 0:
            color = "#e84c3c"  # red — above threshold
        elif level > threshold_pct * 0.5 and level > 0:
            color = "#f0c040"  # yellow — approaching threshold
        else:
            color = "#4fc3f7"  # blue — below threshold
        self.mic_preview_bar.setStyleSheet(f"""
            QProgressBar {{ background-color: #252525; border: none; border-radius: 4px; }}
            QProgressBar::chunk {{ background-color: {color}; border-radius: 4px; }}
        """)

    # ------------------------------------------------------------------
    # Frame Handling
    # ------------------------------------------------------------------

    def _on_frame_ready(self, camera_id, frame: np.ndarray, timestamp: float):
        is_new = camera_id not in self.current_frames
        self.current_frames[camera_id] = frame.copy()

        if is_new:
            # Camera just connected — add to visible set and refresh dropdown
            self.live_visible_cameras.add(camera_id)
            self._rebuild_camera_dropdown()
            self._sync_pip_cameras()

        if self.is_armed and camera_id in self.frame_buffers:
            self.frame_buffers[camera_id].add_frame(frame, timestamp)

        if self.is_recording:
            if camera_id not in self.recorded_frames:
                self.recorded_frames[camera_id] = []
            self.recorded_frames[camera_id].append((frame.copy(), timestamp))

        # Person detection on primary camera
        if camera_id == self.config.primary_camera and self.config.auto_ready_enabled:
            try:
                state_change = self.person_detector.check(frame)
                if state_change is not None:
                    self._on_person_state_changed(state_change)
            except Exception as e:
                logger.debug("Person detection error: %s", e)

    def _on_person_state_changed(self, present: bool):
        self.person_detected = present
        # Check if user is reviewing a clip (playback loaded) — suppress
        # auto-arm/disarm toggling so the user can freely play/pause/scrub
        # without losing armed state or getting unexpectedly re-armed.
        has_playback = self.playback_frames or (self.playback_multi_view and self.playback_all_frames)
        if present:
            self.person_status_label.setText("Person: DETECTED")
            self.person_status_label.setStyleSheet("color: #34d17e; font-size: 11px; padding: 2px 0;")
            logger.info("Person detected - auto-arming")
            if not self.is_armed and not has_playback:
                self.arm_btn.setChecked(True)
                self._toggle_armed()
        else:
            self.person_status_label.setText("Person: Not detected")
            self.person_status_label.setStyleSheet("color: #666; font-size: 11px; padding: 2px 0;")
            logger.info("Person left - auto-disarming")
            if self.is_armed and not self.is_recording and not has_playback:
                self.arm_btn.setChecked(False)
                self._toggle_armed()

    # ------------------------------------------------------------------
    # Audio Trigger Handling
    # ------------------------------------------------------------------

    def _on_audio_trigger(self, confidence: float, features: dict):
        self.last_trigger_confidence = confidence
        self.last_trigger_timestamp = int(time.time() * 1000)
        self.confidence_bar.setValue(int(confidence * 100))
        self.last_confidence_label.setText(f"Last trigger confidence: {confidence:.0%}")

        if self.is_armed and not self.is_recording:
            logger.info("Trigger! confidence=%.2f", confidence)
            self._start_recording()

    def _on_audio_level(self, level: float):
        self.audio_level.setValue(int(level * 100))

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    def _start_recording(self):
        if self.is_recording:
            return

        self.is_recording = True
        self.recording_start_time = time.time()
        self.recorded_frames = {}

        # Grab pre-trigger buffers from all cameras that have frames
        for cam_id, buffer in self.frame_buffers.items():
            frames = buffer.get_frames()
            if frames:
                self.recorded_frames[cam_id] = frames
            else:
                # Camera configured but no frames yet - initialize empty list
                # so post-trigger frames still get captured
                self.recorded_frames[cam_id] = []
                logger.debug("Camera %s has no pre-trigger frames", cam_id)

        self.status_label.setText("\u25cf  Recording...")
        self.status_label.setStyleSheet(
            "QLabel { background-color: transparent; padding: 4px 8px; font-size: 12px; "
            "font-weight: 600; color: #e84c3c; }"
        )
        logger.info("Recording started (%d cameras)", len(self.recorded_frames))

    def _check_recording(self):
        if self.is_recording:
            elapsed = time.time() - self.recording_start_time
            if elapsed >= self.config.post_trigger_seconds:
                self._stop_recording()

    def _stop_recording(self):
        self.is_recording = False

        # Build camera labels from config
        camera_labels = {}
        for preset in self.config.cameras:
            camera_labels[str(preset.id)] = preset.label or str(preset.id)

        # Attach trigger timestamp for training data association
        clip_info = self.recording_manager.save_clip(
            self.recorded_frames, self.config.primary_camera, camera_labels
        )

        if clip_info:
            if self.last_trigger_timestamp:
                clip_info["trigger_timestamp"] = self.last_trigger_timestamp
                self.recording_manager._save_clips_metadata()

            thumb_file = clip_info.get("thumbnail")
            thumb_path = Path(self.recording_manager.session_folder) / thumb_file if thumb_file else None
            self.gallery.add_clip(clip_info, thumb_path)

            visible = self.recording_manager.get_visible_clips()
            self._load_clip_for_playback(len(visible) - 1)

        self.status_label.setText("\u25cf  Shot captured! Waiting for next shot...")
        self.status_label.setStyleSheet(
            "QLabel { background-color: transparent; padding: 4px 8px; font-size: 12px; "
            "font-weight: normal; color: #34d17e; }"
        )

        for buffer in self.frame_buffers.values():
            buffer.clear()

        logger.info("Recording stopped, clip saved")

    # ------------------------------------------------------------------
    # Display
    # ------------------------------------------------------------------

    def _render_drawings_on_frame(self, frame: np.ndarray) -> np.ndarray:
        """Burn drawing overlay shapes onto a frame copy for PiP."""
        shapes = self.drawing_overlay.shapes
        if not shapes:
            return frame
        out = frame.copy()
        h, w = out.shape[:2]
        for shape in shapes:
            color_hex = shape.color.lstrip("#")
            r, g, b = int(color_hex[0:2], 16), int(color_hex[2:4], 16), int(color_hex[4:6], 16)
            bgr = (b, g, r)
            t = max(1, shape.thickness)
            if hasattr(shape, "x1"):  # LineShape
                rx1, ry1, rx2, ry2 = shape._get_rotated_points()
                pt1 = (int(rx1 * w), int(ry1 * h))
                pt2 = (int(rx2 * w), int(ry2 * h))
                cv2.line(out, pt1, pt2, bgr, t, cv2.LINE_AA)
            elif hasattr(shape, "cx"):  # CircleShape
                center = (int(shape.cx * w), int(shape.cy * h))
                radius = int(shape.radius * max(w, h))
                cv2.circle(out, center, radius, bgr, t, cv2.LINE_AA)
        return out

    def _update_display(self):
        has_playback = self.playback_frames or (self.playback_multi_view and self.playback_all_frames)

        if self.is_playing and has_playback:
            # Animated playback
            frame = self._get_playback_frame()
            self.video_player.display_frame(frame)

            if self.pip_window and self.pip_window.isVisible():
                self.pip_window.display_frame(self._render_drawings_on_frame(frame))

        elif has_playback:
            # Paused on a clip — hold the current playback frame
            frame = self._get_playback_frame()
            if frame is not None:
                self.video_player.display_frame(frame)
                if self.pip_window and self.pip_window.isVisible():
                    self.pip_window.display_frame(self._render_drawings_on_frame(frame))

        else:
            # Live feed — show one camera at a time
            visible_cams = {cid: f.copy() for cid, f in self.current_frames.items()
                           if cid in self.live_visible_cameras}

            if visible_cams:
                frame = next(iter(visible_cams.values()))
                if self.is_recording:
                    cv2.circle(frame, (50, 50), 20, (0, 0, 255), -1)
                    cv2.putText(frame, "REC", (80, 60),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                elif self.is_armed:
                    cv2.circle(frame, (50, 50), 20, (0, 255, 255), -1)
                    cv2.putText(frame, "ARMED", (80, 60),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
                self.video_player.display_frame(frame)
            elif self.camera_captures:
                placeholder = np.zeros((720, 1280, 3), dtype=np.uint8)
                cv2.putText(placeholder, "Waiting for camera...", (400, 360),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.2, (74, 158, 255), 2)
                self.video_player.display_frame(placeholder)

            # Update PiP with per-camera frames (with drawings burned in)
            if self.pip_window and self.pip_window.isVisible() and visible_cams:
                for cid, f in visible_cams.items():
                    self.pip_window.display_frame(
                        self._render_drawings_on_frame(f), camera_id=str(cid)
                    )

        # Keep drawing overlay sized to video player
        self.drawing_overlay.setGeometry(self.video_player.geometry())
        vr = self.video_player.video_rect
        self.drawing_overlay.set_video_rect(*vr)

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    def _playback_tick(self):
        if self.playback_multi_view:
            max_frames = max((len(f) for f in self.playback_all_frames.values()), default=0)
            if max_frames == 0:
                return
            self.playback_position = (self.playback_position + 1) % max_frames
            self.playback_slider.blockSignals(True)
            self.playback_slider.setValue(self.playback_position)
            self.playback_slider.blockSignals(False)
            self.frame_label.setText(f"{self.playback_position + 1} / {max_frames}")
        else:
            if not self.playback_frames:
                return
            self.playback_position = (self.playback_position + 1) % len(self.playback_frames)
            self.playback_slider.blockSignals(True)
            self.playback_slider.setValue(self.playback_position)
            self.playback_slider.blockSignals(False)
            self.frame_label.setText(f"{self.playback_position + 1} / {len(self.playback_frames)}")

    def _toggle_playback(self):
        has_frames = self.playback_frames or (self.playback_multi_view and self.playback_all_frames)
        if self.play_btn.isChecked():
            if has_frames:
                self.is_playing = True
                interval = max(8, int(33 / self.playback_speed))
                self.playback_timer.start(interval)
                self.play_btn.setText("Pause")
        else:
            self.is_playing = False
            self.playback_timer.stop()
            self.play_btn.setText("Play")

    def _on_slider_changed(self, value: int):
        self.playback_position = value
        frame = self._get_playback_frame()
        if frame is not None:
            self.video_player.display_frame(frame)
            if self.playback_multi_view:
                max_frames = max((len(f) for f in self.playback_all_frames.values()), default=0)
                self.frame_label.setText(f"{value + 1} / {max_frames}")
            else:
                self.frame_label.setText(f"{value + 1} / {len(self.playback_frames)}")
            if self.pip_window and self.pip_window.isVisible():
                self.pip_window.display_frame(frame)

    def _on_speed_changed(self, index: int):
        self.playback_speed = self.speed_combo.currentData() or 1.0
        self.config.playback_speed = self.playback_speed
        self._save_debounce_timer.start()
        if self.is_playing:
            interval = max(8, int(33 / self.playback_speed))
            self.playback_timer.setInterval(interval)

    def _step_back(self):
        if not self.playback_frames:
            return
        if self.is_playing:
            self.play_btn.setChecked(False)
            self._toggle_playback()
        self.playback_position = max(0, self.playback_position - 1)
        self.playback_slider.setValue(self.playback_position)
        self._show_current_frame()

    def _step_forward(self):
        if not self.playback_frames:
            return
        if self.is_playing:
            self.play_btn.setChecked(False)
            self._toggle_playback()
        self.playback_position = min(len(self.playback_frames) - 1, self.playback_position + 1)
        self.playback_slider.setValue(self.playback_position)
        self._show_current_frame()

    def _get_playback_frame(self) -> Optional[np.ndarray]:
        """Get the current playback frame, handling multi-view grid."""
        if self.playback_multi_view and len(self.playback_all_frames) > 1:
            # Composite grid of all cameras
            current_frames = {}
            for cam_id, frames in self.playback_all_frames.items():
                idx = min(self.playback_position, len(frames) - 1)
                if idx >= 0:
                    current_frames[cam_id] = frames[idx]
            if current_frames:
                return composite_grid(current_frames, self.playback_camera_labels)
            return None
        elif self.playback_frames and 0 <= self.playback_position < len(self.playback_frames):
            return self.playback_frames[self.playback_position]
        return None

    def _show_current_frame(self):
        frame = self._get_playback_frame()
        if frame is not None:
            self.video_player.display_frame(frame)
            if self.playback_multi_view:
                max_frames = max((len(f) for f in self.playback_all_frames.values()), default=0)
                self.frame_label.setText(f"{self.playback_position + 1} / {max_frames}")
            else:
                self.frame_label.setText(f"{self.playback_position + 1} / {len(self.playback_frames)}")
            if self.pip_window and self.pip_window.isVisible():
                self.pip_window.display_frame(frame)

    def _load_clip_for_playback(self, index: int):
        visible = self.recording_manager.get_visible_clips()
        if index < 0 or index >= len(visible):
            return
        clip = visible[index]

        clip_path = self.recording_manager.get_clip_path(index)
        if not clip_path or not clip_path.exists():
            return

        self.is_playing = False
        self.playback_timer.stop()
        self.play_btn.setChecked(False)
        self.play_btn.setText("Play")

        # Load all camera angles
        self.playback_all_frames.clear()
        self.playback_camera_labels = clip.get("camera_labels", {})
        self.playback_multi_view = False

        try:
            camera_files = clip.get("camera_files", {})
            primary_cam_id = None

            if camera_files:
                for cam_id, filename in camera_files.items():
                    path = Path(self.recording_manager.session_folder) / filename
                    if not path.exists():
                        continue
                    frames = []
                    cap = cv2.VideoCapture(str(path))
                    try:
                        while True:
                            ret, frame = cap.read()
                            if not ret:
                                break
                            frames.append(frame)
                    finally:
                        cap.release()
                    if frames:
                        self.playback_all_frames[cam_id] = frames

                    # Identify the primary camera id (the one whose filename matches clip["file"])
                    if filename == clip["file"]:
                        primary_cam_id = cam_id
            else:
                # Single camera clip - load from primary file
                frames = []
                cap = cv2.VideoCapture(str(clip_path))
                try:
                    while True:
                        ret, frame = cap.read()
                        if not ret:
                            break
                        frames.append(frame)
                finally:
                    cap.release()
                if frames:
                    self.playback_all_frames["primary"] = frames
                    primary_cam_id = "primary"
        except Exception as e:
            logger.error("Failed to load clip for playback: %s", e)
            self._clear_playback()
            return

        # Set active camera to primary
        self.playback_active_camera = primary_cam_id or (list(self.playback_all_frames.keys())[0] if self.playback_all_frames else None)

        # Set playback_frames to active camera for compatibility
        if self.playback_active_camera and self.playback_active_camera in self.playback_all_frames:
            self.playback_frames = self.playback_all_frames[self.playback_active_camera]
        else:
            self.playback_frames = []

        # Build angle buttons
        self._build_angle_buttons(clip)

        if self.playback_frames:
            self.playback_position = 0
            self.playback_slider.setMaximum(len(self.playback_frames) - 1)
            self.playback_slider.setValue(0)
            self.frame_label.setText(f"1 / {len(self.playback_frames)}")
            self.playback_clip_index = index
            self._update_pip_shot_info()

            self.play_btn.setChecked(True)
            self._toggle_playback()
            self._update_live_btn_style()

    # ------------------------------------------------------------------
    # Multi-Angle Playback
    # ------------------------------------------------------------------

    def _build_angle_buttons(self, clip_info: dict):
        """Create angle selector buttons from clip metadata."""
        # Clear existing buttons
        for btn in self.angle_buttons:
            self.angle_bar_layout.removeWidget(btn)
            btn.deleteLater()
        self.angle_buttons.clear()
        if self.multi_view_btn:
            self.angle_bar_layout.removeWidget(self.multi_view_btn)
            self.multi_view_btn.deleteLater()
            self.multi_view_btn = None

        # Hide if only one camera
        if len(self.playback_all_frames) <= 1:
            self.angle_bar.setVisible(False)
            return

        self.angle_bar.setVisible(True)

        btn_style = """
            QPushButton {
                background-color: #333333; color: #d4d4d4;
                border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px 12px; font-size: 12px;
            }
            QPushButton:hover { background-color: #4d4d4d; }
            QPushButton:checked { background-color: #4a9eff; color: white; border-color: #4a9eff; }
        """

        # Store cam_id on each button via property for reliable lookup
        labels = clip_info.get("camera_labels", {})
        for cam_id in self.playback_all_frames:
            label = labels.get(cam_id, f"Camera {cam_id}")
            btn = QPushButton(label)
            btn.setCheckable(True)
            btn.setStyleSheet(btn_style)
            btn.setProperty("cam_id", cam_id)
            btn.clicked.connect(lambda checked, cid=cam_id: self._on_angle_selected(cid))
            self.angle_bar_layout.addWidget(btn)
            self.angle_buttons.append(btn)

            # Check the active camera button
            if cam_id == self.playback_active_camera:
                btn.setChecked(True)

        # Multi-view button
        self.multi_view_btn = QPushButton("Multi")
        self.multi_view_btn.setCheckable(True)
        self.multi_view_btn.setStyleSheet(btn_style)
        self.multi_view_btn.clicked.connect(self._toggle_multi_view)
        self.angle_bar_layout.addWidget(self.multi_view_btn)

        self.angle_bar_layout.addStretch()

    def _on_angle_selected(self, cam_id: str):
        """Switch active camera angle."""
        self.playback_multi_view = False
        if self.multi_view_btn:
            self.multi_view_btn.setChecked(False)

        self.playback_active_camera = cam_id

        # Update button checked states using stored cam_id property
        for btn in self.angle_buttons:
            btn.setChecked(btn.property("cam_id") == cam_id)

        # Swap playback frames
        if cam_id in self.playback_all_frames:
            self.playback_frames = self.playback_all_frames[cam_id]
            self.playback_slider.setMaximum(max(0, len(self.playback_frames) - 1))
            self.playback_position = min(self.playback_position, len(self.playback_frames) - 1)
            self._show_current_frame()

    def _toggle_multi_view(self):
        """Toggle grid view showing all angles."""
        self.playback_multi_view = self.multi_view_btn.isChecked() if self.multi_view_btn else False

        # Uncheck individual angle buttons when multi is active
        if self.playback_multi_view:
            for btn in self.angle_buttons:
                btn.setChecked(False)

            # Use the longest camera's frame count for slider
            max_frames = max((len(f) for f in self.playback_all_frames.values()), default=0)
            if max_frames > 0:
                self.playback_slider.setMaximum(max_frames - 1)
                self.playback_position = min(self.playback_position, max_frames - 1)
                self._show_current_frame()
        else:
            # Re-select active camera
            if self.playback_active_camera:
                self._on_angle_selected(self.playback_active_camera)

    # ------------------------------------------------------------------
    # PiP
    # ------------------------------------------------------------------

    def _toggle_pip(self):
        if self.pip_window is None:
            self.pip_window = PiPWindow()
            self.pip_window.closed.connect(self._on_pip_closed)
            self.pip_window.camera_toggled.connect(self._on_pip_camera_toggled)
            self.pip_window.pin_toggled.connect(self._on_pip_pin_toggled)

        if self.pip_window.isVisible():
            self.pip_window.hide()
        else:
            self._sync_pip_cameras()
            self.pip_window.show()
            self._update_pip_shot_info()

    def _sync_pip_cameras(self):
        """Push connected camera list and visibility to PiP window."""
        if not self.pip_window:
            return
        connected = [p for p in self.config.cameras if p.id in self.current_frames]
        cameras = [{"id": p.id, "label": p.label or str(p.id)} for p in connected]
        self.pip_window.set_cameras(cameras, self.live_visible_cameras)

    def _on_pip_camera_toggled(self, cam_id, checked: bool):
        """Handle camera toggle from PiP dropdown — sync with main dropdown."""
        if checked:
            self.live_visible_cameras.add(cam_id)
        else:
            if len(self.live_visible_cameras) <= 1:
                self._sync_pip_cameras()
                return
            self.live_visible_cameras.discard(cam_id)
        self._update_camera_dropdown_text()
        self._rebuild_camera_dropdown()
        self._sync_pip_cameras()

    def _on_pip_closed(self):
        pass

    def _on_pip_pin_toggled(self):
        """Handle star button click in PiP overlay."""
        if self.playback_clip_index >= 0:
            self._on_clip_pin_toggled(self.playback_clip_index)
            self._update_pip_shot_info()

    def _update_pip_shot_info(self):
        """Update PiP overlay with current clip's shot number and pin state."""
        if not self.pip_window or not self.pip_window.isVisible():
            return
        if self.playback_clip_index < 0:
            self.pip_window.hide_shot_info()
            return
        visible = self.recording_manager.get_visible_clips()
        if self.playback_clip_index >= len(visible):
            self.pip_window.hide_shot_info()
            return
        clip = visible[self.playback_clip_index]
        shot_num = clip["file"].replace("shot_", "").replace(".mp4", "")
        try:
            shot_display = str(int(shot_num))
        except (ValueError, TypeError):
            shot_display = shot_num
        pinned = bool(clip.get("pinned"))
        self.pip_window.set_shot_info(shot_display, pinned)

    # ------------------------------------------------------------------
    # Comparison
    # ------------------------------------------------------------------

    def _open_comparison(self):
        visible = self.recording_manager.get_visible_clips()
        if len(visible) < 1:
            QMessageBox.information(self, "Compare", "Need at least one clip to compare.")
            return
        dlg = ComparisonWindow(
            visible,
            Path(self.recording_manager.session_folder),
            self,
        )
        dlg.exec()

    # ------------------------------------------------------------------
    # Armed / Trigger
    # ------------------------------------------------------------------

    def _toggle_armed(self):
        self.is_armed = self.arm_btn.isChecked()

        if self.is_armed:
            self._stop_mic_preview()
            self._start_audio()
            self.arm_btn.setText("Armed")
            self.status_label.setText("\u25cf  Armed - Waiting for shot...")
            self.status_label.setStyleSheet(
                "QLabel { background-color: transparent; padding: 4px 8px; font-size: 12px; "
                "font-weight: normal; color: #f0c040; }"
            )
            logger.info("System armed")
        else:
            self._stop_audio()
            self.arm_btn.setText("Arm")
            self.status_label.setText("\u25cf  Ready - Arm to begin capturing")
            self.status_label.setStyleSheet(
                "QLabel { background-color: transparent; padding: 4px 8px; font-size: 12px; "
                "font-weight: normal; color: #9a9a9a; }"
            )
            logger.info("System disarmed")

    def _manual_trigger(self):
        if self.is_armed and not self.is_recording:
            self.last_trigger_timestamp = int(time.time() * 1000)
            self._start_recording()
        elif not self.is_armed:
            QMessageBox.information(self, "Not Armed", "Please arm the system first before triggering.")

    def _on_threshold_changed(self, value: int):
        threshold = value / 100.0
        self.config.audio_threshold = threshold
        self.threshold_label.setText(f"{value}%")
        self._update_mic_bar_style()

        if self.audio_detector:
            self.audio_detector.set_threshold(threshold)
        self._save_debounce_timer.start()

    # ------------------------------------------------------------------
    # Drawing Tools
    # ------------------------------------------------------------------

    def _set_drawing_mode(self, mode: str):
        for btn in self._tool_buttons:
            btn.setChecked(False)
        if mode == "select":
            self.select_tool_btn.setChecked(True)
        elif mode == "line":
            self.line_tool_btn.setChecked(True)
        elif mode == "circle":
            self.circle_tool_btn.setChecked(True)
        self.drawing_overlay.set_mode(mode)

    def _set_drawing_color(self, color: str):
        self.drawing_overlay.current_color = color
        self.drawing_overlay.change_selected_color(color)

    def _clear_drawings(self):
        self.drawing_overlay.clear_all()
        self.config.drawing_overlays = []
        save_settings(self.config)

    def _delete_selected_shape(self):
        self.drawing_overlay.delete_selected()

    def _deselect_drawing(self):
        self._set_drawing_mode("select")
        self.drawing_overlay._deselect_all()
        self.drawing_overlay.update()

    def _on_shapes_changed(self):
        self.config.drawing_overlays = self.drawing_overlay.save_shapes()
        self._save_debounce_timer.start()

    # ------------------------------------------------------------------
    # Gallery
    # ------------------------------------------------------------------

    def _load_existing_clips(self):
        visible = self.recording_manager.get_visible_clips()
        self.gallery.refresh(visible, Path(self.recording_manager.session_folder))

    def _on_clip_selected(self, index: int):
        self._load_clip_for_playback(index)

    def _on_clip_delete_requested(self, index: int):
        reply = QMessageBox.question(
            self, "Delete Shot",
            "Are you sure you want to delete this shot?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )

        if reply == QMessageBox.StandardButton.Yes:
            real_idx = self.recording_manager.get_real_index(index)
            if self.recording_manager.delete_clip(real_idx):
                self._refresh_gallery()
                if self.playback_clip_index == index:
                    self._clear_playback()

    def _on_mark_not_shot_requested(self, index: int):
        reply = QMessageBox.question(
            self, "Mark as Not a Shot",
            "This will delete the video but keep the audio data for training "
            "the audio classifier. Continue?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )

        if reply == QMessageBox.StandardButton.Yes:
            real_idx = self.recording_manager.get_real_index(index)
            if self.recording_manager.mark_as_not_shot(real_idx):
                self._refresh_gallery()
                if self.playback_clip_index == index:
                    self._clear_playback()
                # Auto-retrain
                self._retrain_classifier()
                logger.info("Clip marked as not a shot, classifier retrain triggered")

    def _refresh_gallery(self):
        visible = self.recording_manager.get_visible_clips()
        self.gallery.refresh(visible, Path(self.recording_manager.session_folder))

    def _clear_playback(self):
        self.playback_frames = []
        self.playback_all_frames.clear()
        self.playback_camera_labels.clear()
        self.playback_active_camera = None
        self.playback_multi_view = False
        self.playback_clip_index = -1
        if self.pip_window and self.pip_window.isVisible():
            self.pip_window.hide_shot_info()
        self.is_playing = False
        self.playback_timer.stop()
        self.play_btn.setChecked(False)
        self.play_btn.setText("Play")
        self.angle_bar.setVisible(False)

    def _go_to_live(self):
        """Return to live camera feed, deselecting any clip."""
        self._clear_playback()
        self.gallery.deselect_all()
        self._update_live_btn_style()

    def _update_live_btn_style(self):
        """Green when showing live feed, default when a clip is loaded."""
        has_playback = self.playback_frames or (self.playback_multi_view and self.playback_all_frames)
        if not has_playback:
            # Active — showing live feed
            self.live_btn.setStyleSheet(
                "QPushButton { background-color: #34d17e; color: white; border: 1px solid #34d17e; "
                "border-radius: 6px; padding: 6px 14px; font-size: 12px; }"
                "QPushButton:hover { background-color: #2aba6e; }"
            )
        else:
            # Inactive — a clip is loaded
            self.live_btn.setStyleSheet("")

    def _rebuild_camera_dropdown(self):
        """Rebuild the camera dropdown menu — single-select camera switcher."""
        self.camera_dropdown_menu.clear()
        for preset in self.config.cameras:
            label = preset.label or str(preset.id)
            is_primary = (preset.id == self.config.primary_camera)
            is_connected = preset.id in self.current_frames
            is_active = preset.id in self.live_visible_cameras

            display = f"\u2605 {label}" if is_primary else label
            if not is_connected:
                display += " (connecting...)"

            action = self.camera_dropdown_menu.addAction(display)
            action.setCheckable(True)
            action.setChecked(is_active)
            if is_connected:
                action.triggered.connect(lambda checked, pid=preset.id: self._switch_to_camera(pid))
            else:
                action.setEnabled(False)

        # "Set Primary" submenu
        if len(self.config.cameras) > 1:
            self.camera_dropdown_menu.addSeparator()
            primary_menu = self.camera_dropdown_menu.addMenu("Set Primary")
            primary_menu.setStyleSheet(
                "QMenu { background-color: #2d2d2d; border: 1px solid #444; border-radius: 4px; padding: 4px; }"
                "QMenu::item { padding: 6px 20px; color: #ccc; }"
                "QMenu::item:selected { background-color: #4a9eff; color: white; }"
                "QMenu::indicator { width: 14px; height: 14px; }"
                "QMenu::indicator:checked { background-color: #4a9eff; border: 1px solid #4a9eff; border-radius: 2px; }"
                "QMenu::indicator:unchecked { background-color: #1a1a1a; border: 1px solid #555; border-radius: 2px; }"
            )
            for preset in self.config.cameras:
                label = preset.label or str(preset.id)
                action = primary_menu.addAction(label)
                action.setCheckable(True)
                action.setChecked(preset.id == self.config.primary_camera)
                action.triggered.connect(lambda checked, pid=preset.id: self._set_primary_camera(pid))

        self._update_camera_dropdown_text()

    def _switch_to_camera(self, camera_id):
        """Switch live view to a single camera."""
        self.live_visible_cameras = {camera_id}
        self._rebuild_camera_dropdown()
        self._sync_pip_cameras()

    def _set_primary_camera(self, camera_id):
        """Set a new primary camera, save config, and rebuild dropdown."""
        self.config.primary_camera = camera_id
        save_settings(self.config)
        self._rebuild_camera_dropdown()

    def _on_camera_visibility_toggled(self, cam_id, checked: bool):
        """Toggle a camera's visibility in the live feed."""
        if checked:
            self.live_visible_cameras.add(cam_id)
        else:
            # Don't allow unchecking all cameras
            if len(self.live_visible_cameras) <= 1:
                # Re-check in menu
                self._rebuild_camera_dropdown()
                return
            self.live_visible_cameras.discard(cam_id)
        self._update_camera_dropdown_text()
        self._sync_pip_cameras()

    def _update_camera_dropdown_text(self):
        """Update dropdown button text to show active camera name."""
        total = len(self.config.cameras)
        self.camera_dropdown_btn.setVisible(total > 1)
        if total > 1:
            # Show the name of the currently active camera
            active_label = None
            for p in self.config.cameras:
                if p.id in self.live_visible_cameras:
                    active_label = p.label or str(p.id)
                    break
            if active_label:
                self.camera_dropdown_btn.setText(f"\u25BC {active_label}")
            else:
                self.camera_dropdown_btn.setText("Cameras")

    # ------------------------------------------------------------------
    # Detection Tab
    # ------------------------------------------------------------------

    def _on_auto_ready_toggled(self, checked: bool):
        self.config.auto_ready_enabled = checked
        self._save_debounce_timer.start()
        logger.info("Auto-ready (person detection): %s", "enabled" if checked else "disabled")

    def _retrain_classifier(self):
        if self.audio_detector:
            success = self.audio_detector.classifier.retrain()
            if success:
                self.classifier_mode_label.setText(f"Mode: learned")
            else:
                self.classifier_mode_label.setText(f"Mode: heuristic (need more samples)")
        else:
            classifier = AudioClassifier()
            success = classifier.retrain()
            if success:
                self.classifier_mode_label.setText(f"Mode: learned")

        count = AudioClassifier().training_sample_count
        self.training_count_label.setText(f"Training samples: {count}")

    # ------------------------------------------------------------------
    # Camera Settings Dialog
    # ------------------------------------------------------------------

    def _show_camera_settings(self):
        dialog = CameraSettingsDialog(self.config, self)

        if dialog.exec() == QDialog.DialogCode.Accepted:
            new_presets = dialog.get_presets()
            primary = dialog.get_primary_camera()

            new_ids = {p.id for p in new_presets}
            old_ids = set(self.camera_captures.keys())

            # Stop removed cameras
            for cam_id in old_ids - new_ids:
                self._stop_camera(cam_id)

            # Update or add cameras
            for preset in new_presets:
                if preset.id in self.camera_captures:
                    # Update transforms on running camera
                    cap = self.camera_captures[preset.id]
                    cap.set_zoom(preset.zoom)
                    cap.set_rotation(preset.rotation)
                    cap.set_flip_h(preset.flip_h)
                    cap.set_flip_v(preset.flip_v)
                else:
                    self._start_camera(preset)

            self.config.cameras = new_presets
            self.config.primary_camera = primary
            save_settings(self.config)
            # Show the active camera if it still exists, otherwise show primary
            if not (self.live_visible_cameras & new_ids):
                self.live_visible_cameras = {primary}
            else:
                self.live_visible_cameras = self.live_visible_cameras & new_ids
            self._rebuild_camera_dropdown()
            self._update_camera_status()
            self._refresh_phone_btn_state()

    # ------------------------------------------------------------------
    # Session Management
    # ------------------------------------------------------------------

    def _open_session_folder(self):
        import subprocess
        path = self.recording_manager.session_folder
        try:
            if os.name == "nt":
                subprocess.run(["explorer", str(path)])
            elif os.name == "posix":
                subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(path)])
        except Exception as e:
            logger.error("Failed to open session folder: %s", e)

    def _new_session(self):
        base_dir = self.config.resolved_base_dir
        base_dir.mkdir(parents=True, exist_ok=True)
        session_name = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        self.config.session_folder = str(base_dir / session_name)
        self.recording_manager = RecordingManager(self.config)

        self.gallery.refresh([], Path(self.recording_manager.session_folder))
        self._clear_playback()
        self._refresh_session_list()

        self.statusBar().showMessage(f"Session: {self.config.session_folder}")
        logger.info("New session started: %s", self.config.session_folder)

    def _refresh_session_list(self):
        """Refresh the session browser list."""
        self.session_list.scan_sessions(self.config.resolved_base_dir)
        self.session_list.select_session(self.config.session_folder)

    def _on_session_selected(self, session_path: str):
        """Switch to a different session."""
        if session_path == self.config.session_folder:
            return
        self.config.session_folder = session_path
        self.recording_manager = RecordingManager(self.config)
        visible = self.recording_manager.get_visible_clips()
        self.gallery.refresh(visible, Path(self.recording_manager.session_folder))
        self._clear_playback()
        self.statusBar().showMessage(f"Session: {session_path}")
        logger.info("Switched to session: %s", session_path)

    def _change_save_location(self):
        """Change the base save directory."""
        new_dir = QFileDialog.getExistingDirectory(
            self, "Choose Save Location", str(self.config.resolved_base_dir)
        )
        if new_dir:
            self.config.base_dir = new_dir
            save_settings(self.config)
            self.save_loc_label.setText(new_dir)
            self._new_session()
            logger.info("Save location changed to: %s", new_dir)

    # ------------------------------------------------------------------
    # Pin / Share
    # ------------------------------------------------------------------

    def _on_clip_pin_toggled(self, index: int):
        """Toggle pin on a clip and refresh gallery."""
        self.recording_manager.toggle_pin(index)
        self._refresh_gallery()

    def _on_clip_share_requested(self, index: int):
        """Open share dialog for a clip."""
        clip_path = self.recording_manager.get_clip_path(index)
        if clip_path and clip_path.exists():
            dlg = ShareDialog(str(clip_path), self)
            dlg.exec()
        else:
            QMessageBox.warning(self, "Share", "Clip file not found.")

    def _on_share_btn_clicked(self):
        """Share the currently playing clip."""
        if self.playback_clip_index >= 0:
            self._on_clip_share_requested(self.playback_clip_index)
        else:
            QMessageBox.information(self, "Share", "Select a clip first.")

    # ------------------------------------------------------------------
    # Device Status Check
    # ------------------------------------------------------------------

    def _check_device_status(self):
        """Show or dismiss warning banner based on camera/mic status."""
        problems = []

        # Check camera — have we received at least one frame?
        if not self.current_frames:
            problems.append("No camera detected")

        # Check microphone
        if not AUDIO_AVAILABLE:
            problems.append("No microphone available (PyAudio not installed)")
        else:
            devices = enumerate_audio_devices()
            if not devices:
                problems.append("No microphone detected")

        if not problems:
            # Everything is fine — dismiss banner if it was showing
            if self._device_warning_banner is not None:
                self._device_warning_banner.setVisible(False)
                self._device_warning_banner.deleteLater()
                self._device_warning_banner = None
            return

        self._show_device_warning(problems)

    def _show_device_warning(self, problems: list):
        if self._device_warning_banner is not None:
            return

        if len(problems) == 1:
            message = problems[0]
        else:
            message = " \u2022 ".join(problems)

        banner = QFrame(self)
        banner.setStyleSheet(
            "QFrame {"
            "  background-color: #3a2a1a;"
            "  border: 1px solid #ff9f43;"
            "  border-radius: 6px;"
            "}"
        )
        banner.setFixedHeight(36)
        layout = QHBoxLayout(banner)
        layout.setContentsMargins(12, 0, 8, 0)
        layout.setSpacing(8)

        label = QLabel(f"\u26a0  {message}  — swing detection requires a camera and a microphone")
        label.setStyleSheet("color: #ffcc80; font-size: 12px; border: none; background: transparent;")
        layout.addWidget(label)
        layout.addStretch()

        settings_btn = QPushButton("Open Settings")
        settings_btn.setStyleSheet(
            "QPushButton { background-color: #ff9f43; color: #1c1c1c; border: none;"
            " border-radius: 4px; padding: 4px 14px; font-size: 11px; font-weight: bold; }"
            "QPushButton:hover { background-color: #ffb76b; }"
        )
        settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        settings_btn.clicked.connect(self._show_camera_settings)
        layout.addWidget(settings_btn)

        close_btn = QPushButton("\u00d7")
        close_btn.setFixedSize(20, 20)
        close_btn.setStyleSheet(
            "QPushButton { background-color: transparent; color: #7a7a7a; border: none;"
            " font-size: 16px; font-weight: bold; padding: 0; }"
            "QPushButton:hover { color: #d4d4d4; }"
        )
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.clicked.connect(lambda: banner.setVisible(False))
        layout.addWidget(close_btn)

        self._device_warning_banner = banner
        # Insert below update banner (position 0 or 1)
        insert_pos = 1 if self._update_banner and self._update_banner.isVisible() else 0
        self.left_layout.insertWidget(insert_pos, banner)

    # ------------------------------------------------------------------
    # Auto-Update
    # ------------------------------------------------------------------

    def _check_for_updates(self):
        self._update_checker = UpdateChecker()
        self._update_checker.update_available.connect(self._show_update_banner)
        self._update_checker.start()

    def _show_update_banner(self, version: str, download_url: str, release_url: str, file_size: int):
        if self._update_banner is not None:
            return
        self._update_banner = UpdateBanner(version, download_url, file_size, parent=self)
        self._update_banner.download_clicked.connect(self._on_update_download)
        self._update_banner.skipped.connect(self._on_update_skipped)
        self._update_banner.dismissed.connect(self._on_update_dismissed)
        self.left_layout.insertWidget(0, self._update_banner)

    def _on_update_download(self, url: str):
        QDesktopServices.openUrl(QUrl(url))

    def _on_update_skipped(self, version: str):
        state = _load_update_state()
        state["skipped_version"] = version
        _save_update_state(state)
        if self._update_banner:
            self._update_banner.setVisible(False)

    def _on_update_dismissed(self):
        if self._update_banner:
            self._update_banner.setVisible(False)

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def closeEvent(self, event):
        # Flush debounce timer and save window geometry immediately
        self._save_debounce_timer.stop()
        g = self.geometry()
        self.config.window_geometry = [g.x(), g.y(), g.width(), g.height()]
        save_settings(self.config)

        # Stop timers before camera cleanup to prevent callbacks on destroyed objects
        self.display_timer.stop()
        self.recording_timer.stop()
        self.playback_timer.stop()
        self._camera_retry_timer.stop()

        for capture in list(self.camera_captures.values()):
            capture.stop()

        self._stop_audio()

        if self.pip_window:
            self.pip_window.close()

        if self._test_camera_server:
            self._test_camera_server.stop()
            self._test_camera_server = None

        logger.info("Application closing")
        event.accept()


# ============================================================================
# Entry Point
# ============================================================================

def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    # Set dark palette
    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor(28, 28, 28))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(212, 212, 212))
    palette.setColor(QPalette.ColorRole.Base, QColor(20, 20, 20))
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor(37, 37, 37))
    palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(37, 37, 37))
    palette.setColor(QPalette.ColorRole.ToolTipText, QColor(212, 212, 212))
    palette.setColor(QPalette.ColorRole.Text, QColor(212, 212, 212))
    palette.setColor(QPalette.ColorRole.Button, QColor(51, 51, 51))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(212, 212, 212))
    palette.setColor(QPalette.ColorRole.BrightText, QColor(255, 255, 255))
    palette.setColor(QPalette.ColorRole.Link, QColor(74, 158, 255))
    palette.setColor(QPalette.ColorRole.Highlight, QColor(74, 158, 255))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
    app.setPalette(palette)

    log_handler = setup_logging()

    window = MainWindow(log_handler)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
