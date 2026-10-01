import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeGridCellPixelRects,
  createGridLayout,
  gridAnswersToText,
  normalizeGridCellAnswer,
  parseGridAnswerResults,
} from './gridAnswerSheet.js'

test('creates a grid layout with the expected number of cells and rows', () => {
  const layout = createGridLayout({ totalQuestions: 12, columns: 5 })
  assert.equal(layout.totalQuestions, 12)
  assert.equal(layout.columns, 5)
  assert.equal(layout.rows, 3)
  assert.equal(layout.cells.length, 12)
  assert.deepEqual(
    layout.cells.map((cell) => cell.questionNumber),
    Array.from({ length: 12 }, (_, index) => index + 1),
  )
  // Every cell rect stays within the [0, 1] fractional bounds.
  for (const cell of layout.cells) {
    assert.ok(cell.rect.x >= 0 && cell.rect.x + cell.rect.width <= 1.0001)
    assert.ok(cell.rect.y >= 0 && cell.rect.y + cell.rect.height <= 1.0001)
  }
})

test('rejects invalid question counts or column counts', () => {
  assert.throws(() => createGridLayout({ totalQuestions: 0 }))
  assert.throws(() => createGridLayout({ totalQuestions: -1 }))
  assert.throws(() => createGridLayout({ totalQuestions: 1.5 }))
  assert.throws(() => createGridLayout({ totalQuestions: 10, columns: 0 }))
  assert.throws(() => createGridLayout({ totalQuestions: 10000 }))
})

test('computes absolute pixel rects for a given image size', () => {
  const layout = createGridLayout({ totalQuestions: 4, columns: 2, marginX: 0, marginY: 0 })
  const rects = computeGridCellPixelRects(layout, 200, 100)
  assert.equal(rects.length, 4)
  assert.deepEqual(rects[0], { questionNumber: 1, x: 0, y: 0, width: 100, height: 50 })
  assert.deepEqual(rects[3], { questionNumber: 4, x: 100, y: 50, width: 100, height: 50 })
})

test('rejects invalid image sizes when computing pixel rects', () => {
  const layout = createGridLayout({ totalQuestions: 2, columns: 2 })
  assert.throws(() => computeGridCellPixelRects(layout, 0, 100))
  assert.throws(() => computeGridCellPixelRects(layout, 100, NaN))
})

test('normalizes clean single-letter answers', () => {
  assert.equal(normalizeGridCellAnswer('A', 95), 'A')
  assert.equal(normalizeGridCellAnswer('b', 95), 'B')
  assert.equal(normalizeGridCellAnswer(' c ', 95), 'C')
})

test('treats blank cells as unanswered, not guessed', () => {
  assert.equal(normalizeGridCellAnswer('', 95), null)
  assert.equal(normalizeGridCellAnswer('   ', 95), null)
  assert.equal(normalizeGridCellAnswer(undefined, 95), null)
})

test('flags unclear or invalid cell text as needing confirmation instead of guessing', () => {
  assert.equal(normalizeGridCellAnswer('E', 95), undefined)
  assert.equal(normalizeGridCellAnswer('AB', 95), undefined)
  assert.equal(normalizeGridCellAnswer('4', 95), undefined)
  assert.equal(normalizeGridCellAnswer('A/B', 95), undefined)
})

test('flags low-confidence recognition as needing confirmation even if the letter looks valid', () => {
  assert.equal(normalizeGridCellAnswer('A', 10), undefined)
  assert.equal(normalizeGridCellAnswer('A', 59, { minConfidence: 60 }), undefined)
  assert.equal(normalizeGridCellAnswer('A', 60, { minConfidence: 60 }), 'A')
})

test('parses a full set of per-cell OCR results into answers, blanks, and pending questions', () => {
  const result = parseGridAnswerResults([
    { questionNumber: 1, text: 'A', confidence: 95 },
    { questionNumber: 2, text: '', confidence: 95 },
    { questionNumber: 3, text: 'E', confidence: 95 },
    { questionNumber: 4, text: 'D', confidence: 10 },
    { questionNumber: 5, text: 'c', confidence: 80 },
  ])

  assert.deepEqual([...result.answers.entries()], [
    [1, 'A'],
    [5, 'C'],
  ])
  assert.deepEqual(result.blankQuestions, [2])
  assert.deepEqual(result.pendingQuestions, [3, 4])
})

test('serializes grid answers back into "題號:答案" text compatible with grading.js', () => {
  const answers = new Map([
    [2, 'B'],
    [1, 'A'],
    [10, 'D'],
  ])
  assert.equal(gridAnswersToText(answers), '1:A\n2:B\n10:D')
})

test('round-trips grid OCR results through the existing answer-key parser', async () => {
  const { parseAnswerKey } = await import('./grading.js')
  const result = parseGridAnswerResults([
    { questionNumber: 1, text: 'A', confidence: 95 },
    { questionNumber: 2, text: 'B', confidence: 95 },
  ])
  const parsed = parseAnswerKey(gridAnswersToText(result.answers))
  assert.equal(parsed.isValid, true)
  assert.deepEqual([...parsed.answerKey.entries()], [
    [1, 'A'],
    [2, 'B'],
  ])
})
