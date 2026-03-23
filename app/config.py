"""
Configuration and settings persistence for ReplaySwing.
"""

import json
import logging
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

SETTINGS_FILE = Path.home() / "GolfSwings" / "settings.json"
TRAINING_DATA_DIR = Path.home() / "GolfSwings" / "training_data"
LOG_DIR = Path.home() / "GolfSwings" / "logs"


@dataclass
class CameraPreset:
    """Saved camera configuration."""
    id: Any  # int for USB, str for network URL
    type: str = "usb"  # "usb" or "network"
    label: str = ""
    zoom: float = 1.0
    rotation: int = 0  # 0, 90, 180, 270
    flip_h: bool = False
    flip_v: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "label": self.label,
            "zoom": self.zoom,
            "rotation": self.rotation,
            "flip_h": self.flip_h,
            "flip_v": self.flip_v,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CameraPreset":
        return cls(
            id=data.get("id", 0),
            type=data.get("type", "usb"),
            label=data.get("label", ""),
            zoom=data.get("zoom", 1.0),
            rotation=data.get("rotation", 0),
            flip_h=data.get("flip_h", False),
            flip_v=data.get("flip_v", False),
        )


@dataclass
class AppConfig:
    """Application configuration settings."""
    # Recording settings
    pre_trigger_seconds: float = 1.0
    post_trigger_seconds: float = 1.33
    fps: int = 30

    # Audio settings
    audio_threshold: float = 0.3
    audio_sample_rate: int = 44100
    audio_chunk_size: int = 1024
    audio_device_index: Optional[int] = None
    audio_device_name: str = ""  # saved for matching across reboots (indices can change)

    # Storage settings
    base_dir: str = ""  # empty = default ~/GolfSwings

    # Session settings
    session_folder: str = ""

    # UI settings
    thumbnail_size: tuple = (160, 90)
    pip_size: tuple = (480, 270)
    pip_position: tuple = (100, 100)
    window_geometry: Optional[List[int]] = None
    playback_speed: float = 1.0

    # Camera settings
    cameras: List[CameraPreset] = field(default_factory=list)
    primary_camera: Any = 0  # int for USB, str for network URL

    # Person detection
    auto_ready_enabled: bool = False

    # Drawing overlays
    drawing_overlays: List[dict] = field(default_factory=list)

    @property
    def resolved_base_dir(self) -> Path:
        """Return the base directory, defaulting to ~/GolfSwings."""
        return Path(self.base_dir) if self.base_dir else Path.home() / "GolfSwings"

    @property
    def training_data_dir(self) -> Path:
        return self.resolved_base_dir / "training_data"

    @property
    def log_dir(self) -> Path:
        return self.resolved_base_dir / "logs"

    def __post_init__(self):
        if not self.session_folder:
            base = self.resolved_base_dir
            base.mkdir(parents=True, exist_ok=True)
            session_name = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            self.session_folder = str(base / session_name)
        self._validate()

    def _validate(self):
        """Clamp values to safe ranges."""
        self.fps = max(1, min(120, int(self.fps)))
        self.audio_threshold = max(0.01, min(1.0, float(self.audio_threshold)))
        self.playback_speed = max(0.1, min(10.0, float(self.playback_speed)))
        self.pre_trigger_seconds = max(0.5, min(30.0, float(self.pre_trigger_seconds)))
        self.post_trigger_seconds = max(0.5, min(30.0, float(self.post_trigger_seconds)))
        self.audio_sample_rate = max(8000, min(96000, int(self.audio_sample_rate)))
        self.audio_chunk_size = max(256, min(8192, int(self.audio_chunk_size)))

    def get_camera_ids(self) -> list:
        """Return list of camera IDs (int or str)."""
        return [c.id for c in self.cameras]

    def get_camera_preset(self, camera_id) -> Optional[CameraPreset]:
        """Get preset for a specific camera."""
        for c in self.cameras:
            if c.id == camera_id:
                return c
        return None

    def to_dict(self) -> dict:
        return {
            "base_dir": self.base_dir,
            "cameras": [c.to_dict() for c in self.cameras],
            "primary_camera": self.primary_camera,
            "audio_threshold": self.audio_threshold,
            "audio_device_index": self.audio_device_index,
            "audio_device_name": self.audio_device_name,
            "auto_ready_enabled": self.auto_ready_enabled,
            "playback_speed": self.playback_speed,
            "pip_position": list(self.pip_position),
            "pip_size": list(self.pip_size),
            "window_geometry": self.window_geometry,
            "drawing_overlays": self.drawing_overlays,
        }

    def update_from_dict(self, data: dict):
        """Load settings from a dict (from JSON)."""
        if "base_dir" in data:
            self.base_dir = data["base_dir"] or ""
        if "cameras" in data:
            self.cameras = [CameraPreset.from_dict(c) for c in data["cameras"]]
        if "primary_camera" in data:
            self.primary_camera = data["primary_camera"]
        if "audio_threshold" in data:
            self.audio_threshold = float(data["audio_threshold"])
        if "audio_device_index" in data:
            self.audio_device_index = data["audio_device_index"]
        if "audio_device_name" in data:
            self.audio_device_name = data.get("audio_device_name", "")
        if "auto_ready_enabled" in data:
            self.auto_ready_enabled = bool(data["auto_ready_enabled"])
        if "playback_speed" in data:
            self.playback_speed = float(data["playback_speed"])
        if "pip_position" in data:
            self.pip_position = tuple(data["pip_position"])
        if "pip_size" in data:
            self.pip_size = tuple(data["pip_size"])
        if "window_geometry" in data:
            self.window_geometry = data["window_geometry"]
        if "drawing_overlays" in data:
            self.drawing_overlays = data["drawing_overlays"]
        self._validate()


def load_settings(config: AppConfig):
    """Load settings from disk into config."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                data = json.load(f)
            config.update_from_dict(data)
            logger.info("Settings loaded from %s", SETTINGS_FILE)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Corrupt settings file, starting fresh: %s", e)
            corrupt_path = SETTINGS_FILE.with_suffix(".corrupt")
            try:
                SETTINGS_FILE.rename(corrupt_path)
                logger.info("Renamed corrupt settings to %s", corrupt_path)
            except OSError:
                pass
        except Exception as e:
            logger.warning("Failed to load settings: %s", e)


def save_settings(config: AppConfig):
    """Save config to disk using atomic temp-file-then-rename."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=SETTINGS_FILE.parent, suffix=".tmp", prefix="settings_"
        )
        try:
            with open(fd, "w") as f:
                json.dump(config.to_dict(), f, indent=2)
            Path(tmp_path).replace(SETTINGS_FILE)
        except BaseException:
            Path(tmp_path).unlink(missing_ok=True)
            raise
        logger.debug("Settings saved to %s", SETTINGS_FILE)
    except Exception as e:
        logger.warning("Failed to save settings: %s", e)
