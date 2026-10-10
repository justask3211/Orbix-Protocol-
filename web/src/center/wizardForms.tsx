// Declarative per-template rule forms for the creator wizard.
// Each game declares its own settings with human labels, option lists and help text,
// so the wizard shows exactly one game's controls instead of a raw key dump.

export type RuleField =
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; help?: string; half?: boolean }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string; description?: string; patch?: Record<string, unknown> }[]; help?: string; half?: boolean }
  | { kind: 'toggle'; key: string; label: string; help?: string; half?: boolean }
  | { kind: 'shares'; key: string; label: string; help?: string; half?: boolean }
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
      { kind: 'select', key: 'win_mode', label: 'Split rule', half: true, options: [{ value: 'first-hit', label: 'First hit takes all', description: 'The first exact guess ends the hunt.' }, { value: 'split-at-end', label: 'Split among all who hit', description: 'Continue until the clock ends and share among correct guessers.' }], help: 'Choose whether the first hit ends the match or every qualifying correct guesser can share at the deadline.' },
      { kind: 'number', key: 'min', label: 'Range start', half: true, help: 'The lowest number the server may choose. It must match your selected digit width.' },
      { kind: 'number', key: 'max', label: 'Range end', half: true, help: 'The highest possible hidden number. It must be greater than the range start.' },
      { kind: 'number', key: 'guess_budget', label: 'Guesses per player', min: 1, max: 50, half: true, help: 'The round also ends when everyone runs out.' },
      { kind: 'number', key: 'target_count', label: 'Hidden numbers', min: 1, max: 20, half: true, help: 'How many different secret numbers are chosen from the range for this hunt.' },
      { kind: 'select', key: 'hints', label: 'Warmer/colder hints', half: true, options: [{ value: 'on', label: 'Clues on', description: 'Get higher/lower guidance after a miss.' }, { value: 'off', label: 'Pure instinct', description: 'Guess without automatic clues.' }], help: 'Automatic direction clues help players narrow their search without revealing any secret target.' },
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
      { kind: 'number', key: 'loot_budget', label: 'Total airdrop loot', min: 1, max: 10000, help: 'The entire loot pool is divided across scheduled airdrops. In preview rooms this is a pool of game points; token prizes require confirmed contract funding.' },
      { kind: 'number', key: 'airdrop_count', label: 'Airdrops per round', min: 1, max: 30, half: true, help: 'Drops are spread across the round clock. More drops give players more places to compete for the shared pool.' },
      { kind: 'number', key: 'loot_chunk', label: 'Points per loot item', min: 1, max: 100, half: true, help: 'Each item is claimed separately. A 50-point crate with 5-point items offers ten loots shared by nearby players.' },
      { kind: 'number', key: 'gun_spawn_chance_pct', label: 'Gun drop chance (%)', min: 0, max: 100, half: true, help: 'Chance of an airdrop including a gun. A gun temporarily knocks out another player; it does not transfer their wallet funds.' },
      { kind: 'number', key: 'gun_shots', label: 'Shots per gun pickup', min: 1, max: 30, half: true, help: 'A gun has this many shots before it runs out. Each hit temporarily knocks out a rival.' },
      { kind: 'number', key: 'gun_knockout_seconds', label: 'Gun knockout (seconds)', min: 1, max: 15, half: true, help: 'How long a hit player sits out before respawning. Their collected loot remains in the match.' },
      { kind: 'number', key: 'punch_stun_seconds', label: 'Punch stun (seconds)', min: 1, max: 5, half: true, help: 'A close-range punch interrupts a rival briefly. They regain control after this time.' },
      { kind: 'number', key: 'lanes', label: 'Lanes', min: 3, max: 5, half: true, help: 'Mobile players tap a lane to move.' },
      { kind: 'number', key: 'spawn_per_second', label: 'Falling objects per second', min: 1, max: 8, step: 1, half: true },
      { kind: 'select', key: 'fall_speed', label: 'Fall speed', half: true, options: [{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }] },
      { kind: 'number', key: 'hazard_chance_pct', label: 'Bomb drop chance (%)', min: 0, max: 20, half: true, help: 'Bombs scatter half your collected points. Other players can pick up the spill.' },
      { kind: 'number', key: 'win_threshold', label: 'Minimum qualifying score', min: 1, max: 500, half: true, help: 'Reach this score to qualify. The timed arena continues until the round clock ends.' },
      { kind: 'number', key: 'combo_cap', label: 'Combo multiplier cap', min: 1, max: 5, half: true },
      { kind: 'number', key: 'top_n', label: 'Paid slots', min: 1, max: 10, half: true },
    ],
  },
  'reaction-duel': {
    label: 'Rock Paper Scissors Duel',
    fields: [
      { kind: 'select', key: 'rounds', label: 'Best of', half: true, options: [{ value: '3', label: '3 rounds', description: 'Quick showdown.' }, { value: '5', label: '5 rounds', description: 'Room for a comeback.' }, { value: '7', label: '7 rounds', description: 'A longer mind game.' }], help: 'Sets the number of committed-choice rounds played by both opponents.' },
      { kind: 'select', key: 'choice_set', label: 'Move set', half: true, options: [{ value: 'classic', label: 'Rock / paper / scissors', description: 'The familiar three-way matchup.' }, { value: 'extended', label: 'Extended (5 moves)', description: 'Add lizard and Spock.' }], help: 'Both players use the same choice set. Moves remain secret until the reveal phase.' },
      { kind: 'number', key: 'choice_window_seconds', label: 'Commit window (s)', min: 5, max: 20, half: true },
      { kind: 'number', key: 'reveal_window_seconds', label: 'Result display time (s)', min: 3, max: 10, half: true },
    ],
  },
  'combat-duel': {
    label: 'Combat Duel',
    fields: [
      {kind:'number',key:'starting_health',label:'Fighter starting health',min:50,max:300,help:'Both fighters start with the same health.'},
      {kind:'number',key:'attack_cooldown_ms',label:'Attack cooldown (ms)',min:300,max:1000,step:100,help:'Server limits each attack. Move and use shields between strikes.'},
      {kind:'number',key:'combo_window_ms',label:'Combo window (ms)',min:300,max:1500,step:100,help:'Link valid melee strikes within this window to build a combo. Both fighters use the same rules.'},
      {kind:'toggle',key:'allow_guns',label:'Allow gun pickups',help:'Enable ranged gun pickups alongside fists, swords and spears. Leave off for a melee-only duel.'},
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
    label: 'Boss Raid Arena',
    fields: [
      {kind:'select',key:'team_size',label:'Players per crew',options:[{value:'2',label:'Duo · 2',description:'Two partners, one shared damage score.'},{value:'3',label:'Trio · 3',description:'A close three-person crew.'},{value:'4',label:'Squad · 4',description:'Four teammates fight together.'},{value:'5',label:'Crew · 5',description:'The largest team formation.'}],help:'Pick a team in the lobby; unassigned players are automatically placed at start.'},
      {kind:'select',key:'winning_teams',label:'Teams that share the prize',options:[{value:'1',label:'Winner takes all',description:'First crew receives 100% of the pool.',patch:{team_reward_shares:[100]}},{value:'2',label:'Top two crews',description:'First receives 70%; second receives 30%.',patch:{team_reward_shares:[70,30]}},{value:'3',label:'Top three podium',description:'First 60%, second 25%, third 15%.',patch:{team_reward_shares:[60,25,15]}}],help:'Crews are ranked by confirmed boss damage. Choose a preset, then adjust the podium shares; the total must equal 100%.'},
      {kind:'shares',key:'team_reward_shares',label:'Podium reward shares',help:'These percentages split the complete reward pool across the ranked crews. Exactly 100% must be assigned; an absent qualifying crew does not redirect its share to another crew.'},
      {kind:'select',key:'team_member_split',label:'Share within each winning crew',options:[{value:'equal',label:'Equal crew share',description:'Each qualifying teammate receives the same share.'},{value:'damage',label:'Damage contribution',description:'Qualifying teammates share according to boss damage.'}],help:'First assign the podium prize to each winning crew, then divide that crew’s prize using this rule.'},
      {kind:'number',key:'starting_gun_damage',label:'Starting gun damage',min:5,max:40,half:true,help:'Every player spawns with equal gun damage and fire rate. Boss drops can upgrade those weapons during the match.'},
      {kind:'number',key:'upgrade_interval_seconds',label:'Boss upgrade interval (seconds)',min:10,max:120,half:true,help:'The boss periodically releases upgrades while its health falls. Players must move to the pickup to improve their gun.'},
      {kind:'number',key:'knockout_seconds',label:'Respawn delay (seconds)',min:3,max:15,half:true,help:'Players whose health reaches zero wait this long before respawning. Crew damage remains recorded.'},
      { kind: 'number', key: 'boss_health', label: 'Boss health', min: 1000, max: 100000, step: 500, half: true },
      { kind: 'select', key: 'reward_rule', label: 'Split the haul by', half: true, options: [{ value: 'proportional', label: 'Contribution share' }, { value: 'top-n', label: 'Top contributors' }, { value: 'milestone', label: 'Equal among finishers' }] },
      { kind: 'number', key: 'action_cooldown_ms', label: 'Hit cooldown (ms)', min: 300, max: 2000, step: 100, half: true },
      { kind: 'number', key: 'contribution_cap', label: 'Max contribution per player', min: 100, max: 10000, half: true, help: 'Each player has a maximum contribution budget.' },
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
      { kind: 'number', key: 'reveal_window_seconds', label: 'Result display time (s)', min: 3, max: 10, half: true, help: 'The server reveals automatically. No choice forfeits the subround.' },
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
