import catalog from '../../../center/cosmetics_catalog.json'
export const CHARACTERS = [
  {id:'cat',name:'Maple',description:'Tabby cat · plush fur, bright eyes and a curled tail',color:'#b6a28d',face:'🐱'},
  {id:'turtle',name:'Tuck',description:'Little turtle · carved shell and soft stubby paws',color:'#a4bf73',face:'🐢'},
  {id:'blob',name:'Boba',description:'Round blob runner · sunny and bouncy',color:'#ffafcd',face:'●'},
  {id:'knight',name:'Pip',description:'Stubby knight · small but brave',color:'#8cb8ed',face:'♜'},
  {id:'cat-blob',name:'Mochi',description:'Cat blob · curious and cozy',color:'#c5a4ed',face:'🐱'},
  {id:'duckling',name:'Peep',description:'Duckling · fearless little waddler',color:'#ffe18c',face:'🐤'},
  {id:'astronaut',name:'Orbit',description:'Bean astronaut · starry-eyed explorer',color:'#ade5f2',face:'✦'},
  {id:'toy-robot',name:'Bolt',description:'Chunky robot toy · friendly tinkerer',color:'#70d5c8',face:'🤖'},
  {id:'pancake',name:'Flip',description:'Pancake golem · breakfast champion',color:'#e9b47a',face:'🥞'},
  {id:'jelly-ninja',name:'Wisp',description:'Jelly ninja · quietly mischievous',color:'#9297ea',face:'◆'},
  {id:'sprout',name:'Bud',description:'Sproutling · growing into adventure',color:'#a8de87',face:'🌱'},
  {id:'marshmallow',name:'Puff',description:'Marshmallow brawler · soft and strong',color:'#fff2de',face:'☁'},
] as const
export type CharacterId = typeof CHARACTERS[number]['id']
export type Cosmetics = {hat?:string;glasses?:string;outfit?:string;accessory?:string}
export type Appearance = {character?:string;cosmetics?:Cosmetics}
export const COSMETIC_CATALOG_VERSION = catalog.version
export const COSMETIC_OPTIONS = catalog.options

export function characterInfo(id?:string) { const aliases:Record<string,string>={fox:'astronaut',robot:'toy-robot',frog:'sprout'};return CHARACTERS.find(item=>item.id===(aliases[id??'']??id))??CHARACTERS.find(item=>item.id==='blob')! }
