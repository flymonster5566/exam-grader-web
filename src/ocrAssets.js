// Pure helpers for building same-site Tesseract.js OCR asset URLs, deciding
// whether a CDN fallback should be attempted, and classifying OCR startup
// failures into user-facing Traditional Chinese categories.
//
// Kept framework-free so they can be unit tested without a browser or
// bundler, and so the GitHub Pages base path (e.g. `/exam-grader-web/`)
// is only ever combined in one place.

const OCR_CORE_FILE = 'tesseract-core-lstm.wasm.js'

export function getOcrAssetsBaseUrl(baseUrl = '/') {
  const normalized = baseUrl && baseUrl.length > 0 ? baseUrl : '/'
  const withLeadingSlash = normalized.startsWith('/')
    ? normalized
    : `/${normalized}`
  const withoutTrailingSlash = withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash
  return `${withoutTrailingSlash}/ocr`
}

// Options accepted by tesseract.js `createWorker` (v7) to resolve the
// worker script, core/WASM file and language traineddata from the site
// itself instead of jsDelivr. `corePath` is given as an exact `.js` file so
// Tesseract.js skips SIMD feature-detection and only needs one core variant.
export function buildSameSiteWorkerOptions(baseUrl) {
  const assetsBaseUrl = getOcrAssetsBaseUrl(baseUrl)
  return {
    workerPath: `${assetsBaseUrl}/worker.min.js`,
    corePath: `${assetsBaseUrl}/core/${OCR_CORE_FILE}`,
    langPath: `${assetsBaseUrl}/lang`,
  }
}

export const OCR_ERROR_CATEGORY = {
  RESOURCE_LOAD: 'resource-load',
  WORKER_INIT: 'worker-init',
  LANG_LOAD: 'lang-load',
}

const CATEGORY_MESSAGES = {
  [OCR_ERROR_CATEGORY.RESOURCE_LOAD]:
    'OCR 引擎程式資源無法載入，請確認網路連線後再試；若問題持續，請聯絡系統管理者。',
  [OCR_ERROR_CATEGORY.WORKER_INIT]:
    'OCR 引擎初始化失敗，請重新整理頁面後再試；若問題持續，請聯絡系統管理者。',
  [OCR_ERROR_CATEGORY.LANG_LOAD]:
    'OCR 繁體中文／英文語言資料載入失敗，請確認網路連線後再試；若問題持續，請聯絡系統管理者。',
}

function toErrorText(error) {
  if (typeof error === 'string') return error
  if (error && typeof error.message === 'string') return error.message
  return String(error ?? '')
}

// Classifies a thrown/rejected OCR startup error into one of the categories
// above so the UI can show a specific, actionable Traditional Chinese
// message without leaking internal URLs. Full technical details should
// still be logged to the developer console by the caller.
export function classifyOcrStartupError(error) {
  const text = toErrorText(error).toLowerCase()

  let category
  if (text.includes('traineddata')) {
    category = OCR_ERROR_CATEGORY.LANG_LOAD
  } else if (
    text.includes('tesseractcore') ||
    text.includes('tesseract-core') ||
    text.includes('importscripts') ||
    text.includes('worker.min.js') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror')
  ) {
    category = OCR_ERROR_CATEGORY.RESOURCE_LOAD
  } else {
    category = OCR_ERROR_CATEGORY.WORKER_INIT
  }

  return { category, message: CATEGORY_MESSAGES[category] }
}

// Decides whether a CDN fallback attempt is worthwhile: only when the
// same-site attempt actually failed, and only once (the caller is expected
// to stop after the fallback attempt either succeeds or fails).
export function shouldAttemptCdnFallback({ sameSiteFailed, fallbackAttempted }) {
  return Boolean(sameSiteFailed) && !fallbackAttempted
}
