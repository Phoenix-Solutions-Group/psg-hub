"""Data normalization utilities."""


def normalize_zip(value) -> str | None:
    """Normalize a zip code to 5-digit zero-padded string.

    Handles None, NaN, empty string, ZIP+4 format, integers, and short codes.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if raw == "" or raw.lower() == "nan":
        return None
    raw = raw.split("-")[0]
    return raw.zfill(5)


def normalize_fips(value, width: int) -> str | None:
    """Normalize a FIPS code to zero-padded string of given width.

    Args:
        value: Raw FIPS code (string or int).
        width: Target width (2 for state, 5 for county).
    """
    if value is None:
        return None
    raw = str(value).strip()
    if raw == "":
        return None
    return raw.zfill(width)
