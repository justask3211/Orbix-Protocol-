"""Original cosmetic catalog; no gameplay statistics or client-owned positions."""
CHARACTERS = ('blob', 'knight', 'cat-blob', 'duckling', 'astronaut', 'toy-robot',
              'pancake', 'jelly-ninja', 'sprout', 'marshmallow')
DEFAULT_COSMETICS = {'hat': 'none', 'glasses': 'none', 'outfit': 'default', 'accessory': 'none'}
OPTIONS = {'hat': {'none', 'cap', 'crown', 'bow'}, 'glasses': {'none', 'round', 'visor'},
           'outfit': {'default', 'coral', 'mint', 'lilac', 'dress'},
           'accessory': {'none', 'scarf', 'backpack'}}


def validate_customization(character, cosmetics):
    if not isinstance(character, str) or character not in CHARACTERS:
        raise ValueError('Choose one of the ten Orbix characters.')
    if not isinstance(cosmetics, dict) or set(cosmetics) - set(OPTIONS):
        raise ValueError('Unknown cosmetic option.')
    result = {**DEFAULT_COSMETICS, **cosmetics}
    if any(not isinstance(value, str) or value not in OPTIONS[key] for key, value in result.items()):
        raise ValueError('Choose an available cosmetic.')
    return character, result
