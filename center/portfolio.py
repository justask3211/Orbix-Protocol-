"""Catalog presentation is independent of reducer versions and historical room access."""
from center.schema import PORTFOLIO_TEMPLATES
REALTIME_TEMPLATES = frozenset({'token-catch', 'boss-raid', 'combat-duel', 'level-runner'})
FEATURED_TEMPLATES = PORTFOLIO_TEMPLATES | {'number-hunt', 'reaction-duel'}
UNREADY_TEMPLATES = frozenset({'idle-rig', 'level-runner', 'pattern-recall', 'typing-sprint', 'live-quiz', 'memory-match', 'puzzle-sprint'})
PRACTICE_TEMPLATES = PORTFOLIO_TEMPLATES | {'number-hunt', 'reaction-duel', 'boss-raid', 'token-catch', 'combat-duel'}

def catalog_metadata(template_id, play_status='live'):
    placement = 'featured' if template_id in FEATURED_TEMPLATES else 'coming-soon' if template_id in UNREADY_TEMPLATES else 'more'
    return {'placement': 'hidden' if play_status == 'offline' else placement,
            'latencySensitivity': 'sensitive' if template_id in REALTIME_TEMPLATES else 'tolerant',
            'practiceAvailable': template_id in PRACTICE_TEMPLATES and play_status == 'live'}
