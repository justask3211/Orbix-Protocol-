"""Original cosmetic catalog; no gameplay statistics or client-owned positions."""
CHARACTERS = ('cat', 'turtle', 'blob', 'knight', 'cat-blob', 'duckling', 'astronaut', 'toy-robot',
              'pancake', 'jelly-ninja', 'sprout', 'marshmallow')
DEFAULT_COSMETICS = {'hat': 'none', 'glasses': 'none', 'outfit': 'default', 'accessory': 'none'}
import json
from pathlib import Path
CATALOG = json.loads(Path(__file__).with_name('cosmetics_catalog.json').read_text())
CATALOG_VERSION = CATALOG['version']
OPTIONS = {key: set(values) for key, values in CATALOG['options'].items()}



def validate_customization(character, cosmetics):
    if not isinstance(character, str) or character not in CHARACTERS:
        raise ValueError('Choose an available Orbix character.')
    if not isinstance(cosmetics, dict) or set(cosmetics) - set(OPTIONS):
        raise ValueError('Unknown cosmetic option.')
    result = {**DEFAULT_COSMETICS, **cosmetics}
    if any(not isinstance(value, str) or value not in OPTIONS[key] for key, value in result.items()):
        raise ValueError('Choose an available cosmetic.')
    return character, result
