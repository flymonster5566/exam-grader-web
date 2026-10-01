// Fixed-grid answer sheet support.
//
// Unlike the free-text "題號:答案" OCR flow, a fixed-grid answer sheet has a
// predetermined layout: question numbers are fixed, and each question has
// exactly one cell that may only contain a single A/B/C/D mark. This module
// provides pure, testable helpers to:
//   1. describe the grid layout (so it can be shared by the standard answer
//      sheet and every student answer sheet),
//   2. normalize raw per-cell OCR output into a strict A/B/C/D answer (or
//      flag the cell as needing manual confirmation instead of guessing),
//   3. turn a full set of per-cell OCR results into the same
//      Map<number, 'A'|'B'|'C'|'D'> shape used by grading.js, so the existing
//      comparison/scoring logic can be reused unchanged.

const VALID_ANSWERS = ['A', 'B', 'C', 'D']
const DEFAULT_COLUMNS = 5
const MAX_QUESTIONS = 1000

/**
 * Builds a fixed grid layout: `totalQuestions` cells arranged into rows of
 * `columns`, each with a fractional (0–1) bounding box relative to the
 * answer-sheet image. Fractional coordinates keep the layout independent of
 * actual image resolution, so the same layout definition works for any scan
 * size and can be unit-tested without real images.
 *
 * This is intentionally a simple, pre-defined/configurable grid rather than
 * full layout auto-detection, so a first usable version can ship quickly;
 * the cell list produced here is what later gets cropped from the image for
 * per-cell OCR.
 */
export function createGridLayout({
  totalQuestions,
  columns = DEFAULT_COLUMNS,
  marginX = 0.05,
  marginY = 0.05,
} = {}) {
  const count = Number(totalQuestions)
  const cols = Number(columns)

  if (!Number.isInteger(count) || count <= 0 || count > MAX_QUESTIONS) {
    throw new Error(
      `題數必須是 1 到 ${MAX_QUESTIONS} 之間的整數，目前為「${totalQuestions}」。`,
    )
  }
  if (!Number.isInteger(cols) || cols <= 0) {
    throw new Error(`每列格數必須是正整數，目前為「${columns}」。`)
  }

  const rows = Math.ceil(count / cols)
  const usableWidth = 1 - marginX * 2
  const usableHeight = 1 - marginY * 2
  const cellWidth = usableWidth / cols
  const cellHeight = usableHeight / rows

  const cells = []
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / cols)
    const col = index % cols
    cells.push({
      questionNumber: index + 1,
      row,
      col,
      rect: {
        x: marginX + col * cellWidth,
        y: marginY + row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      },
    })
  }

  return { totalQuestions: count, columns: cols, rows, cells }
}

/**
 * Converts a fractional grid layout into absolute pixel rectangles for a
 * given image size, so cells can be cropped out of a canvas for per-cell
 * OCR. Pure arithmetic — no canvas/image dependency — so it stays testable.
 */
export function computeGridCellPixelRects(layout, imageWidth, imageHeight) {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('影像尺寸無效，無法計算格子座標。')
  }

  return layout.cells.map((cell) => ({
    questionNumber: cell.questionNumber,
    x: Math.round(cell.rect.x * imageWidth),
    y: Math.round(cell.rect.y * imageHeight),
    width: Math.max(1, Math.round(cell.rect.width * imageWidth)),
    height: Math.max(1, Math.round(cell.rect.height * imageHeight)),
  }))
}

/**
 * Normalizes a single cell's raw OCR text (and optional confidence, 0-100)
 * into a strict 'A' | 'B' | 'C' | 'D' answer, `null` meaning "clearly blank"
 * (not answered), or `undefined` meaning "unclear — needs manual
 * confirmation". The function never guesses: anything that is not cleanly
 * one of A/B/C/D, or that has low OCR confidence, is treated as unclear
 * rather than coerced into an answer.
 */
export function normalizeGridCellAnswer(rawText, confidence, { minConfidence = 60 } = {}) {
  const trimmed = (rawText ?? '').trim()
  if (trimmed.length === 0) return null

  const cleaned = trimmed.toUpperCase().replace(/[^A-Z]/g, '')

  if (cleaned.length === 0) {
    // Something was recognized (e.g. a stray mark, digit, or symbol) but it
    // is not a letter at all — ambiguous, do not guess.
    return undefined
  }

  if (cleaned.length > 1) {
    // More than one letter survived cleanup (e.g. stray marks/noise
    // mis-read as extra characters) — ambiguous, do not guess.
    return undefined
  }

  if (!VALID_ANSWERS.includes(cleaned)) return undefined

  if (confidence !== undefined && confidence !== null && confidence < minConfidence) {
    return undefined
  }

  return cleaned
}

/**
 * Parses a full set of per-cell OCR results (as produced by cropping+OCR'ing
 * every cell in a grid layout) into the same
 * `Map<questionNumber, 'A'|'B'|'C'|'D'>` shape used throughout grading.js,
 * plus the list of question numbers that are blank or need confirmation.
 *
 * `cellResults` is an array of `{ questionNumber, text, confidence }`.
 */
export function parseGridAnswerResults(cellResults, options = {}) {
  const answers = new Map()
  const pendingQuestions = []
  const blankQuestions = []

  for (const { questionNumber, text, confidence } of cellResults ?? []) {
    const normalized = normalizeGridCellAnswer(text, confidence, options)
    if (normalized === null) {
      blankQuestions.push(questionNumber)
    } else if (normalized === undefined) {
      pendingQuestions.push(questionNumber)
    } else {
      answers.set(questionNumber, normalized)
    }
  }

  pendingQuestions.sort((a, b) => a - b)
  blankQuestions.sort((a, b) => a - b)

  return { answers, pendingQuestions, blankQuestions }
}

/**
 * Serializes a grid answer Map back into the "題號:答案" text format already
 * understood by grading.js's `parseAnswerKey`/`parseStudentAnswers`, so the
 * grid-OCR flow can feed directly into the existing, well-tested
 * comparison/scoring pipeline without duplicating that logic.
 */
export function gridAnswersToText(answers) {
  return [...answers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([questionNumber, answer]) => `${questionNumber}:${answer}`)
    .join('\n')
}
