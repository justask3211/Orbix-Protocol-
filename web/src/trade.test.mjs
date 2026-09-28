import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUnits } from 'viem'
import { amountWithSlippage, parsePositiveAmount, validateLaunch, priceImpactPct, formatPriceImpact, impactSeverity, decodeRevertReason } from './trade.ts'

test('swap minimum output rounds down and rejects unsafe slippage', () => {
  assert.equal(amountWithSlippage(12345n, '2.5'), 12036n)
  assert.throws(() => amountWithSlippage(12345n, '100'), /slippage/i)
})

test('amounts require positive decimal input with token precision', () => {
  assert.equal(parsePositiveAmount('0.25', 18), parseUnits('0.25', 18))
  assert.throws(() => parsePositiveAmount('-1', 18), /amount/i)
  assert.throws(() => parsePositiveAmount('0', 18), /amount/i)
})

test('launch seed cannot exceed supply', () => {
  assert.throws(() => validateLaunch('Name', 'SYM', '10', '11', '1'), /seed/i)
  assert.equal(validateLaunch('Name', 'SYM', '10', '5', '1').supply, parseUnits('10', 18))
})

test('price impact is zero for tiny trades and grows with size', () => {
  const rIn = parseUnits('1000', 18)
  const rOut = parseUnits('5000', 18)
  const tinyIn = parseUnits('0.001', 18)
  assert.ok(priceImpactPct(rIn, rOut, tinyIn, (tinyIn * 997n * rOut) / (rIn * 1000n + tinyIn * 997n)) < 1)
  const bigIn = parseUnits('100', 18)
  const bigOut = (bigIn * 997n * rOut) / (rIn * 1000n + bigIn * 997n)
  const impact = priceImpactPct(rIn, rOut, bigIn, bigOut)
  assert.ok(impact > 8 && impact < 10, `impact ${impact}`)
  assert.equal(priceImpactPct(0n, rOut, bigIn, bigOut), 0)
  assert.equal(priceImpactPct(rIn, rOut, 0n, 0n), 0)
})

test('impact severity tiers and formatting', () => {
  assert.equal(impactSeverity(0.2), 'ok')
  assert.equal(impactSeverity(2), 'warn')
  assert.equal(impactSeverity(7), 'high')
  assert.equal(formatPriceImpact(0.001), '0%')
  assert.equal(formatPriceImpact(3.14159), '3.14%')
})

test('revert reasons decode to friendly copy', () => {
  assert.match(decodeRevertReason(new Error('User rejected the request')), /rejected/i)
  assert.match(decodeRevertReason({ message: 'revert InsufficientOutput()' }), /slippage|output/i)
  assert.match(decodeRevertReason({ message: 'revert Expired()' }), /deadline/i)
  assert.match(decodeRevertReason({ message: 'ERC20: insufficient allowance' }), /approve/i)
  assert.match(decodeRevertReason({}), /failed/i)
})
