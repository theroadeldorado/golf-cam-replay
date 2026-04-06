"""Version info for ReplaySwing."""

__version__ = "0.3.9.4-beta"


def parse_version(v: str):
    """Parse 'vX.Y.Z-suffix' into ((X, Y, Z), suffix).

    Strips leading 'v', splits on '-' for suffix.
    Returns ((major, minor, patch), suffix_or_empty_string).
    """
    v = v.lstrip("v")
    if "-" in v:
        num_part, suffix = v.split("-", 1)
    else:
        num_part, suffix = v, ""
    parts = tuple(int(x) for x in num_part.split("."))
    # Pad to 3 elements
    while len(parts) < 3:
        parts = parts + (0,)
    return parts[:3], suffix


def is_newer(remote: str, local: str) -> bool:
    """Return True if remote version is newer than local.

    Stable (no suffix) beats pre-release (has suffix) at the same version.
    """
    r_nums, r_suffix = parse_version(remote)
    l_nums, l_suffix = parse_version(local)
    if r_nums > l_nums:
        return True
    if r_nums < l_nums:
        return False
    # Same numeric version: stable (no suffix) is newer than pre-release
    if l_suffix and not r_suffix:
        return True
    return False
