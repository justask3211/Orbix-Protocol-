const {execFileSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict')
const env={...process.env,ORBIX_MOTION_SOURCE:'web/src/center/babylon/motion.ts',ORBIX_TERRAIN_SOURCE:'web/src/center/babylon/terrain.ts',ORBIX_TEST_PYTHON:process.env.ORBIX_TEST_PYTHON||`${process.cwd()}/center/.venv/bin/python`}
for(const script of ['motion-regression.cjs','motion-jitter-regression.cjs','motion-envelope-regression.cjs','terrain-parity.mjs'])process.stdout.write(execFileSync('node',[`tools/tests/${script}`,...(script==='motion-envelope-regression.cjs'?[env.ORBIX_MOTION_SOURCE]:[])],{env,encoding:'utf8'}))
// Protect the engine-neutral authority port and lazy renderer boundary.
assert.equal(fs.readFileSync(env.ORBIX_MOTION_SOURCE,'utf8'),fs.readFileSync('web/src/center/worlds/motion.ts','utf8'))
for(const file of fs.readdirSync('web/src/center/babylon').filter(file=>/\.tsx?$/.test(file)))assert(!/from ['"](?:three|@react-three)/.test(fs.readFileSync(`web/src/center/babylon/${file}`,'utf8')),`${file} imports legacy renderer`)
console.log('PASS: Babylon uses the same tested authority algorithms without importing Three rendering.')
