"""Auto-update checker for ReplaySwing.

Checks GitHub Releases on startup and shows a non-intrusive banner
if a newer version is available.
"""

import json
import logging
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton
from PyQt6.QtCore import QThread, pyqtSignal, Qt

from version import __version__
try:
    from version import is_newer
except ImportError:
    is_newer = None

logger = logging.getLogger(__name__)

UPDATE_STATE_FILE = Path.home() / "GolfSwings" / "update_state.json"
RELEASES_URL = "https://api.github.com/repos/theroadeldorado/replay-swing/releases?per_page=5"
THROTTLE_HOURS = 24


def _load_update_state() -> dict:
    if UPDATE_STATE_FILE.exists():
        try:
            with open(UPDATE_STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_update_state(state: dict):
    UPDATE_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=UPDATE_STATE_FILE.parent, suffix=".tmp", prefix="update_"
        )
        try:
            with open(fd, "w") as f:
                json.dump(state, f, indent=2)
            Path(tmp_path).replace(UPDATE_STATE_FILE)
        except BaseException:
            Path(tmp_path).unlink(missing_ok=True)
            raise
    except Exception as e:
        logger.debug("Failed to save update state: %s", e)


def _is_throttled(state: dict) -> bool:
    last = state.get("last_check_iso")
    if not last:
        return False
    try:
        last_dt = datetime.fromisoformat(last)
        elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
        return elapsed < THROTTLE_HOURS * 3600
    except Exception:
        return False


class UpdateChecker(QThread):
    """Background thread that checks GitHub for newer releases."""

    update_available = pyqtSignal(str, str, str, int)  # version, download_url, release_url, file_size
    check_complete = pyqtSignal()

    def run(self):
        try:
            if is_newer is None:
                logger.debug("is_newer not available, skipping update check")
                return

            state = _load_update_state()
            if _is_throttled(state):
                logger.debug("Update check throttled, skipping")
                return

            req = Request(RELEASES_URL, headers={"Accept": "application/vnd.github+json"})
            with urlopen(req, timeout=10) as resp:
                releases = json.loads(resp.read().decode())

            for release in releases:
                tag = release.get("tag_name", "")
                if not is_newer(tag, __version__):
                    continue
                if tag.lstrip("v") == state.get("skipped_version"):
                    continue

                # Find platform-appropriate asset
                if sys.platform == "darwin":
                    extensions = (".dmg",)
                elif sys.platform == "win32":
                    extensions = (".exe",)
                else:
                    extensions = (".dmg", ".exe")
                for asset in release.get("assets", []):
                    if asset["name"].lower().endswith(extensions):
                        self.update_available.emit(
                            tag.lstrip("v"),
                            asset["browser_download_url"],
                            release.get("html_url", ""),
                            asset.get("size", 0),
                        )
                        break

                # Only consider the first (newest) matching release
                break

            state["last_check_iso"] = datetime.now(timezone.utc).isoformat()
            _save_update_state(state)

        except (URLError, OSError, json.JSONDecodeError, KeyError) as e:
            logger.debug("Update check failed: %s", e)
        except Exception as e:
            logger.debug("Update check unexpected error: %s", e)
        finally:
            self.check_complete.emit()


class UpdateBanner(QFrame):
    """Non-intrusive banner shown when an update is available."""

    download_clicked = pyqtSignal(str)   # download_url
    skipped = pyqtSignal(str)            # version
    dismissed = pyqtSignal()

    def __init__(self, version: str, download_url: str, file_size: int, parent=None):
        super().__init__(parent)
        self._version = version
        self._download_url = download_url

        self.setStyleSheet(
            "UpdateBanner {"
            "  background-color: #1a3a5c;"
            "  border: 1px solid #4a9eff;"
            "  border-radius: 6px;"
            "}"
        )
        self.setFixedHeight(36)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 0, 8, 0)
        layout.setSpacing(8)

        size_str = f" ({file_size // (1024 * 1024)} MB)" if file_size > 0 else ""
        label = QLabel(f"ReplaySwing v{version} available{size_str}")
        label.setStyleSheet("color: #d4d4d4; font-size: 12px; border: none; background: transparent;")
        layout.addWidget(label)
        layout.addStretch()

        dl_btn = QPushButton("Download")
        dl_btn.setStyleSheet(
            "QPushButton { background-color: #4a9eff; color: white; border: none;"
            " border-radius: 4px; padding: 4px 14px; font-size: 11px; font-weight: bold; }"
            "QPushButton:hover { background-color: #5aafff; }"
        )
        dl_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        dl_btn.clicked.connect(lambda: self.download_clicked.emit(self._download_url))
        layout.addWidget(dl_btn)

        skip_btn = QPushButton("Skip")
        skip_btn.setStyleSheet(
            "QPushButton { background-color: transparent; color: #7a7a7a; border: none;"
            " font-size: 11px; padding: 4px 8px; }"
            "QPushButton:hover { color: #aaa; }"
        )
        skip_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        skip_btn.clicked.connect(lambda: self.skipped.emit(self._version))
        layout.addWidget(skip_btn)

        close_btn = QPushButton("\u00d7")
        close_btn.setFixedSize(20, 20)
        close_btn.setStyleSheet(
            "QPushButton { background-color: transparent; color: #7a7a7a; border: none;"
            " font-size: 16px; font-weight: bold; padding: 0; }"
            "QPushButton:hover { color: #d4d4d4; }"
        )
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.clicked.connect(self.dismissed.emit)
        layout.addWidget(close_btn)
