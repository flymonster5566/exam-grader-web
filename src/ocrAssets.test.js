import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OCR_ERROR_CATEGORY,
  buildSameSiteWorkerOptions,
  classifyOcrStartupError,
  getOcrAssetsBaseUrl,
  shouldAttemptCdnFallback,
} from './ocrAssets.js'

test('builds OCR assets base URL under the GitHub Pages project base path', () => {
  assert.equal(getOcrAssetsBaseUrl('/exam-grader-web/'), '/exam-grader-web/ocr')
})

test('builds OCR assets base URL for root base path without double slashes', () => {
  assert.equal(getOcrAssetsBaseUrl('/'), '/ocr')
})

test('tolerates a missing leading or trailing slash in the base URL', () => {
  assert.equal(getOcrAssetsBaseUrl('exam-grader-web'), '/exam-grader-web/ocr')
  assert.equal(getOcrAssetsBaseUrl(''), '/ocr')
})

test('builds same-site worker/core/lang options for createWorker', () => {
  assert.deepEqual(buildSameSiteWorkerOptions('/exam-grader-web/'), {
    workerPath: '/exam-grader-web/ocr/worker.min.js',
    corePath: '/exam-grader-web/ocr/core/tesseract-core-lstm.wasm.js',
    langPath: '/exam-grader-web/ocr/lang',
  })
})

test('classifies traineddata fetch failures as language data errors', () => {
  const { category, message } = classifyOcrStartupError(
    'Error: Network error while fetching https://example.com/chi_tra.traineddata.gz. Response code: 404',
  )
  assert.equal(category, OCR_ERROR_CATEGORY.LANG_LOAD)
  assert.match(message, /語言資料載入失敗/)
})

test('classifies core/worker script failures as resource load errors', () => {
  assert.equal(
    classifyOcrStartupError(new Error('Failed to load TesseractCore')).category,
    OCR_ERROR_CATEGORY.RESOURCE_LOAD,
  )
  assert.equal(
    classifyOcrStartupError('NetworkError when attempting to fetch resource.')
      .category,
    OCR_ERROR_CATEGORY.RESOURCE_LOAD,
  )
})

test('falls back to a worker initialization error for unrecognized failures', () => {
  const { category, message } = classifyOcrStartupError('initialization failed')
  assert.equal(category, OCR_ERROR_CATEGORY.WORKER_INIT)
  assert.match(message, /初始化失敗/)
})

test('handles non-string, non-Error values without throwing', () => {
  assert.equal(
    classifyOcrStartupError(undefined).category,
    OCR_ERROR_CATEGORY.WORKER_INIT,
  )
})

test('only attempts a CDN fallback once, after the same-site attempt fails', () => {
  assert.equal(
    shouldAttemptCdnFallback({ sameSiteFailed: false, fallbackAttempted: false }),
    false,
  )
  assert.equal(
    shouldAttemptCdnFallback({ sameSiteFailed: true, fallbackAttempted: false }),
    true,
  )
  assert.equal(
    shouldAttemptCdnFallback({ sameSiteFailed: true, fallbackAttempted: true }),
    false,
  )
})
