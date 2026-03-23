"""Tests for config.py — AppConfig, CameraPreset, load/save settings."""

import json

import pytest

from config import AppConfig, CameraPreset, load_settings, save_settings
import config as config_module


# ---------------------------------------------------------------------------
# 1. Default values
# ---------------------------------------------------------------------------

def test_app_config_defaults():
    """Verify default values are sane."""
    cfg = AppConfig()

    assert cfg.fps == 30
    assert cfg.pre_trigger_seconds == 1.0
    assert cfg.post_trigger_seconds == 1.33
    assert cfg.audio_threshold == 0.3
    assert cfg.audio_sample_rate == 44100
    assert cfg.audio_chunk_size == 1024
    assert cfg.playback_speed == 1.0
    assert cfg.primary_camera == 0
    assert cfg.cameras == []
    assert cfg.auto_ready_enabled is False
    assert cfg.audio_device_index is None


# ---------------------------------------------------------------------------
# 2. __post_init__ creates session_folder
# ---------------------------------------------------------------------------

def test_app_config_creates_session_folder():
    """Verify __post_init__ sets session_folder to a non-empty string."""
    cfg = AppConfig()

    assert cfg.session_folder != ""
    assert "GolfSwings" in cfg.session_folder


# ---------------------------------------------------------------------------
# 3. _validate clamps fps
# ---------------------------------------------------------------------------

def test_validate_clamps_fps():
    """fps below 1 should clamp to 1, above 120 should clamp to 120."""
    cfg_low = AppConfig(fps=0)
    assert cfg_low.fps == 1

    cfg_high = AppConfig(fps=999)
    assert cfg_high.fps == 120


# ---------------------------------------------------------------------------
# 4. _validate clamps audio_threshold
# ---------------------------------------------------------------------------

def test_validate_clamps_threshold():
    """audio_threshold should be clamped to [0.01, 1.0]."""
    cfg_low = AppConfig(audio_threshold=-5.0)
    assert cfg_low.audio_threshold == pytest.approx(0.01)

    cfg_high = AppConfig(audio_threshold=99.0)
    assert cfg_high.audio_threshold == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# 5. _validate clamps playback_speed
# ---------------------------------------------------------------------------

def test_validate_clamps_playback_speed():
    """playback_speed should be clamped to [0.1, 10.0]."""
    cfg_low = AppConfig(playback_speed=0.0)
    assert cfg_low.playback_speed == pytest.approx(0.1)

    cfg_high = AppConfig(playback_speed=100.0)
    assert cfg_high.playback_speed == pytest.approx(10.0)


# ---------------------------------------------------------------------------
# 6. CameraPreset round-trip via to_dict / from_dict
# ---------------------------------------------------------------------------

def test_camera_preset_round_trip():
    """to_dict then from_dict should preserve all values."""
    preset = CameraPreset(
        id=2,
        type="network",
        label="Side Camera",
        zoom=2.5,
        rotation=90,
        flip_h=True,
        flip_v=False,
    )
    d = preset.to_dict()
    restored = CameraPreset.from_dict(d)

    assert restored.id == preset.id
    assert restored.type == preset.type
    assert restored.label == preset.label
    assert restored.zoom == pytest.approx(preset.zoom)
    assert restored.rotation == preset.rotation
    assert restored.flip_h == preset.flip_h
    assert restored.flip_v == preset.flip_v


# ---------------------------------------------------------------------------
# 7. AppConfig round-trip via to_dict / update_from_dict
# ---------------------------------------------------------------------------

def test_app_config_to_dict_from_dict():
    """Round-trip through to_dict and update_from_dict preserves values."""
    original = AppConfig(
        audio_threshold=0.5,
        playback_speed=2.0,
        primary_camera=1,
        auto_ready_enabled=True,
        pip_position=(200, 300),
        pip_size=(640, 360),
        cameras=[
            CameraPreset(id=0, label="Front"),
            CameraPreset(id="rtsp://cam2", type="network", label="Rear"),
        ],
    )
    d = original.to_dict()

    restored = AppConfig()
    restored.update_from_dict(d)

    assert restored.audio_threshold == pytest.approx(original.audio_threshold)
    assert restored.playback_speed == pytest.approx(original.playback_speed)
    assert restored.primary_camera == original.primary_camera
    assert restored.auto_ready_enabled == original.auto_ready_enabled
    assert restored.pip_position == original.pip_position
    assert restored.pip_size == original.pip_size
    assert len(restored.cameras) == 2
    assert restored.cameras[0].label == "Front"
    assert restored.cameras[1].id == "rtsp://cam2"
    assert restored.cameras[1].type == "network"


# ---------------------------------------------------------------------------
# 8. save then load round-trip on disk
# ---------------------------------------------------------------------------

def test_save_load_settings(tmp_path, monkeypatch):
    """save_settings then load_settings should preserve config values."""
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(config_module, "SETTINGS_FILE", settings_file)

    cfg = AppConfig(
        audio_threshold=0.75,
        playback_speed=0.5,
        primary_camera=2,
        cameras=[CameraPreset(id=0, label="Test Cam")],
    )
    save_settings(cfg)
    assert settings_file.exists()

    loaded = AppConfig()
    load_settings(loaded)

    assert loaded.audio_threshold == pytest.approx(0.75)
    assert loaded.playback_speed == pytest.approx(0.5)
    assert loaded.primary_camera == 2
    assert len(loaded.cameras) == 1
    assert loaded.cameras[0].label == "Test Cam"


# ---------------------------------------------------------------------------
# 9. Corrupt settings file recovery
# ---------------------------------------------------------------------------

def test_corrupt_settings_recovery(tmp_path, monkeypatch):
    """Corrupt JSON should be renamed to .corrupt; load_settings must not crash."""
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(config_module, "SETTINGS_FILE", settings_file)

    settings_file.write_text("{this is not valid json!!!")

    cfg = AppConfig()
    load_settings(cfg)  # must not raise

    corrupt_file = settings_file.with_suffix(".corrupt")
    assert corrupt_file.exists(), "Corrupt file should be renamed to .corrupt"
    assert not settings_file.exists(), "Original corrupt file should be gone"


# ---------------------------------------------------------------------------
# 10. primary_camera accepts string (network URL)
# ---------------------------------------------------------------------------

def test_primary_camera_accepts_string():
    """primary_camera should accept a string URL without errors."""
    cfg = AppConfig(primary_camera="rtsp://192.168.1.100:554/stream")

    assert cfg.primary_camera == "rtsp://192.168.1.100:554/stream"
    assert isinstance(cfg.primary_camera, str)
