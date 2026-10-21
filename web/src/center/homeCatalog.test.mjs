import test from 'node:test'
import assert from 'node:assert/strict'
import { isActiveCreatableGame } from './homeCatalog.ts'

const live = { playStatus:'live', placement:'catalog', available_modes:{create:true,join:true,preview:true} }
test('catalog accepts explicit live create permission in either original catalog placement', () => {
  for (const placement of ['catalog','more']) assert.equal(isActiveCreatableGame({...live,placement}),true)
})
test('catalog excludes hidden, upcoming, unavailable and non-creatable games', () => {
  for (const patch of [{placement:'hidden'},{placement:'upcoming'},{playStatus:'maintenance'},{playStatus:'offline'},{playStatus:undefined},{available_modes:undefined},{available_modes:{preview:true,create:false}},{available_modes:{join:true}}]) {
    assert.equal(isActiveCreatableGame({...live,...patch}),false,JSON.stringify(patch))
  }
})
test('enabled upcoming tags and overlays move games out of the active grid', () => {
  for (const field of ['overlay','tag']) {
    for (const text of ['Coming soon','UPCOMING','Still in development']) assert.equal(isActiveCreatableGame({...live,[field]:{enabled:true,text}}),false)
    assert.equal(isActiveCreatableGame({...live,[field]:{enabled:false,text:'Coming soon'}}),true)
    assert.equal(isActiveCreatableGame({...live,[field]:{enabled:true,text:'Community favorite'}}),true)
  }
})
