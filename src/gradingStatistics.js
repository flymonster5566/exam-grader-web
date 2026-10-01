// Aggregate statistics across all graded submissions, built on top of
// grading.js's per-submission `gradeSubmission` result plus grid-OCR
// confirmation state. Kept as pure functions so they can be unit-tested
// without any real images, OCR engine, or UI.

/**
 * Computes an overall statistics summary for a batch of rows.
 *
 * `rows` is an array of `{ grading, pendingCount }` where:
 *   - `grading` is either the result of `gradeSubmission` (see grading.js) or
 *     `null`/`undefined` when the row has not been scored yet (e.g. OCR not
 *     run, or the standard answer key is not yet valid).
 *   - `pendingCount` is the number of grid cells on that row's answer sheet
 *     that were flagged as "待確認" (unclear, not guessed) by the grid OCR
 *     step; defaults to 0 when not using grid OCR.
 *
 * Returns totals plus average/highest/lowest score, total answered
 * questions, and a recognition summary (how many rows still have pending
 * cells to confirm, and the overall per-row "clean" recognition rate).
 */
export function computeStatistics(rows) {
  const entries = rows ?? []
  const totalStudents = entries.length

  const gradedEntries = entries.filter((row) => row && row.grading)
  const scores = gradedEntries.map((row) => row.grading.score)
  const totalAnsweredQuestions = gradedEntries.reduce(
    (sum, row) => sum + row.grading.answeredCount,
    0,
  )

  const totalPendingCells = entries.reduce(
    (sum, row) => sum + (row?.pendingCount ?? 0),
    0,
  )
  const rowsWithPending = entries.filter((row) => (row?.pendingCount ?? 0) > 0).length

  const gradedCount = gradedEntries.length
  const averageScore =
    gradedCount === 0
      ? null
      : Math.round((scores.reduce((sum, score) => sum + score, 0) / gradedCount) * 100) / 100
  const highestScore = gradedCount === 0 ? null : Math.max(...scores)
  const lowestScore = gradedCount === 0 ? null : Math.min(...scores)

  const recognitionSuccessRate =
    totalStudents === 0
      ? null
      : Math.round(((totalStudents - rowsWithPending) / totalStudents) * 10000) / 100

  return {
    totalStudents,
    gradedCount,
    averageScore,
    highestScore,
    lowestScore,
    totalAnsweredQuestions,
    totalPendingCells,
    rowsWithPending,
    recognitionSuccessRate,
  }
}

/**
 * Formats the statistics summary into a flat object of 中文 labelled fields,
 * ready to be written as a row/sheet in the Excel export or rendered in the
 * UI.
 */
export function formatStatisticsSummary(stats) {
  return {
    總人數: stats.totalStudents,
    已計分人數: stats.gradedCount,
    平均分: stats.averageScore ?? '—',
    最高分: stats.highestScore ?? '—',
    最低分: stats.lowestScore ?? '—',
    總已作答題數: stats.totalAnsweredQuestions,
    待確認人數: stats.rowsWithPending,
    待確認格數: stats.totalPendingCells,
    辨識成功率: stats.recognitionSuccessRate === null ? '—' : `${stats.recognitionSuccessRate}%`,
  }
}
