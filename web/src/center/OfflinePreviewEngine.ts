import fixtures from './previewFixtures.json'
import { stateGround } from './worlds/terrain'

const FIXTURES = fixtures as Record<string, { me: string; players: string[]; state: Record<string, any> }>
/** A deliberately disconnected demo reducer. It has no transport, credentials,
 * storage, room runtime or settlement path. Fixture seed is public demo data. */
export class OfflinePreviewEngine {
  readonly me: string
  readonly players: string[]
  private state: Record<string, any>
  private movement = { dx: 0, dz: 0, sprint: false }
  private elapsed = 0
  private target = 5555
  private randomState = 2166136261
  constructor(readonly templateId: string, seed = 'orbix-offline-demo-v1') {
    const fixture = FIXTURES[templateId]
    if (!fixture) throw new Error('Unknown preview game.')
    this.me = fixture.me; this.players = [...fixture.players]
    for (const c of seed + templateId) this.randomState = Math.imul(this.randomState ^ c.charCodeAt(0), 16777619) >>> 0
    this.state = structuredClone(fixture.state)
    this.target = 1111 + Math.floor(this.random()*8889)
    Object.assign(this.state, {_offline: true, _canAct: true, _connection: 'open', _playerNames: Object.fromEntries(this.players.map((p, i) => [p, i ? 'Demo bot' : 'You'])), finished: false})
    if (this.state.arena) {
      this.state.duration = 86400
      if (templateId === 'token-catch') {
        this.state.airdrops = [{id: 'offline-airdrop', x: 2, z: 2, y: stateGround(this.state, 2, 2), landAt: 0, value: 50, opened: false}]
        this.state.drops.push({id:'offline-coin',kind:'coin',value:5,x:1,z:3,y:stateGround(this.state,1,3),landAt:0,expiresAt:86400000})
      }
    }
    if (templateId === 'prism-lines') this.state.currentPlayer = this.me
    if (templateId === 'mev-rush') this.state.live = [0, 1, 2]
    if (templateId === 'logo-bingo') this.state.calls = Array.from({length: 9}, (_, i) => i + 1)
  }
  private random() {
    this.randomState ^= this.randomState << 13; this.randomState ^= this.randomState >>> 17; this.randomState ^= this.randomState << 5
    return (this.randomState >>> 0) / 4294967296
  }
  snapshot() {
    return { ...structuredClone(this.state), serverTimeMs: Date.now(), serverTime: Date.now()/1000, startedAt: Date.now()/1000-this.elapsed,
      phaseStartedAt: Date.now()/1000, phaseDeadline: Date.now()/1000+3600, deadline: Date.now()/1000+86400 }
  }
  tick(dt: number) {
    const s = this.state, body = s.bodies?.[this.me]
    dt = Math.min(.05, Math.max(0, dt)); this.elapsed += dt
    if (body) {
      const speed = Number(body.speed || 5) * (this.movement.sprint ? 1.6 : 1)
      const x = body.x + this.movement.dx * speed * dt, z = body.z + this.movement.dz * speed * dt
      const width = (s.bounds?.width ?? 40) / 2 - 1, depth = (s.bounds?.depth ?? 40) / 2 - 1
      body.x = Math.max(-width, Math.min(width, x)); body.z = Math.max(-depth, Math.min(depth, z))
      const ground = stateGround(s, body.x, body.z)
      body.groundHeight = ground
      if (!body.onGround) { body.vy -= 18 * dt; body.y += body.vy * dt }
      if (body.onGround || body.y <= ground) {body.y = ground; body.vy = 0; body.onGround = true}
      body.moving = Boolean(this.movement.dx || this.movement.dz); body.sprinting = this.movement.sprint
      s.nowMs = this.elapsed * 1000; s.tick = (s.tick ?? 0) + 1
    }
    if (this.templateId === 'idle-rig') s.earned[this.me] += dt * s.levels[this.me] * 10
  }
  private points(value: number) {
    const s=this.state; s.scores ??= {}; s.scores[this.me] = (s.scores[this.me] ?? 0) + value
    if (s.bodies?.[this.me]) s.bodies[this.me].score = s.scores[this.me]
  }
  act(a: Record<string, any>) {
    const s = this.state, me = this.me, body = s.bodies?.[me], rival = this.players[1]
    s._actionError = null
    if (body) {
      if (a.kind === 'move') {
        const dx=Number(a.dx)||0, dz=Number(a.dz)||0, length=Math.max(1,Math.hypot(dx,dz))
        this.movement = {dx: dx/length, dz: dz/length, sprint: Boolean(a.sprint)}
        body.yaw=Number(a.yaw)||0;body.aimPitch=Number(a.aimPitch)||0;body.inputSeq=a.seq??body.inputSeq
      } else if (a.kind === 'jump') { body.vy=7; body.onGround=false }
      else if (a.kind === 'block') body.blocking=Boolean(a.active)
      else if (a.kind === 'character') body.character=a.character
      else if (a.kind === 'equip') {if(a.character)body.character=a.character;else if(a.weapon)body.weapon=a.weapon}
      else if (a.kind === 'dodge') { body.x+=Math.sin(body.yaw)*2;body.z+=Math.cos(body.yaw)*2 }
      else if (a.kind === 'open_airdrop') {
        const drop=s.airdrops.find((d:any)=>d.id===a.dropId && !d.opened)
        if (drop) {drop.opened=true;s.drops.push({id:'offline-loot-'+s.tick,kind:'coin',value:50,x:drop.x,z:drop.z,y:drop.y,landAt:0,expiresAt:86400000})}
      } else if (a.kind === 'loot' || a.kind === 'interact') {
        const drop=s.drops.find((d:any)=>a.dropId ? d.id===a.dropId : Math.hypot(d.x-body.x,d.z-body.z)<3)
        if(drop) {this.points(drop.kind==='coin'?Number(drop.value)||5:0);if(['sword','spear','gun','shield'].includes(drop.kind))body.weapon=drop.kind;s.drops=s.drops.filter((d:any)=>d!==drop)}
      } else if (['attack','punch','push'].includes(a.kind)) {
        const target=s.boss??s.bodies[rival]
        if(target) target.hp=Math.max(1,target.hp-12)
        body.lastAttackAt=Date.now(); body.attackReadyAt=0; this.points(12)
      }
      return
    }
    if (a.kind === 'hint') {
      const key = this.templateId==='prism-lines'?'turnIndex':this.templateId==='relic-auction'?'auctionIndex':'challengeIndex'
      const rack=String(s.challenge?.rack??'')
      const payload = this.templateId==='word-forge'?{sortedRack:rack.split('').sort().join(''),counts:Object.fromEntries([...new Set(rack)].map(c=>[c,rack.split(c).length-1]))}:this.templateId==='prism-lines'?{columns:Array.from({length:s.columns},(_,i)=>i).filter(c=>s.board[0][c]==null)}:this.templateId==='relic-auction'?{gameCredits:s.balances[me],spent:0,colours:{amber:0,jade:0,violet:0},formula:'Local demo values',setBonus:s.setBonus}:{lower:s.challenge?.lower,upper:s.challenge?.upper,unit:s.challenge?.unit,message:'Offline hint: explore the displayed challenge.'}
      s.hintReceipt = {[key]:s.index,payload};s.hintsRemaining=Math.max(0,(s.hintsRemaining??1)-1);return
    }
    switch(this.templateId) {
      case 'number-hunt': {
        const target = this.target, guess=Number(a.number)
        if(a.kind==='guess') {s.remaining[me]=Math.max(0,s.remaining[me]-1);s.guessCount[me]++;s.hint={direction:guess<target?'higher':'lower'};s.guessLog.push({who:me,number:guess,hit:false,hint:{direction:guess<target?'higher':'lower'},at:Date.now()/1000});this.points(1)}
        break
      }
      case 'prism-lines': {
        const c=Number(a.column);if(a.kind!=='drop'||!Number.isInteger(c)||c<0||c>=s.columns)return
        const drop=(column:number,who:string)=>{for(let r=s.rows-1;r>=0;r--)if(s.board[r][column]==null){s.board[r][column]=who;return true}return false}
        if(drop(c,me)){s.legalDrops[me]++;s.index+=2;s.turnIndex=s.index;drop(Math.floor(this.random()*s.columns),rival);s.currentPlayer=me;this.points(1)}
        break
      }
      case 'closest-call': case 'word-forge': case 'atlas-quest': case 'relic-auction': {
        if(!['estimate','word','pin','bid'].includes(a.kind))return
        const key=this.templateId==='relic-auction'?'auctionIndex':'challengeIndex'
        const submission=a.kind==='word'?a.text:a.kind==='pin'?{col:a.col,row:a.row}:a.kind==='bid'?a.amount:a.value
        s.ownSubmission={[key]:s.index,receiptId:a.actionId??String(this.elapsed),submission};s.submitted[me]=true
        s._demoAdvanceAt=this.elapsed+1.2;this.points(a.kind==='word'?String(a.text).length*100:100)
        break
      }
      case 'reaction-duel': case 'rps-duel': {
        if(a.kind==='commit'){s.committed[me]=true;s.committed[rival]=true;s.ownSelection={choice:a.choice,subroundIndex:s.roundIndex};s._demoAdvanceAt=this.elapsed+1}
        break
      }
      case 'memory-match': {
        if(a.kind!=='flip')return
        const cards=s.cards??Array(s.pairs*2).fill(null), index=Number(a.index)
        if(index<0||index>=cards.length)return
        cards[index]=index%s.pairs;s.cards=cards;s.moves[me]++;this.points(1);break
      }
      case 'puzzle-sprint': {
        const i=s.board.indexOf(Number(a.tile)),blank=s.board.indexOf(0)
        if(i>=0&&(Math.abs(i-blank)===s.size||Math.floor(i/s.size)===Math.floor(blank/s.size)&&Math.abs(i-blank)===1)){[s.board[i],s.board[blank]]=[s.board[blank],s.board[i]];s.moves[me]++}break
      }
      case 'maze-race': {const from=s.positions[me],to=Number(a.to);if(s.links.some(([x,y]:number[])=>x===from&&y===to||y===from&&x===to))s.positions[me]=to;break}
      case 'level-runner': s.lane[me]=Number(a.lane);s.progress[me]+=5;break
      case 'live-quiz': if(a.kind==='answer'){s.questionIndex=(s.questionIndex+1)%s.questionCount;s.question.prompt=`Which number is ${s.questionIndex%4+1}?`;s.leaderboard[0].score+=100}break
      case 'contract-detective': s.answeredCount[me]++;break
      case 'reward-grid': if(a.kind==='reveal'&&!s.revealed[me].includes(a.tile)){s.revealed[me].push(a.tile);s.slotsLeft=Math.max(0,s.slotsLeft-1)}break
      case 'logo-bingo': this.points(100);s._demoMessage='Offline line claimed';break
      case 'pattern-recall': s.step++;s.visibleSequence=Array.from({length:s.step},()=>Math.floor(this.random()*s.symbols));break
      case 'typing-sprint': if(a.kind==='submit')s.submitted.push(me);break
      case 'mev-rush': s.captured[me].push(a.slot);s.live=s.live.filter((v:number)=>v!==a.slot);break
      case 'idle-rig': if(a.kind==='upgrade'){s.levels[me]++;s.earned[me]=Math.max(0,s.earned[me]-25)}break
      case 'airdrop-quest': if(!s.achieved[me].includes(a.achievement))s.achieved[me].push(a.achievement);break
      case 'hash-hunt': s.leaderboard.push({who:me,nonce:a.nonce,score:1,hash:'0x'+Math.floor(this.random()*0xffffffff).toString(16).padStart(64,'0')});break
    }
  }
  advance(): boolean {
    const s=this.state
    if (!s._demoAdvanceAt || this.elapsed<s._demoAdvanceAt)return false
    delete s._demoAdvanceAt
    if(this.templateId.endsWith('duel')) {
      const choice=s.ownSelection.choice,opponent=['rock','paper','scissors'][Math.floor(this.random()*3)]
      s.history.push({round:s.roundIndex,a:choice,b:opponent,outcome:choice===opponent?'tie':`${this.me}:demo`});s.wins[this.me]++;s.roundIndex++;s.committed=Object.fromEntries(this.players.map(p=>[p,false]));s.ownSelection=null;s.phase='commit'
    } else {
      s.index++;s.challengeIndex=s.index;s.auctionIndex=s.index;s.ownSubmission=null;s.hintReceipt=null;s.hintsRemaining=s.hintBudget;s.submitted=Object.fromEntries(this.players.map(p=>[p,false]))
    }
    return true
  }
}
export const PREVIEW_TEMPLATE_IDS = Object.keys(FIXTURES)
