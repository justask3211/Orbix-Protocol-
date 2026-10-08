/* Regression checks for verified sign-in and modal completion, without a new test dependency.
 * Run: node tools/tests/wallet-session-regression.cjs
 * Hooks are isolated unit fixtures; this does not replace a real wallet/browser integration test.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('../../web/node_modules/rolldown/dist/utils-index.mjs')
const root = path.resolve(__dirname, '../..')

function hooks() {
  const states = []; let cursor = 0
  return {
    begin() { cursor = 0 },
    useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }] },
    useCallback(callback) { return callback },
    useEffect() {},
    useRef(value) { return { current: value } },
  }
}
function load(file, modules) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const result = transformSync(file, source, { jsx: { runtime: 'automatic' }, target: 'es2022' })
  assert.deepEqual(result.errors, [])
  const output = result.code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, name) => `const {${names.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(name)});`).replace(/\bexport\s+(?=(?:function|const|class)\b)/g, '')
  const names = Array.from(source.matchAll(/export function\s+(\w+)/g), match => match[1])
  return new Function('require', `${output}\nreturn {${names.join(',')}};`)(name => { if (!(name in modules)) throw new Error(`Unexpected test import: ${name}`); return modules[name] })
}
function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
const jsx = (type, props) => ({ type, props })
function find(element, test) {
  if (!element || typeof element !== 'object') return null
  if (test(element)) return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    if (Array.isArray(child)) { for (const item of child) { const result = find(item, test); if (result) return result } }
    else { const result = find(child, test); if (result) return result }
  }
  return null
}
const content = element => typeof element === 'string' ? element : Array.isArray(element) ? element.map(content).join(' ') : element?.props ? content(element.props.children) : ''
const flush = () => new Promise(resolve => setImmediate(resolve))

async function checkSession({ provider, verify, expected, emptyAccount = false }) {
  const react = hooks(), local = storage(), calls = []
  global.localStorage = local
  global.window = provider ? { ethereum: { request: async ({ method }) => { calls.push(method); if (method === 'eth_requestAccounts') return emptyAccount ? [] : ['0x1234567890123456789012345678901234567890']; if (provider === 'reject') throw new Error('Signature rejected'); return 'test-signature' } } } : {}
  const sessionModule = load('web/src/center/session.ts', { react, 'viem/accounts': { privateKeyToAccount() { throw new Error('Unexpected generated wallet') } }, './api': { center: { nonce: async () => ({ nonce: 'nonce', message: 'Ownership proof' }), verify: async () => { if (verify === 'reject') throw new Error('Verification rejected'); return { token: verify === 'empty' ? '' : 'verified-test-session' } } } } })
  react.begin()
  const session = sessionModule.useSession()
  assert.equal(await session.connectInjected(), expected)
  assert.equal(local.getItem('orbix.session.token'), expected ? 'verified-test-session' : null)
  if (emptyAccount) assert.deepEqual(calls, ['eth_requestAccounts'])
}

async function checkModal(result, generated = false, alreadyConnected = false) {
  const react = hooks(); let closed = 0, notices = 0
  const connect = async () => { if (result === 'throw') throw new Error('Verification rejected'); return result }
  const session = { connected: alreadyConnected, signingIn: false, error: null, connectInjected: connect, signIn: connect, generate: () => ({ address: '0x1234567890123456789012345678901234567890', privateKey: 'unit-test-recovery-placeholder' }) }
  const { WalletModal } = load('web/src/center/WalletModal.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, './session': { hasInjected: () => true, shortAddress: address => address }, './share': { copyText: async () => true }, './useModalFocus': { useModalFocus: () => ({ current: null }) } })
  const render = () => { react.begin(); return WalletModal({ session, onClose: () => closed++, onConnected: () => notices++ }) }
  let tree = render()
  if (generated) {
    find(tree, item => item.type === 'button' && content(item).includes('Generate new wallet')).props.onClick(); tree = render()
    await find(tree, item => item.type === 'button' && content(item).includes('Copy key')).props.onClick(); tree = render()
    find(tree, item => item.type === 'button' && content(item).includes('I saved it')).props.onClick()
  } else find(tree, item => item.type === 'button' && content(item).includes('Browser wallet')).props.onClick()
  await flush()
  assert.equal(closed, result === true ? 1 : 0)
  assert.equal(notices, result === true ? 1 : 0)
}

;(async () => {
  await checkSession({ provider: 'ok', verify: 'ok', expected: true })
  await checkSession({ provider: 'reject', verify: 'ok', expected: false })
  await checkSession({ provider: 'ok', verify: 'reject', expected: false })
  await checkSession({ provider: 'ok', verify: 'empty', expected: false })
  await checkSession({ provider: null, verify: 'ok', expected: false })
  await checkSession({ provider: 'ok', verify: 'ok', expected: false, emptyAccount: true })
  await checkModal(true); await checkModal(false); await checkModal('throw')
  await checkModal(false, false, true)
  await checkModal(true, true); await checkModal(false, true); await checkModal('throw', true)
  process.stdout.write('13 wallet regression checks passed: verified completion, rejected signatures, failed verification, no account and modal retry.\n')
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
