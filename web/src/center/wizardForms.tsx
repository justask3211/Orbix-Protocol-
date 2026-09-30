// Declarative per-template rule forms for the creator wizard.
// Each game declares its own settings with human labels, option lists and help text,
// so the wizard shows exactly one game's controls instead of a raw key dump.

export type RuleField =
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; help?: string; half?: boolean }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[]; help?: string; half?: boolean }
  | { kind: 'toggle'; key: string; label: string; help?: string; half?: boolean }
  | { kind: 'text'; key: string; label: string; placeholder?: string; help?: string; half?: boolean; maxLength?: number }

export type TemplateForm = {
  label: string
  fields: RuleField[]
  quiz?: boolean // template owns the questions editor
}

export const TEMPLATE_FORMS: Record<string, TemplateForm> = {
  'number-hunt': {
    label: 'Number Hunt',
    fields: [
      { kind: 'select', key: 'digits', label: 'Number width', half: true, options: [{ value: '4', label: '4 digits (1111–9999)' }, { value: '6', label: '6 digits (111111–999999)' }], help: 'Players type a guess; only this many digits are accepted.' },
      { kind: 'select', key: 'win_mode', label: 'Split rule', half: true, options: [{ value: 'first-hit', label: 'First hit takes all' }, { value: 'split-at-end', label: 'Split among all who hit' }] },
      { kind: 'number', key: 'min', label: 'Range start', half: true },
      { kind: 'number', key: 'max', label: 'Range end', half: true },
      { kind: 'number', key: 'guess_budget', label: 'Guesses per player', min: 1, max: 50, half: true, help: 'The round also ends when everyone runs out.' },
      { kind: 'number', key: 'target_count', label: 'Hidden numbers', min: 1, max: 20, half: true },
      { kind: 'select', key: 'hints', label: 'Warmer/colder hints', half: true, options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
      { kind: 'number', key: 'guess_cooldown_ms', label: 'Cooldown between guesses (ms)', min: 300, max: 2000, step: 100, half: true, help: 'Blocks spamming; 500 ms is a good pace.' },
    ],
  },
  'live-quiz': {
    label: 'Live Quiz',
    quiz: true,
    fields: [
      { kind: 'number', key: 'question_seconds', label: 'Seconds per question', min: 5, max: 60, half: true },
      { kind: 'select', key: 'scoring', label: 'Scoring', half: true, options: [{ value: 'accuracy', label: 'Correct answers only' }, { value: 'accuracy+speed', label: 'Correct + speed bonus' }] },
      { kind: 'number', key: 'speed_bonus_max', label: 'Max speed bonus points', min: 0, max: 50, half: true, help: 'Only used with the speed scoring mode.' },
      { kind: 'number', key: 'pass_percentage', label: 'Pass mark (%)', min: 0, max: 100, half: true },
      { kind: 'number', key: 'top_n', label: 'Paid slots', min: 1, max: 10, half: true, help: 'How many top scores earn rewards.' },
    ],
  },
  'memory-match': {
    label: 'Memory Match',
    fields: [
      { kind: 'number', key: 'pairs', label: 'Pairs on the board', min: 4, max: 18, half: true },
      { kind: 'select', key: 'score_mode', label: 'Score by', half: true, options: [{ value: 'moves', label: 'Fewest moves' }, { value: 'time', label: 'Fastest time' }] },
      { kind: 'number', key: 'move_cap', label: 'Move cap', min: 10, max: 500, half: true, help: 'The round ends early if everyone hits the cap.' },
      { kind: 'number', key: 'top_n', label: 'Paid slots', min: 1, max: 10, half: true },
    ],
  },
  'token-catch': {
    label: 'Token Catch',
    fields: [
      { kind: 'number', key: 'lanes', label: 'Lanes', min: 2, max: 5, half: true, help: 'Mobile players tap a lane to move.' },
      { kind: 'number', key: 'spawn_per_second', label: 'Falling objects per second', min: 1, max: 8, step: 1, half: true },
      { kind: 'select', key: 'fall_speed', label: 'Fall speed', half: true, options: [{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }] },
      { kind: 'number', key: 'hazard_chance_pct', label: 'Hazard chance (%)', min: 0, max: 50, half: true, help: 'Hazards cost points — 0 for a friendly room.' },
      { kind: 'number', key: 'win_threshold', label: 'Instant-win score', min: 5, max: 200, half: true, help: 'The round ends when someone reaches it.' },
      { kind: 'number', key: 'combo_cap', label: 'Combo multiplier cap', min: 1, max: 10, half: true },
      { kind: 'number', key: 'top_n', label: 'Paid slots', min: 1, max: 10, half: true },
    ],
  },
  'reaction-duel': {
    label: 'Reaction Duel',
    fields: [
      { kind: 'select', key: 'rounds', label: 'Best of', half: true, options: [{ value: '3', label: '3 rounds' }, { value: '5', label: '5 rounds' }, { value: '7', label: '7 rounds' }] },
      { kind: 'select', key: 'choice_set', label: 'Move set', half: true, options: [{ value: 'classic', label: 'Rock / paper / scissors' }, { value: 'extended', label: 'Extended (5 moves)' }] },
      { kind: 'number', key: 'choice_window_seconds', label: 'Commit window (s)', min: 5, max: 30, half: true },
      { kind: 'number', key: 'reveal_window_seconds', label: 'Reveal window (s)', min: 3, max: 15, half: true },
    ],
  },
  'puzzle-sprint': {
    label: 'Puzzle Sprint',
    fields: [
      { kind: 'select', key: 'board', label: 'Board size', half: true, options: [{ value: '3', label: '3 × 3' }, { value: '4', label: '4 × 4' }] },
      { kind: 'select', key: 'score_mode', label: 'Score by', half: true, options: [{ value: 'time', label: 'Fastest solve' }, { value: 'moves', label: 'Fewest moves' }] },
      { kind: 'number', key: 'move_cap', label: 'Move cap', min: 30, max: 1000, half: true },
      { kind: 'number', key: 'top_n', label: 'Paid slots', min: 1, max: 10, half: true },
    ],
  },
  'hash-hunt': {
    label: 'Hash Hunt',
    fields: [
      { kind: 'number', key: 'difficulty_bits', label: 'Difficulty (leading zero bits)', min: 12, max: 24, half: true, help: 'Higher = harder = longer round. 18 suits a browser miner.' },
      { kind: 'select', key: 'win_mode', label: 'Winner rule', half: true, options: [{ value: 'first-valid', label: 'First valid hash wins' }, { value: 'leaderboard', label: 'Leaderboard by best hash' }] },
      { kind: 'number', key: 'leaderboard_size', label: 'Leaderboard size', min: 3, max: 25, half: true },
    ],
  },
  'boss-raid': {
    label: 'Co-op Boss Raid',
    fields: [
      { kind: 'number', key: 'boss_health', label: 'Boss health', min: 1000, max: 100000, step: 500, half: true },
      { kind: 'select', key: 'reward_rule', label: 'Split the haul by', half: true, options: [{ value: 'proportional', label: 'Contribution share' }, { value: 'top-n', label: 'Top contributors' }, { value: 'milestone', label: 'Equal among finishers' }] },
      { kind: 'number', key: 'action_cooldown_ms', label: 'Hit cooldown (ms)', min: 300, max: 2000, step: 100, half: true },
      { kind: 'number', key: 'contribution_cap', label: 'Max contribution per player', min: 100, max: 10000, half: true, help: 'Stops one whale soloing the raid.' },
      { kind: 'number', key: 'min_contribution', label: 'Min contribution to earn', min: 0, max: 1000, half: true },
      { kind: 'number', key: 'top_n', label: 'Paid slots', min: 1, max: 10, half: true },
    ],
  },

  'rps-duel': {
    label: 'RPS Duel',
    fields: [
      { kind: 'select', key: 'rounds', label: 'Best of', half: true, options: [{ value: '3', label: '3 subrounds' }, { value: '5', label: '5 subrounds' }, { value: '7', label: '7 subrounds' }, { value: '9', label: '9 subrounds' }] },
      { kind: 'select', key: 'choice_set', label: 'Move set', half: true, options: [{ value: 'classic', label: 'Rock / paper / scissors' }, { value: 'extended', label: 'Extended (5 moves)' }] },
      { kind: 'number', key: 'choice_window_seconds', label: 'Commit window (s)', min: 5, max: 20, half: true, help: 'Time to lock in your move hash.' },
      { kind: 'number', key: 'reveal_window_seconds', label: 'Reveal window (s)', min: 3, max: 10, half: true, help: 'A missed reveal forfeits that subround.' },
    ],
  },
  'reward-grid': {
    label: 'Reward Grid',
    fields: [
      { kind: 'number', key: 'tiles', label: 'Tiles on the grid', min: 9, max: 100, half: true },
      { kind: 'number', key: 'reward_slots', label: 'Hidden reward slots', min: 1, max: 20, half: true, help: 'Placed by the server seed. Demo points only.' },
      { kind: 'number', key: 'reveal_cap_per_wallet', label: 'Reveals per wallet', min: 1, max: 20, half: true },
      { kind: 'number', key: 'duration_seconds', label: 'Round length (seconds)', min: 30, max: 600, half: true },
    ],
  },
  'logo-bingo': {
    label: 'Token-Logo Bingo',
    fields: [
      { kind: 'select', key: 'board', label: 'Board size', half: true, options: [{ value: '3', label: '3 × 3' }, { value: '4', label: '4 × 4' }] },
      { kind: 'select', key: 'win_mode', label: 'Win condition', half: true, options: [{ value: 'first-line', label: 'First line' }, { value: 'full-board', label: 'Full board' }] },
      { kind: 'number', key: 'call_cadence_seconds', label: 'Seconds between calls', min: 2, max: 8, half: true },
      { kind: 'number', key: 'duration_seconds', label: 'Round length (seconds)', min: 60, max: 600, half: true },
      { kind: 'toggle', key: 'free_centre', label: 'Free centre square (3×3 only)', half: true },
    ],
  },
  'pattern-recall': {
    label: 'Pattern Recall',
    fields: [
      { kind: 'number', key: 'symbols', label: 'Distinct symbols', min: 3, max: 12, half: true },
      { kind: 'number', key: 'start_length', label: 'Starting sequence length', min: 2, max: 4, half: true },
      { kind: 'number', key: 'growth', label: 'Symbols added per step', min: 1, max: 2, half: true },
      { kind: 'number', key: 'input_window_seconds', label: 'Input window (s)', min: 2, max: 10, half: true, help: 'Time to submit each recalled sequence.' },
    ],
  },
  'typing-sprint': {
    label: 'Typing Sprint',
    fields: [
      { kind: 'number', key: 'duration_seconds', label: 'Round length (seconds)', min: 30, max: 120, half: true },
      { kind: 'number', key: 'accuracy_floor', label: 'Accuracy floor (%)', min: 70, max: 99, half: true },
      { kind: 'select', key: 'prompt_id', label: 'Prompt pack', half: true, options: [{ value: 'crypto-basics', label: 'Crypto basics' }, { value: 'defi-terms', label: 'DeFi terms' }, { value: 'chain-names', label: 'Chain names' }], help: 'Moderated packs only — no free-text paste.' },
    ],
  },
  'maze-race': {
    label: 'Maze Race',
    fields: [
      { kind: 'number', key: 'maze_size', label: 'Maze size (N × N)', min: 10, max: 30, half: true, help: 'Generated solvable from the committed seed.' },
      { kind: 'number', key: 'duration_seconds', label: 'Time cap (seconds)', min: 60, max: 600, half: true },
      { kind: 'number', key: 'max_players', label: 'Player cap', min: 1, max: 100, half: true },
    ],
  },
  'level-runner': {
    label: 'Level Runner',
    fields: [
      { kind: 'select', key: 'lane_template', label: 'Obstacle template', half: true, options: [{ value: 'classic', label: 'Classic' }, { value: 'tight', label: 'Tight' }, { value: 'wide', label: 'Wide' }] },
      { kind: 'number', key: 'score_cap', label: 'Score cap (distance)', min: 100, max: 100000, step: 100, half: true, help: 'A hard stop — there is no farming loop.' },
      { kind: 'number', key: 'duration_seconds', label: 'Round length (seconds)', min: 30, max: 120, half: true },
    ],
  },
  'contract-detective': {
    label: 'Contract Detective',
    fields: [
      { kind: 'number', key: 'duration_seconds', label: 'Round length (seconds)', min: 60, max: 600, half: true },
      { kind: 'number', key: 'question_seconds', label: 'Seconds per question', min: 10, max: 60, half: true },
      { kind: 'select', key: 'category', label: 'Topic', half: true, options: [{ value: '', label: 'All topics' }, { value: 'reentrancy', label: 'Reentrancy' }, { value: 'overflow', label: 'Integer overflow' }, { value: 'access', label: 'Access control' }], help: 'Curated educational snippets. Not an audit.' },
    ],
  },
  'mev-rush': {
    label: 'MEV Rush',
    fields: [
      { kind: 'number', key: 'duration_seconds', label: 'Round length (seconds)', min: 60, max: 300, half: true },
      { kind: 'number', key: 'opportunity_cadence_seconds', label: 'Seconds between opportunities', min: 2, max: 15, half: true },
      { kind: 'select', key: 'bot_policy', label: 'Agents and bots', half: true, options: [{ value: 'allowed', label: 'Allowed' }, { value: 'allowlisted', label: 'Allowlisted only' }, { value: 'discouraged', label: 'Discouraged' }], help: 'Simulated queue — never real-chain frontrunning.' },
    ],
  },
  'idle-rig': {
    label: 'Idle Rig',
    fields: [
      { kind: 'number', key: 'session_seconds', label: 'Session length (seconds)', min: 120, max: 3600, step: 60, half: true, help: 'Server clock only — no off-line payout.' },
      { kind: 'number', key: 'upgrade_tiers', label: 'Upgrade tiers', min: 3, max: 10, half: true },
      { kind: 'number', key: 'inventory_cap', label: 'Campaign inventory cap', min: 100, max: 1000000, step: 100, half: true, help: 'Total prize inventory can never be exceeded.' },
    ],
  },
  'airdrop-quest': {
    label: 'Airdrop Quest',
    fields: [
      { kind: 'text', key: 'campaign_name', label: 'Campaign name', placeholder: 'Launch Week', half: true, maxLength: 60 },
      { kind: 'number', key: 'budget_points', label: 'Campaign budget (points)', min: 100, max: 10000000, step: 100, half: true },
      { kind: 'number', key: 'start_at', label: 'Starts at (unix)', min: 0, half: true },
      { kind: 'number', key: 'stop_at', label: 'Stops at (unix)', min: 1, half: true, help: 'The campaign stops hard at this time.' },
    ],
  },
}

export function ruleNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0
}

// -- quiz question editor ----------------------------------------------------

export type QuizQuestion = { prompt: string; choices: string[]; correct_index: number }

export function QuizEditor({ questions, onChange }: { questions: QuizQuestion[]; onChange: (q: QuizQuestion[]) => void }) {
  const update = (i: number, patch: Partial<QuizQuestion>) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  return (
    <div className="ct-quiz-editor">
      {questions.map((q, i) => (
        <div key={i} className="ct-quiz-q">
          <div className="ct-quiz-q-head">
            <b>Question {i + 1}</b>
            {questions.length > 1 && (
              <button className="link" onClick={() => onChange(questions.filter((_, j) => j !== i))}>
                remove
              </button>
            )}
          </div>
          <input value={q.prompt} placeholder="Ask something…" maxLength={500} onChange={(e) => update(i, { prompt: e.target.value })} />
          <div className="ct-quiz-choices">
            {q.choices.map((c, ci) => (
              <label key={ci} className={`ct-quiz-choice${q.correct_index === ci ? ' ok' : ''}`}>
                <input type="radio" name={`correct-${i}`} checked={q.correct_index === ci} onChange={() => update(i, { correct_index: ci })} aria-label={`Mark choice ${ci + 1} correct`} />
                <input value={c} maxLength={120} onChange={(e) => update(i, { choices: q.choices.map((x, j) => (j === ci ? e.target.value : x)) })} />
              </label>
            ))}
          </div>
          <div className="ct-quiz-q-foot">
            {q.choices.length < 6 && (
              <button className="link" onClick={() => update(i, { choices: [...q.choices, ''] })}>
                + choice
              </button>
            )}
            {q.choices.length > 2 && (
              <button className="link" onClick={() => update(i, { choices: q.choices.slice(0, -1), correct_index: Math.min(q.correct_index, q.choices.length - 2) })}>
                − choice
              </button>
            )}
            <span className="muted">tick the radio next to the correct answer — it stays on the server</span>
          </div>
        </div>
      ))}
      {questions.length < 20 && (
        <button
          className="btn-ghost"
          onClick={() => onChange([...questions, { prompt: '', choices: ['', '', ''], correct_index: 0 }])}
        >
          Add question
        </button>
      )}
    </div>
  )
}
