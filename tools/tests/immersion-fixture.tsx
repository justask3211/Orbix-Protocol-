import React,{useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {RoundImmersion,type ImmersionHandle} from '../../web/src/center/RoundImmersion'
import {STAGES} from '../../web/src/center/stages'
import {FOUR_STAGE_VIEWS} from '../../web/src/center/GamePlayStages'
import '../../web/src/center/center.css'
import '../../web/src/center/gamePlay.css'
function Fixture(){
 const shell=useRef<ImmersionHandle>(null),[active,setActive]=useState(false),[game,setGame]=useState('reaction-duel')
 const Stage=FOUR_STAGE_VIEWS[game]??STAGES[game]
 const state={template:game,version:2,roundId:'fixture',roundIndex:0,rounds:3,phase:'commit',phaseDeadline:Date.now()/1000+300,players:['a','b'],wins:{a:0,b:0},committed:{a:false,b:false},history:[],_canAct:true,_connection:'open',min:1111,max:9999,digits:4,guessBudget:20,budget:{a:20,b:20},hints:'on',hintVisibility:'private'}
 return <div className="ct-app"><button onClick={()=>{shell.current?.enter();setActive(true)}}>Start game</button><button onClick={()=>setActive(true)}>Remote start</button><select aria-label="Game" value={game} onChange={e=>setGame(e.target.value)}>{Object.keys({...STAGES,...FOUR_STAGE_VIEWS}).map(id=><option key={id}>{id}</option>)}</select><RoundImmersion ref={shell} active={active} roundId="fixture">{()=>Stage?<Stage state={state} act={()=>{}} me="a" players={['a','b']} finished={false}/>:<p>Loading</p>}</RoundImmersion></div>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
