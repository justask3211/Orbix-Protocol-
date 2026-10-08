"""Bounded raster decoding and atomic avatar replacement, independent of funding."""
import base64
import binascii
import hashlib
from io import BytesIO
import os
from pathlib import Path
import tempfile
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 16_000_000


def prepare_avatar(value: object) -> bytes:
    if not isinstance(value, str) or len(value) > (MAX_BYTES + 2) // 3 * 4 + 64:
        raise ValueError('Image must be a base64 raster under 2 MB.')
    header, separator, encoded = value.partition(',')
    if not separator or header.lower() not in {'data:image/webp;base64', 'data:image/png;base64', 'data:image/jpeg;base64'}:
        raise ValueError('Choose a WebP, PNG or JPEG image.')
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_BYTES:
            raise ValueError('Image must be under 2 MB.')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {'WEBP', 'PNG', 'JPEG'} or source.width * source.height > MAX_PIXELS:
                    raise ValueError('Image format or dimensions are unsupported.')
                source.load()
                image = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGBA'), (256, 256), method=Image.Resampling.LANCZOS)
                output = BytesIO()
                image.save(output, format='WEBP', quality=85)
                return output.getvalue()
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError('Could not decode image.') from error


def avatar_path(address: str) -> Path:
    return Path(os.environ.get('CENTER_AVATARS_DIR', '/data/avatars')) / f'{address.lower().removeprefix("0x")}.webp'


def write_avatar(address: str, data: bytes) -> str:
    path = avatar_path(address)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Unique temporary files avoid racing truncations; readers see one complete version.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.tmp', delete=False) as stream:
            temporary = stream.name
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return hashlib.sha256(data).hexdigest()
