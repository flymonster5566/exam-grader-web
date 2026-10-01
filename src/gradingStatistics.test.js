import test from 'node:test'
import assert from 'node:assert/strict'
import { computeStatistics, formatStatisticsSummary } from './gradingStatistics.js'

function grading({ score, correctCount, answeredCount, totalCount = 10 }) {
  return { score, correctCount, answeredCount, totalCount, totalScore: totalCount, wrongQuestions: [] }
}

test('computes totals, average/highest/lowest score across graded rows', () => {
  const stats = computeStatistics([
    { grading: grading({ score: 80, correctCount: 8, answeredCount: 9 }) },
    { grading: grading({ score: 60, correctCount: 6, answeredCount: 8 }) },
    { grading: grading({ score: 100, correctCount: 10, answeredCount: 10 }) },
  ])

  assert.equal(stats.totalStudents, 3)
  assert.equal(stats.gradedCount, 3)
  assert.equal(stats.averageScore, 80)
  assert.equal(stats.highestScore, 100)
  assert.equal(stats.lowestScore, 60)
  assert.equal(stats.totalAnsweredQuestions, 27)
  assert.equal(stats.rowsWithPending, 0)
  assert.equal(stats.recognitionSuccessRate, 100)
})

test('ignores rows that are not graded yet when computing score stats', () => {
  const stats = computeStatistics([
    { grading: grading({ score: 50, correctCount: 5, answeredCount: 5 }) },
    { grading: null },
  ])

  assert.equal(stats.totalStudents, 2)
  assert.equal(stats.gradedCount, 1)
  assert.equal(stats.averageScore, 50)
  assert.equal(stats.highestScore, 50)
  assert.equal(stats.lowestScore, 50)
})

test('returns null score stats when nothing has been graded yet', () => {
  const stats = computeStatistics([{ grading: null }, { grading: undefined }])
  assert.equal(stats.gradedCount, 0)
  assert.equal(stats.averageScore, null)
  assert.equal(stats.highestScore, null)
  assert.equal(stats.lowestScore, null)
})

test('handles an empty batch without dividing by zero', () => {
  const stats = computeStatistics([])
  assert.equal(stats.totalStudents, 0)
  assert.equal(stats.recognitionSuccessRate, null)
})

test('tracks pending (needs-confirmation) grid cells and recognition success rate', () => {
  const stats = computeStatistics([
    { grading: grading({ score: 80, correctCount: 8, answeredCount: 10 }), pendingCount: 0 },
    { grading: grading({ score: 70, correctCount: 7, answeredCount: 9 }), pendingCount: 2 },
    { grading: grading({ score: 90, correctCount: 9, answeredCount: 10 }), pendingCount: 1 },
  ])

  assert.equal(stats.rowsWithPending, 2)
  assert.equal(stats.totalPendingCells, 3)
  assert.equal(stats.recognitionSuccessRate, Math.round((1 / 3) * 10000) / 100)
})

test('formats the statistics summary into labelled 中文 fields for display/export', () => {
  const summary = formatStatisticsSummary(
    computeStatistics([{ grading: grading({ score: 80, correctCount: 8, answeredCount: 10 }) }]),
  )
  assert.equal(summary.總人數, 1)
  assert.equal(summary.平均分, 80)
  assert.equal(summary.辨識成功率, '100%')
})

test('formats "—" placeholders when there is nothing graded yet', () => {
  const summary = formatStatisticsSummary(computeStatistics([]))
  assert.equal(summary.平均分, '—')
  assert.equal(summary.最高分, '—')
  assert.equal(summary.最低分, '—')
  assert.equal(summary.辨識成功率, '—')
})
