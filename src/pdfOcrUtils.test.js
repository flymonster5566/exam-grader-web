import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateOverallProgress,
  getPdfRenderScale,
  mergePdfPageTexts,
} from './pdfOcrUtils.js'

test('merges page text in order and skips blank pages', () => {
  assert.equal(mergePdfPageTexts(['班級：三年甲班', ' ', '座號：12\n姓名：王小明']), '班級：三年甲班\n座號：12\n姓名：王小明')
})

test('calculates bounded overall progress across files', () => {
  assert.equal(calculateOverallProgress(0, 2, 50), 25)
  assert.equal(calculateOverallProgress(1, 2, 0), 50)
  assert.equal(calculateOverallProgress(2, 2, 100), 100)
  assert.equal(calculateOverallProgress(0, 0), 0)
})

test('limits PDF rendering dimensions and canvas pixel area', () => {
  const scale = getPdfRenderScale(10_000, 10_000)
  assert.ok(10_000 * scale <= 2400)
  assert.ok(10_000 * 10_000 * scale ** 2 <= 12_000_000)
})
