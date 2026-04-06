"""
Reusable UI components for ReplaySwing.
"""

import logging
from pathlib import Path
from typing import Optional, List, Dict

import cv2
import numpy as np

from PyQt6.QtWidgets import (
    QWidget, QLabel, QVBoxLayout, QHBoxLayout, QFrame,
    QPushButton, QGridLayout, QScrollArea, QMenu, QTextEdit,
    QListWidget, QListWidgetItem,
)
from PyQt6.QtCore import Qt, QTimer, QSize, pyqtSignal
from PyQt6.QtGui import (
    QImage, QPixmap, QCursor, QColor, QPainter, QPen, QTextCursor, QIcon,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Multi-Angle Grid Composite
# ============================================================================

def composite_grid(frames: Dict[str, np.ndarray], labels: Dict[str, str],
                   target_size: tuple = None, primary_id: str = None) -> np.ndarray:
    """Composite multiple camera frames into a grid with labels.

    - 1 camera: full frame
    - 2 cameras: side by side (2x1)
    - 3-4 cameras: 2x2 grid

    target_size: (width, height) tuple. If None, uses first frame's size or 1280x720.
    primary_id: camera id of the primary camera; its label is prefixed with '* '.
    """
    cam_ids = list(frames.keys())
    n = len(cam_ids)

    # Auto-detect target size from first frame if not specified
    if target_size is None:
        first_frame = next(iter(frames.values()), None) if frames else None
        if first_frame is not None:
            tw, th = first_frame.shape[1], first_frame.shape[0]
            # For multi-camera, double the width for 2-col layouts
            if n >= 2:
                tw = max(tw, 1280)
                th = max(th, 720)
        else:
            tw, th = 1280, 720
    else:
        tw, th = target_size

    if n == 0:
        return np.zeros((th, tw, 3), dtype=np.uint8)

    if n == 1:
        cell_w, cell_h = tw, th
        cols, rows = 1, 1
    elif n == 2:
        cell_w, cell_h = tw // 2, th
        cols, rows = 2, 1
    else:
        cell_w, cell_h = tw // 2, th // 2
        cols, rows = 2, 2

    canvas = np.zeros((th, tw, 3), dtype=np.uint8)

    for i, cam_id in enumerate(cam_ids):
        if i >= rows * cols:
            break
        row = i // cols
        col = i % cols
        x0 = col * cell_w
        y0 = row * cell_h

        frame = frames[cam_id]
        # Resize preserving aspect ratio, letterbox/pillarbox to fill cell
        fh, fw = frame.shape[:2]
        scale = min(cell_w / fw, cell_h / fh)
        new_w, new_h = int(fw * scale), int(fh * scale)
        scaled_frame = cv2.resize(frame, (new_w, new_h))
        resized = np.zeros((cell_h, cell_w, 3), dtype=np.uint8)
        pad_x = (cell_w - new_w) // 2
        pad_y = (cell_h - new_h) // 2
        resized[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = scaled_frame

        # Draw label with semi-transparent background bar
        label = labels.get(cam_id, f"Camera {cam_id}")
        if primary_id is not None and cam_id == primary_id:
            label = "* " + label
        (text_w, text_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        bar_h = text_h + 16
        overlay = resized[:bar_h, :].copy()
        cv2.rectangle(resized, (0, 0), (cell_w, bar_h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.4, resized[:bar_h, :], 0.6, 0, resized[:bar_h, :])
        cv2.putText(resized, label, (10, text_h + 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        canvas[y0:y0 + cell_h, x0:x0 + cell_w] = resized

    return canvas


# ============================================================================
# Session List Widget
# ============================================================================

class SessionListWidget(QWidget):
    """Browsable list of past sessions with shot counts."""

    session_selected = pyqtSignal(str)  # session folder path
    new_session_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)

        header = QHBoxLayout()
        label = QLabel("Sessions")
        label.setStyleSheet("color: #ccc; font-weight: bold; font-size: 12px;")
        header.addWidget(label)
        header.addStretch()

        new_btn = QPushButton("+ New")
        new_btn.setFixedSize(60, 24)
        new_btn.setStyleSheet(
            "QPushButton { background-color: #4a9eff; color: white; border: none; "
            "border-radius: 4px; font-size: 11px; font-weight: bold; }"
            "QPushButton:hover { background-color: #5aafff; }"
        )
        new_btn.clicked.connect(self.new_session_requested.emit)
        header.addWidget(new_btn)
        layout.addLayout(header)

        self.list_widget = QListWidget()
        self.list_widget.setMaximumHeight(150)
        self.list_widget.setStyleSheet("""
            QListWidget {
                background-color: #1a1a1a; border: 1px solid #444; border-radius: 4px;
                color: #ccc; font-size: 11px;
            }
            QListWidget::item { padding: 4px 8px; }
            QListWidget::item:selected { background-color: #4a9eff; color: white; }
            QListWidget::item:hover { background-color: #333; }
        """)
        self.list_widget.currentRowChanged.connect(self._on_row_changed)
        layout.addWidget(self.list_widget)

        self._sessions: list = []  # list of (path_str, display_text)

    def scan_sessions(self, base_dir: Path):
        """Scan base_dir for session folders and populate the list."""
        import json
        from datetime import datetime as dt

        self.list_widget.blockSignals(True)
        self.list_widget.clear()
        self._sessions.clear()

        if not base_dir.exists():
            self.list_widget.blockSignals(False)
            return

        folders = []
        for d in base_dir.iterdir():
            if d.is_dir() and len(d.name) >= 10 and d.name[4] == "-":
                folders.append(d)
        folders.sort(key=lambda p: p.name, reverse=True)

        for folder in folders:
            # Count shots from clips.json
            clips_file = folder / "clips.json"
            shot_count = 0
            if clips_file.exists():
                try:
                    with open(clips_file, "r") as f:
                        clips = json.load(f)
                    shot_count = len([c for c in clips if not c.get("marked_not_shot")])
                except Exception:
                    pass

            # Parse date from folder name
            try:
                date_obj = dt.strptime(folder.name[:19], "%Y-%m-%d_%H-%M-%S")
                display = date_obj.strftime("%b %d, %Y %I:%M %p")
            except (ValueError, IndexError):
                display = folder.name

            text = f"{display}  ({shot_count} shots)"
            self._sessions.append((str(folder), text))
            self.list_widget.addItem(text)

        self.list_widget.blockSignals(False)

    def select_session(self, session_path: str):
        """Select a session by path."""
        for i, (path, _) in enumerate(self._sessions):
            if path == session_path:
                self.list_widget.blockSignals(True)
                self.list_widget.setCurrentRow(i)
                self.list_widget.blockSignals(False)
                return

    def _on_row_changed(self, row: int):
        if 0 <= row < len(self._sessions):
            self.session_selected.emit(self._sessions[row][0])


# ============================================================================
# Video Player Widget
# ============================================================================

class VideoPlayer(QLabel):
    """Widget for displaying video frames with overlay support."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(640, 360)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("background-color: #1a1a1a; border-radius: 8px;")
        self.setScaledContents(False)
        self._last_frame = None
        self._video_rect = (0, 0, 0, 0)  # x, y, w, h of the displayed video

    @property
    def video_rect(self):
        return self._video_rect

    def display_frame(self, frame: np.ndarray):
        if frame is None:
            return

        self._last_frame = frame

        # Handle non-3-channel frames
        if frame.ndim == 2:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
        elif frame.shape[2] == 4:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
        else:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        h, w, ch = rgb_frame.shape
        bytes_per_line = ch * w

        q_img = QImage(rgb_frame.tobytes(), w, h, bytes_per_line, QImage.Format.Format_RGB888)
        scaled = q_img.scaled(
            self.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )

        # Calculate video rect position (centered)
        sx = (self.width() - scaled.width()) // 2
        sy = (self.height() - scaled.height()) // 2
        self._video_rect = (sx, sy, scaled.width(), scaled.height())

        self.setPixmap(QPixmap.fromImage(scaled))


# ============================================================================
# Picture-in-Picture Window
# ============================================================================

class PiPWindow(QWidget):
    """Floating Picture-in-Picture window with multi-camera support.

    Shows one video panel per visible camera, stacked vertically.
    Each panel maintains 16:9 aspect ratio. Window is resizable by dragging edges.
    """

    closed = pyqtSignal()
    camera_toggled = pyqtSignal(object, bool)  # (cam_id, checked)
    pin_toggled = pyqtSignal()

    TITLE_HEIGHT = 24
    RESIZE_MARGIN = 6  # pixels from edge to trigger resize
    MIN_WIDTH = 240
    MIN_HEIGHT = 170

    def __init__(self, parent=None):
        super().__init__(
            parent,
            Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.Tool,
        )

        self.setWindowTitle("Golf Swing - PiP")
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setMouseTracking(True)
        self.setMinimumSize(self.MIN_WIDTH, self.MIN_HEIGHT)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.container = QFrame()
        self.container.setStyleSheet("""
            QFrame#pipContainer {
                background-color: #2d2d2d;
                border: 1px solid #444;
                border-radius: 8px;
            }
        """)
        self.container.setObjectName("pipContainer")
        container_layout = QVBoxLayout(self.container)
        container_layout.setContentsMargins(4, 4, 4, 4)
        container_layout.setSpacing(2)

        # Title bar
        title_bar = QWidget()
        title_bar.setFixedHeight(self.TITLE_HEIGHT)
        title_layout = QHBoxLayout(title_bar)
        title_layout.setContentsMargins(8, 0, 8, 0)

        title_label = QLabel("Swing Replay")
        title_label.setStyleSheet("color: #aaa; font-weight: bold; font-size: 11px; border: none;")
        title_layout.addWidget(title_label)
        title_layout.addStretch()

        # Camera dropdown
        self.camera_btn = QPushButton("Cameras")
        self.camera_btn.setStyleSheet(
            "QPushButton { background-color: #333; color: #d4d4d4; border: 1px solid #3a3a3a; "
            "border-radius: 4px; padding: 2px 8px; font-size: 10px; }"
            "QPushButton:hover { background-color: #4d4d4d; }"
            "QPushButton::menu-indicator { image: none; }"
        )
        self.camera_menu = QMenu()
        self.camera_menu.setStyleSheet(
            "QMenu { background-color: #2d2d2d; border: 1px solid #444; border-radius: 4px; padding: 4px; }"
            "QMenu::item { padding: 6px 20px; color: #ccc; }"
            "QMenu::item:selected { background-color: #4a9eff; color: white; }"
            "QMenu::indicator { width: 14px; height: 14px; }"
            "QMenu::indicator:checked { background-color: #4a9eff; border: 1px solid #4a9eff; border-radius: 2px; }"
            "QMenu::indicator:unchecked { background-color: #1a1a1a; border: 1px solid #555; border-radius: 2px; }"
        )
        self.camera_btn.setMenu(self.camera_menu)
        title_layout.addWidget(self.camera_btn)

        close_btn = QPushButton()
        close_btn.setFixedSize(20, 20)
        close_btn.setStyleSheet(
            "QPushButton { background-color: transparent; border: none; }"
            "QPushButton:hover { background-color: rgba(255,80,80,0.25); border-radius: 4px; }"
        )
        # Paint a proper cross icon
        close_icon = QPixmap(20, 20)
        close_icon.fill(QColor(0, 0, 0, 0))
        p = QPainter(close_icon)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        pen = QPen(QColor("#888"), 2)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.drawLine(6, 6, 14, 14)
        p.drawLine(14, 6, 6, 14)
        p.end()
        close_btn.setIcon(QIcon(close_icon))
        close_btn.setIconSize(QSize(20, 20))
        close_btn.clicked.connect(self.close)
        title_layout.addWidget(close_btn)

        container_layout.addWidget(title_bar)

        # Video panels container
        self._panels_widget = QWidget()
        self._panels_layout = QVBoxLayout(self._panels_widget)
        self._panels_layout.setContentsMargins(0, 0, 0, 0)
        self._panels_layout.setSpacing(2)
        container_layout.addWidget(self._panels_widget, stretch=1)

        layout.addWidget(self.container)

        # Shot overlay bar (floats on top of video panels)
        self._shot_overlay = QWidget(self._panels_widget)
        self._shot_overlay.setStyleSheet("background-color: rgba(0, 0, 0, 120); border: none;")
        self._shot_overlay.setFixedHeight(28)
        self._shot_overlay.hide()
        overlay_layout = QHBoxLayout(self._shot_overlay)
        overlay_layout.setContentsMargins(8, 0, 4, 0)
        overlay_layout.setSpacing(4)
        self._shot_label = QLabel("")
        self._shot_label.setStyleSheet("color: white; font-weight: bold; font-size: 12px; background: transparent; border: none;")
        overlay_layout.addWidget(self._shot_label)
        self._star_btn = QPushButton("\u2606")
        self._star_btn.setFixedSize(24, 24)
        self._star_btn.setStyleSheet(
            "QPushButton { color: white; font-size: 16px; background: transparent; border: none; padding: 0px; }"
            "QPushButton:hover { color: #ffd700; }"
        )
        self._star_btn.clicked.connect(self._on_star_clicked)
        overlay_layout.addWidget(self._star_btn)
        overlay_layout.addStretch()

        self._current_shot_number = ""
        self._current_pinned = False

        self._drag_pos = None
        self._resize_edge = None  # which edge(s) are being dragged
        self._resize_origin = None  # starting geometry for resize
        self._video_panels: Dict[str, QLabel] = {}  # cam_id -> QLabel
        self._visible_cameras: List[str] = []
        self._pip_zoom = 1.0  # scroll wheel zoom (1.0 = fit, >1 = crop center)

        self.resize(408, 270)

    def set_cameras(self, cameras: List[Dict], visible_ids: set):
        """Rebuild camera menu and video panels.

        cameras: list of dicts with 'id' and 'label' keys
        visible_ids: set of camera ids to show
        """
        self.camera_menu.clear()
        for cam in cameras:
            action = self.camera_menu.addAction(cam["label"])
            action.setCheckable(True)
            action.setChecked(cam["id"] in visible_ids)
            action.toggled.connect(
                lambda checked, cid=cam["id"]: self.camera_toggled.emit(cid, checked)
            )

        # Rebuild panels for visible cameras
        new_visible = [c for c in cameras if c["id"] in visible_ids]
        new_ids = [str(c["id"]) for c in new_visible]

        # Remove panels no longer visible
        for cid in list(self._video_panels.keys()):
            if cid not in new_ids:
                panel = self._video_panels.pop(cid)
                self._panels_layout.removeWidget(panel)
                panel.deleteLater()

        # Add new panels
        for cam in new_visible:
            cid = str(cam["id"])
            if cid not in self._video_panels:
                panel = QLabel()
                panel.setAlignment(Qt.AlignmentFlag.AlignCenter)
                panel.setStyleSheet("background-color: #1a1a1a; border-radius: 4px; border: none;")
                self._panels_layout.addWidget(panel)
                self._video_panels[cid] = panel

        self._visible_cameras = new_ids
        self._fit_panels()

        # Hide dropdown when only 1 camera
        total = len(cameras)
        vis = len(new_visible)
        self.camera_btn.setVisible(total > 1)
        if total > 1:
            self.camera_btn.setText(f"Cameras ({vis}/{total})")

    def _fit_panels(self):
        """Set panel heights based on current window width to maintain 16:9."""
        content_w = self.width() - 8  # container margins
        panel_h = max(40, int(content_w * 9 / 16))
        for panel in self._video_panels.values():
            panel.setFixedHeight(panel_h)

    def _apply_zoom_crop(self, frame: np.ndarray) -> np.ndarray:
        """Crop center of frame based on zoom level. zoom=1.0 means no crop."""
        if self._pip_zoom <= 1.0:
            return frame
        h, w = frame.shape[:2]
        crop_w = max(1, int(w / self._pip_zoom))
        crop_h = max(1, int(h / self._pip_zoom))
        x0 = (w - crop_w) // 2
        y0 = (h - crop_h) // 2
        return frame[y0:y0 + crop_h, x0:x0 + crop_w]

    def display_frame(self, frame: np.ndarray, camera_id: str = None):
        """Display a frame. If camera_id given, update that panel only."""
        if frame is None:
            return

        # Apply PiP zoom crop
        frame = self._apply_zoom_crop(frame)

        if frame.ndim == 2:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
        elif frame.shape[2] == 4:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
        else:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb_frame.shape
        bytes_per_line = ch * w
        q_img = QImage(rgb_frame.tobytes(), w, h, bytes_per_line, QImage.Format.Format_RGB888)

        if camera_id and str(camera_id) in self._video_panels:
            panel = self._video_panels[str(camera_id)]
            scaled = q_img.scaled(
                panel.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            panel.setPixmap(QPixmap.fromImage(scaled))
        else:
            # Fallback: display on first panel (single-frame mode)
            for panel in self._video_panels.values():
                scaled = q_img.scaled(
                    panel.size(),
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
                panel.setPixmap(QPixmap.fromImage(scaled))
                break
            # If no panels yet, create a default one
            if not self._video_panels:
                self._default_display(q_img)

    def _default_display(self, q_img):
        """Fallback display when no camera panels configured."""
        if not self._video_panels:
            panel = QLabel()
            panel.setAlignment(Qt.AlignmentFlag.AlignCenter)
            panel.setStyleSheet("background-color: #1a1a1a; border-radius: 4px; border: none;")
            self._panels_layout.addWidget(panel)
            self._video_panels["_default"] = panel
            self._fit_panels()
        panel = self._video_panels.get("_default") or next(iter(self._video_panels.values()))
        scaled = q_img.scaled(
            panel.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        panel.setPixmap(QPixmap.fromImage(scaled))

    # -- Edge detection for resize --

    def _get_edge(self, pos):
        """Return edge flags for the given local position."""
        m = self.RESIZE_MARGIN
        w, h = self.width(), self.height()
        x, y = pos.x(), pos.y()
        edge = 0
        if x <= m:
            edge |= 1  # left
        if x >= w - m:
            edge |= 2  # right
        if y <= m:
            edge |= 4  # top
        if y >= h - m:
            edge |= 8  # bottom
        return edge

    _EDGE_CURSORS = {
        1: Qt.CursorShape.SizeHorCursor,     # left
        2: Qt.CursorShape.SizeHorCursor,     # right
        4: Qt.CursorShape.SizeVerCursor,     # top
        8: Qt.CursorShape.SizeVerCursor,     # bottom
        5: Qt.CursorShape.SizeFDiagCursor,   # top-left
        6: Qt.CursorShape.SizeBDiagCursor,   # top-right
        9: Qt.CursorShape.SizeBDiagCursor,   # bottom-left
        10: Qt.CursorShape.SizeFDiagCursor,  # bottom-right
    }

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            edge = self._get_edge(event.position().toPoint())
            if edge:
                self._resize_edge = edge
                self._resize_origin = (event.globalPosition().toPoint(), self.geometry())
                self._drag_pos = None
            else:
                self._drag_pos = event.globalPosition().toPoint() - self.pos()
                self._resize_edge = None

    def mouseMoveEvent(self, event):
        if self._resize_edge and self._resize_origin:
            gpos = event.globalPosition().toPoint()
            origin_pos, origin_geo = self._resize_origin
            dx = gpos.x() - origin_pos.x()
            dy = gpos.y() - origin_pos.y()
            geo = origin_geo  # QRect

            new_x, new_y = geo.x(), geo.y()
            new_w, new_h = geo.width(), geo.height()

            if self._resize_edge & 1:  # left
                new_x = geo.x() + dx
                new_w = geo.width() - dx
            if self._resize_edge & 2:  # right
                new_w = geo.width() + dx
            if self._resize_edge & 4:  # top
                new_y = geo.y() + dy
                new_h = geo.height() - dy
            if self._resize_edge & 8:  # bottom
                new_h = geo.height() + dy

            # Enforce minimums
            if new_w < self.MIN_WIDTH:
                if self._resize_edge & 1:
                    new_x = geo.x() + geo.width() - self.MIN_WIDTH
                new_w = self.MIN_WIDTH
            if new_h < self.MIN_HEIGHT:
                if self._resize_edge & 4:
                    new_y = geo.y() + geo.height() - self.MIN_HEIGHT
                new_h = self.MIN_HEIGHT

            self.setGeometry(new_x, new_y, new_w, new_h)
            return

        if self._drag_pos is not None:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            return

        # Hover: update cursor based on edge proximity
        edge = self._get_edge(event.position().toPoint())
        cursor = self._EDGE_CURSORS.get(edge)
        if cursor:
            self.setCursor(cursor)
        else:
            self.unsetCursor()

    def mouseReleaseEvent(self, event):
        self._drag_pos = None
        self._resize_edge = None
        self._resize_origin = None

    def wheelEvent(self, event):
        """Scroll wheel zooms the PiP view (center crop)."""
        delta = event.angleDelta().y()
        if delta > 0:
            self._pip_zoom = min(5.0, self._pip_zoom + 0.15)
        elif delta < 0:
            self._pip_zoom = max(1.0, self._pip_zoom - 0.15)
        event.accept()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._fit_panels()
        self._position_overlay()

    def set_shot_info(self, shot_number: str, pinned: bool):
        """Show shot number and pin state in the overlay bar."""
        self._current_shot_number = shot_number
        self._current_pinned = pinned
        self._shot_label.setText(f"Shot {shot_number}")
        self._star_btn.setText("\u2605" if pinned else "\u2606")
        self._shot_overlay.show()
        self._position_overlay()

    def hide_shot_info(self):
        """Hide the shot overlay bar."""
        self._shot_overlay.hide()

    def _on_star_clicked(self):
        self.pin_toggled.emit()

    def _position_overlay(self):
        """Position the overlay at the bottom of the panels widget."""
        if not self._shot_overlay.isVisible():
            return
        pw = self._panels_widget
        w = pw.width()
        y = pw.height() - self._shot_overlay.height()
        self._shot_overlay.setGeometry(0, y, w, self._shot_overlay.height())
        self._shot_overlay.raise_()

    def closeEvent(self, event):
        self.closed.emit()
        super().closeEvent(event)


# ============================================================================
# Thumbnail Widget
# ============================================================================

class ThumbnailWidget(QFrame):
    """Widget displaying a single clip thumbnail."""

    clicked = pyqtSignal(int)
    delete_requested = pyqtSignal(int)
    mark_not_shot_requested = pyqtSignal(int)
    pin_requested = pyqtSignal(int)
    share_requested = pyqtSignal(int)

    def __init__(self, index: int, clip_info: Dict, thumbnail_path: Optional[Path], parent=None):
        super().__init__(parent)
        self.index = index
        self.clip_info = clip_info
        self.selected = False

        self.setObjectName("thumbCard")
        self.setFixedSize(170, 130)
        self.setCursor(QCursor(Qt.CursorShape.PointingHandCursor))
        self.setAttribute(Qt.WidgetAttribute.WA_Hover, True)
        self._update_style()

        layout = QVBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)
        layout.setSpacing(3)

        self.thumb_label = QLabel()
        self.thumb_label.setFixedSize(160, 90)
        self.thumb_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.thumb_label.setStyleSheet("background-color: #1a1a1a; border-radius: 4px;")

        if thumbnail_path and thumbnail_path.exists():
            pixmap = QPixmap(str(thumbnail_path))
            scaled = pixmap.scaled(160, 90, Qt.AspectRatioMode.KeepAspectRatio,
                                   Qt.TransformationMode.SmoothTransformation)
            if clip_info.get("pinned"):
                scaled = self._draw_star_on_pixmap(scaled)
            self.thumb_label.setPixmap(scaled)
        else:
            self.thumb_label.setText("Golf")
            self.thumb_label.setStyleSheet(
                "background-color: #1a1a1a; border-radius: 4px; color: #4a9eff; font-size: 18px;"
            )

        layout.addWidget(self.thumb_label)

        shot_num = clip_info["file"].replace("shot_", "").replace(".mp4", "")
        try:
            shot_display = str(int(shot_num))
        except (ValueError, TypeError):
            shot_display = shot_num
        star = "\u2605 " if clip_info.get("pinned") else ""
        cameras_text = f" ({clip_info.get('cameras', 1)} cam)" if clip_info.get("cameras", 1) > 1 else ""
        self.text_label = QLabel(f"{star}Shot {shot_display}{cameras_text}")
        self.text_label.setObjectName("shotLabel")
        self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.text_label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        layout.addWidget(self.text_label)

        self.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)

    def _update_style(self):
        if self.selected:
            self.setStyleSheet(
                "QFrame#thumbCard { background-color: #e0e0e0; border: 1px solid #999; border-radius: 8px; }"
            )
            if hasattr(self, 'text_label'):
                self.text_label.setStyleSheet("color: #222; font-size: 11px; background: transparent;")
        else:
            self.setStyleSheet(
                "QFrame#thumbCard { background-color: #2d2d2d; border: 1px solid #444; border-radius: 8px; }"
            )
            if hasattr(self, 'text_label'):
                self.text_label.setStyleSheet("color: #fff; font-size: 11px; background: transparent;")

    def set_selected(self, selected: bool):
        self.selected = selected
        self._update_style()

    def enterEvent(self, event):
        if not self.selected:
            self.setStyleSheet(
                "QFrame#thumbCard { background-color: #e0e0e0; border: 1px solid #999; border-radius: 8px; }"
            )
            self.text_label.setStyleSheet("color: #222; font-size: 11px; background: transparent;")
        super().enterEvent(event)

    def leaveEvent(self, event):
        if not self.selected:
            self.setStyleSheet(
                "QFrame#thumbCard { background-color: #2d2d2d; border: 1px solid #444; border-radius: 8px; }"
            )
            self.text_label.setStyleSheet("color: #fff; font-size: 11px; background: transparent;")
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self.index)

    @staticmethod
    def _draw_star_on_pixmap(pixmap: QPixmap) -> QPixmap:
        """Draw a gold star indicator on the top-right corner."""
        result = QPixmap(pixmap)
        painter = QPainter(result)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        font = painter.font()
        font.setPixelSize(18)
        painter.setFont(font)
        painter.setPen(QPen(QColor("#FFD700")))
        painter.drawText(result.width() - 22, 18, "\u2605")
        painter.end()
        return result

    def _show_context_menu(self, pos):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background-color: #2d2d2d; border: 1px solid #444; border-radius: 4px; padding: 4px; }
            QMenu::item { padding: 6px 20px; color: #ccc; }
            QMenu::item:selected { background-color: #4a9eff; color: white; }
        """)

        share_action = menu.addAction("Share to Phone")
        share_action.triggered.connect(lambda: self.share_requested.emit(self.index))

        pin_text = "Unpin Shot" if self.clip_info.get("pinned") else "Pin Shot"
        pin_action = menu.addAction(pin_text)
        pin_action.triggered.connect(lambda: self.pin_requested.emit(self.index))

        menu.addSeparator()

        delete_action = menu.addAction("Delete Shot")
        delete_action.triggered.connect(lambda: self.delete_requested.emit(self.index))

        not_shot_action = menu.addAction("Mark as Not a Shot")
        not_shot_action.triggered.connect(lambda: self.mark_not_shot_requested.emit(self.index))

        menu.exec(self.mapToGlobal(pos))


# ============================================================================
# Clip Gallery Widget
# ============================================================================

class ClipGallery(QScrollArea):
    """Scrollable gallery of shot thumbnails."""

    clip_selected = pyqtSignal(int)
    clip_deleted = pyqtSignal(int)
    clip_mark_not_shot = pyqtSignal(int)
    clip_pin_toggled = pyqtSignal(int)
    clip_share_requested = pyqtSignal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWidgetResizable(True)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setStyleSheet("""
            QScrollArea { background-color: #1e1e1e; border: none; }
            QScrollBar:vertical {
                background-color: #1e1e1e; width: 10px; margin: 0;
            }
            QScrollBar::handle:vertical {
                background-color: #444; border-radius: 5px; min-height: 30px;
            }
            QScrollBar::handle:vertical:hover { background-color: #555; }
        """)

        self.container = QWidget()
        self.grid_layout = QGridLayout(self.container)
        self.grid_layout.setContentsMargins(10, 10, 10, 10)
        self.grid_layout.setSpacing(10)
        self.grid_layout.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)

        self.setWidget(self.container)

        self.thumbnails: List[ThumbnailWidget] = []
        self.selected_index = -1

    def add_clip(self, clip_info: Dict, thumbnail_path: Optional[Path]):
        index = len(self.thumbnails)
        thumb = ThumbnailWidget(index, clip_info, thumbnail_path)
        thumb.clicked.connect(self._on_thumbnail_clicked)
        thumb.delete_requested.connect(self._on_delete_requested)
        thumb.mark_not_shot_requested.connect(self._on_mark_not_shot)
        thumb.pin_requested.connect(lambda idx: self.clip_pin_toggled.emit(idx))
        thumb.share_requested.connect(lambda idx: self.clip_share_requested.emit(idx))

        row = index // 3
        col = index % 3
        self.grid_layout.addWidget(thumb, row, col)
        self.thumbnails.append(thumb)

        self._on_thumbnail_clicked(index)

        QTimer.singleShot(100, lambda: self.verticalScrollBar().setValue(
            self.verticalScrollBar().maximum()
        ))

    def refresh(self, clips: List[Dict], session_folder: Path):
        for thumb in self.thumbnails:
            self.grid_layout.removeWidget(thumb)
            thumb.deleteLater()
        self.thumbnails.clear()
        self.selected_index = -1

        for i, clip_info in enumerate(clips):
            thumb_file = clip_info.get("thumbnail")
            thumb_path = session_folder / thumb_file if thumb_file else None

            thumb = ThumbnailWidget(i, clip_info, thumb_path)
            thumb.clicked.connect(self._on_thumbnail_clicked)
            thumb.delete_requested.connect(self._on_delete_requested)
            thumb.mark_not_shot_requested.connect(self._on_mark_not_shot)
            thumb.pin_requested.connect(lambda idx: self.clip_pin_toggled.emit(idx))
            thumb.share_requested.connect(lambda idx: self.clip_share_requested.emit(idx))

            row = i // 3
            col = i % 3
            self.grid_layout.addWidget(thumb, row, col)
            self.thumbnails.append(thumb)

    def deselect_all(self):
        """Deselect current thumbnail."""
        if 0 <= self.selected_index < len(self.thumbnails):
            self.thumbnails[self.selected_index].set_selected(False)
        self.selected_index = -1

    def _on_thumbnail_clicked(self, index: int):
        if 0 <= self.selected_index < len(self.thumbnails):
            self.thumbnails[self.selected_index].set_selected(False)

        self.selected_index = index
        if 0 <= index < len(self.thumbnails):
            self.thumbnails[index].set_selected(True)

        self.clip_selected.emit(index)

    def _on_delete_requested(self, index: int):
        self.clip_deleted.emit(index)

    def _on_mark_not_shot(self, index: int):
        self.clip_mark_not_shot.emit(index)


# ============================================================================
# Log Panel Handler
# ============================================================================

class QTextEditLogHandler(logging.Handler):
    """Logging handler that writes to a QTextEdit widget via signal."""

    class _Emitter(QWidget):
        log_signal = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self._emitter = self._Emitter()
        self.max_lines = 500

    @property
    def signal(self):
        return self._emitter.log_signal

    def emit(self, record):
        msg = self.format(record)
        self._emitter.log_signal.emit(msg)


class LogPanel(QWidget):
    """Scrollable log output panel."""

    report_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)

        self.text_edit = QTextEdit()
        self.text_edit.setReadOnly(True)
        self.text_edit.setStyleSheet("""
            QTextEdit {
                background-color: #1a1a1a; color: #aaa;
                border: none; font-family: Consolas, monospace; font-size: 11px;
            }
        """)
        layout.addWidget(self.text_edit)

        btn_row = QHBoxLayout()

        report_btn = QPushButton("Report Bug")
        report_btn.setStyleSheet("""
            QPushButton {
                background-color: #4a9eff; color: white;
                border: none; border-radius: 4px; padding: 4px 8px;
            }
            QPushButton:hover { background-color: #5aafff; }
        """)
        report_btn.clicked.connect(self.report_requested.emit)
        btn_row.addWidget(report_btn)

        clear_btn = QPushButton("Clear Log")
        clear_btn.setStyleSheet("""
            QPushButton {
                background-color: #3d3d3d; color: #ccc;
                border: 1px solid #555; border-radius: 4px; padding: 4px 8px;
            }
            QPushButton:hover { background-color: #4d4d4d; }
        """)
        clear_btn.clicked.connect(self.text_edit.clear)
        btn_row.addWidget(clear_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        self._max_lines = 500

    def append_log(self, message: str):
        self.text_edit.append(message)
        # Trim excess lines
        doc = self.text_edit.document()
        if doc.blockCount() > self._max_lines:
            cursor = QTextCursor(doc)
            cursor.movePosition(QTextCursor.MoveOperation.Start)
            cursor.movePosition(
                QTextCursor.MoveOperation.Down,
                QTextCursor.MoveMode.KeepAnchor,
                doc.blockCount() - self._max_lines,
            )
            cursor.removeSelectedText()
        # Scroll to bottom
        sb = self.text_edit.verticalScrollBar()
        sb.setValue(sb.maximum())
