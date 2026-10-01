import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAnswerKey,
  parsePointsPerQuestion,
  parseStudentAnswers,
  extractStudentAnswerText,
  gradeSubmission,
  formatWrongQuestions,
} from './grading.js'

test('parses a valid standard answer key', () => {
  const result = parseAnswerKey('1:A\n2:C\n3:B')
  assert.equal(result.isValid, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.totalQuestions, 3)
  assert.deepEqual(
    [...result.answerKey.entries()],
    [
      [1, 'A'],
      [2, 'C'],
      [3, 'B'],
    ],
  )
})

test('accepts lowercase answers and full-width colon', () => {
  const result = parseAnswerKey('1：a\n2：b')
  assert.equal(result.isValid, true)
  assert.deepEqual([...result.answerKey.entries()], [
    [1, 'A'],
    [2, 'B'],
  ])
})

test('rejects invalid answer characters', () => {
  const result = parseAnswerKey('1:A\n2:E')
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((message) => message.includes('第 2 題答案「E」無效')))
})

test('rejects lines that do not match the 題號:答案 format', () => {
  const result = parseAnswerKey('1:A\nfoo:A\n2:B')
  assert.equal(result.isValid, false)
  assert.ok(
    result.errors.some((message) =>
      message.includes('第 2 行「foo:A」格式錯誤'),
    ),
  )
})

test('rejects duplicate question numbers', () => {
  const result = parseAnswerKey('1:A\n1:B')
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((message) => message.includes('第 1 題重複設定')))
})

test('reports duplicate question numbers even when the later occurrence has an invalid answer', () => {
  const result = parseAnswerKey('1:A\n1:E')
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((message) => message.includes('第 1 題重複設定')))
})

test('rejects missing question numbers in sequence', () => {
  const result = parseAnswerKey('1:A\n3:B')
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((message) => message.includes('缺少第 2 題標準答案')))
})

test('rejects an out-of-range question number without enumerating every missing question', () => {
  const result = parseAnswerKey('1:A\n99999:B')
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((message) => message.includes('題號超出可處理範圍')))
  assert.ok(!result.errors.some((message) => message.includes('缺少第')))
})

test('rejects blank answers and empty input', () => {
  const blankAnswer = parseAnswerKey('1:')
  assert.equal(blankAnswer.isValid, false)
  assert.ok(blankAnswer.errors.some((message) => message.includes('第 1 題未填寫答案')))

  const emptyInput = parseAnswerKey('   ')
  assert.equal(emptyInput.isValid, false)
  assert.ok(emptyInput.errors.some((message) => message.includes('尚未輸入標準答案')))
})

test('validates points per question must be a positive number', () => {
  assert.deepEqual(parsePointsPerQuestion('1'), { points: 1, error: '' })
  assert.deepEqual(parsePointsPerQuestion('2.5'), { points: 2.5, error: '' })
  assert.equal(parsePointsPerQuestion('0').points, null)
  assert.equal(parsePointsPerQuestion('-1').points, null)
  assert.equal(parsePointsPerQuestion('abc').points, null)
})

test('parses student answers from free-form text', () => {
  const answers = parseStudentAnswers('1:A\n2:B\n3:C')
  assert.deepEqual(
    [...answers.entries()],
    [
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ],
  )
})

test('ignores conflicting duplicate student answers instead of guessing', () => {
  const answers = parseStudentAnswers('1:A 1:B\n2:C')
  assert.equal(answers.has(1), false)
  assert.equal(answers.get(2), 'C')
})

test('extracts a clean student answer text block from OCR text', () => {
  const text = extractStudentAnswerText('姓名：王小明\n1:A\n雜訊文字\n2:C')
  assert.equal(text, '1:A\n2:C')
})

test('extractStudentAnswerText returns empty string when nothing is recognizable', () => {
  assert.equal(extractStudentAnswerText('看不懂的內容'), '')
})

test('grades a submission, unanswered questions never count as correct', () => {
  const { answerKey } = parseAnswerKey('1:A\n2:B\n3:C\n4:D')
  const studentAnswers = parseStudentAnswers('1:A\n2:C\n4:D')

  const result = gradeSubmission({
    answerKey,
    studentAnswers,
    pointsPerQuestion: 1,
  })

  assert.equal(result.totalCount, 4)
  assert.equal(result.answeredCount, 3)
  assert.equal(result.correctCount, 2)
  assert.equal(result.score, 2)
  assert.equal(result.totalScore, 4)
  assert.deepEqual(
    result.wrongQuestions.map((entry) => entry.questionNumber),
    [2, 3],
  )
})

test('grades correctly with a custom points-per-question value', () => {
  const { answerKey } = parseAnswerKey('1:A\n2:B')
  const studentAnswers = parseStudentAnswers('1:A\n2:B')

  const result = gradeSubmission({
    answerKey,
    studentAnswers,
    pointsPerQuestion: 5,
  })

  assert.equal(result.correctCount, 2)
  assert.equal(result.score, 10)
  assert.equal(result.totalScore, 10)
})

test('re-grades after the student answer is edited', () => {
  const { answerKey } = parseAnswerKey('1:A\n2:B')

  const before = gradeSubmission({
    answerKey,
    studentAnswers: parseStudentAnswers('1:A\n2:C'),
    pointsPerQuestion: 1,
  })
  assert.equal(before.correctCount, 1)
  assert.equal(before.score, 1)

  const after = gradeSubmission({
    answerKey,
    studentAnswers: parseStudentAnswers('1:A\n2:B'),
    pointsPerQuestion: 1,
  })
  assert.equal(after.correctCount, 2)
  assert.equal(after.score, 2)
})

test('formats the wrong question list for display and export', () => {
  const { answerKey } = parseAnswerKey('1:A\n2:B\n3:C')
  const studentAnswers = parseStudentAnswers('1:A\n2:D')
  const result = gradeSubmission({
    answerKey,
    studentAnswers,
    pointsPerQuestion: 1,
  })

  assert.equal(
    formatWrongQuestions(result.wrongQuestions),
    '第2題(作答D,正解B)、第3題(未作答,正解C)',
  )
  assert.equal(formatWrongQuestions([]), '—')
})
