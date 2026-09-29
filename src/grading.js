const VALID_ANSWERS = ['A', 'B', 'C', 'D']
const ANSWER_KEY_LINE = /^(\d+)\s*[:：]\s*(.*)$/
const STUDENT_ANSWER_TOKEN = /(\d+)\s*[:：]\s*([A-Da-d])/g

/**
 * Parses a standard answer key of the form:
 *   1:A
 *   2:C
 *   3:B
 * One question per line. Only A/B/C/D answers are accepted.
 *
 * Returns { answerKey, errors, isValid, totalQuestions } where answerKey is a
 * Map<number, 'A'|'B'|'C'|'D'>. When errors is non-empty, isValid is false and
 * grading must not be attempted (no guessing of incomplete/invalid input).
 */
export function parseAnswerKey(rawText) {
  const text = (rawText ?? '').trim()
  const errors = []
  const answerKey = new Map()

  if (!text) {
    return { answerKey, errors: ['尚未輸入標準答案。'], isValid: false, totalQuestions: 0 }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const seen = new Map()
  const encounteredQuestionNumbers = new Set()

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const match = line.match(ANSWER_KEY_LINE)
    if (!match) {
      errors.push(
        `第 ${lineNumber} 行「${line}」格式錯誤，請使用「題號:答案」格式，例如 1:A。`,
      )
      return
    }

    const questionNumber = Number(match[1])
    encounteredQuestionNumbers.add(questionNumber)
    const rawAnswer = match[2].trim()

    if (!rawAnswer) {
      errors.push(`第 ${questionNumber} 題未填寫答案。`)
      return
    }

    const answer = rawAnswer.toUpperCase()
    if (!VALID_ANSWERS.includes(answer)) {
      errors.push(
        `第 ${questionNumber} 題答案「${rawAnswer}」無效，僅接受 A、B、C、D。`,
      )
      return
    }

    if (seen.has(questionNumber)) {
      errors.push(`第 ${questionNumber} 題重複設定標準答案。`)
      return
    }

    seen.set(questionNumber, answer)
  })

  if (encounteredQuestionNumbers.size > 0) {
    const maxQuestion = Math.max(...encounteredQuestionNumbers)
    for (let questionNumber = 1; questionNumber <= maxQuestion; questionNumber += 1) {
      if (!encounteredQuestionNumbers.has(questionNumber)) {
        errors.push(`缺少第 ${questionNumber} 題標準答案。`)
      }
    }
  }

  if (errors.length === 0) {
    for (const [questionNumber, answer] of seen.entries()) {
      answerKey.set(questionNumber, answer)
    }
  }

  return {
    answerKey,
    errors,
    isValid: errors.length === 0 && answerKey.size > 0,
    totalQuestions: answerKey.size,
  }
}

/**
 * Validates the per-question point value. Must be a finite positive number.
 */
export function parsePointsPerQuestion(rawValue) {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value <= 0) {
    return { points: null, error: '每題配分必須是大於 0 的數字。' }
  }
  return { points: value, error: '' }
}

/**
 * Parses student answers from free-form text such as OCR output or manual
 * input, looking for "題號:答案" tokens anywhere in the text (not required to
 * be one per line). If the same question number appears more than once with
 * conflicting answers, the question is treated as ambiguous and left
 * unanswered rather than guessed.
 *
 * Returns a Map<number, 'A'|'B'|'C'|'D'>.
 */
export function parseStudentAnswers(rawText) {
  const text = rawText ?? ''
  const found = new Map()
  const conflicting = new Set()

  for (const match of text.matchAll(STUDENT_ANSWER_TOKEN)) {
    const questionNumber = Number(match[1])
    const answer = match[2].toUpperCase()

    if (found.has(questionNumber)) {
      if (found.get(questionNumber) !== answer) {
        conflicting.add(questionNumber)
      }
    } else {
      found.set(questionNumber, answer)
    }
  }

  const answers = new Map()
  for (const [questionNumber, answer] of found.entries()) {
    if (!conflicting.has(questionNumber)) {
      answers.set(questionNumber, answer)
    }
  }

  return answers
}

/**
 * Attempts to extract a student-answer text block from raw OCR text so it can
 * pre-fill the editable student-answer field. Only lines/tokens that clearly
 * match "題號:答案" are kept; anything else is ignored rather than guessed.
 */
export function extractStudentAnswerText(rawText) {
  const answers = parseStudentAnswers(rawText)
  if (answers.size === 0) return ''
  return [...answers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([questionNumber, answer]) => `${questionNumber}:${answer}`)
    .join('\n')
}

/**
 * Grades a single submission against the standard answer key.
 *
 * - Only questions present in the answer key are counted.
 * - Unanswered or unrecognized questions never count as correct.
 * - pointsPerQuestion applies equally to every question.
 */
export function gradeSubmission({ answerKey, studentAnswers, pointsPerQuestion }) {
  const totalCount = answerKey.size
  let correctCount = 0
  let answeredCount = 0
  const wrongQuestions = []

  const sortedQuestionNumbers = [...answerKey.keys()].sort((a, b) => a - b)

  for (const questionNumber of sortedQuestionNumbers) {
    const correctAnswer = answerKey.get(questionNumber)
    const studentAnswer = studentAnswers.get(questionNumber)

    if (studentAnswer) {
      answeredCount += 1
      if (studentAnswer === correctAnswer) {
        correctCount += 1
        continue
      }
    }

    wrongQuestions.push({
      questionNumber,
      studentAnswer: studentAnswer ?? null,
      correctAnswer,
    })
  }

  const score = Math.round(correctCount * pointsPerQuestion * 100) / 100
  const totalScore = Math.round(totalCount * pointsPerQuestion * 100) / 100

  return {
    totalCount,
    correctCount,
    answeredCount,
    score,
    totalScore,
    wrongQuestions,
  }
}

/**
 * Formats the wrong-question list into a compact human-readable string for
 * display or Excel export, e.g. "第1題(作答B,正解A)、第5題(未作答,正解C)".
 */
export function formatWrongQuestions(wrongQuestions) {
  if (!wrongQuestions || wrongQuestions.length === 0) return '—'
  return wrongQuestions
    .map(
      ({ questionNumber, studentAnswer, correctAnswer }) =>
        `第${questionNumber}題(${studentAnswer ? `作答${studentAnswer}` : '未作答'},正解${correctAnswer})`,
    )
    .join('、')
}
