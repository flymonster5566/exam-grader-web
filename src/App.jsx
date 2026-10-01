import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseOcrFields } from './parseOcrFields.js'
import {
  calculateOverallProgress,
  getPdfRenderScale,
  mergePdfPageTexts,
} from './pdfOcrUtils.js'
import {
  extractStudentAnswerText,
  formatWrongQuestions,
  gradeSubmission,
  parseAnswerKey,
  parsePointsPerQuestion,
  parseStudentAnswers,
} from './grading.js'
import {
  computeGridCellPixelRects,
  createGridLayout,
  gridAnswersToText,
  parseGridAnswerResults,
} from './gridAnswerSheet.js'
import { computeStatistics, formatStatisticsSummary } from './gradingStatistics.js'
import {
  buildSameSiteWorkerOptions,
  classifyOcrStartupError,
  shouldAttemptCdnFallback,
} from './ocrAssets.js'
import { APP_VERSION } from './version.js'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const imageErrorMessage =
  '圖片無法讀取或 OCR 辨識失敗，請確認檔案完整且清晰後再試。'
const pdfErrorMessage =
  'PDF 頁面無法讀取或 OCR 辨識失敗，請確認檔案未加密且內容清晰後再試。'
const PDF_SIZE_ERROR = 'PDF_SIZE_ERROR'
const PDF_PAGE_LIMIT_ERROR = 'PDF_PAGE_LIMIT_ERROR'
const MAX_PDF_SIZE = 20 * 1024 * 1024
const MAX_PDF_PAGES = 100
const DEFAULT_GRID_TOTAL_QUESTIONS = '20'
const DEFAULT_GRID_COLUMNS = '5'
const GRID_ANSWER_CHAR_WHITELIST = 'ABCD'
const gridLayoutErrorMessage =
  '固定格子版面設定錯誤，請確認總題數與每列格數皆為正整數。'
const gridLocateErrorMessage =
  '固定格子答案紙版面定位失敗，請確認影像完整、方向正確且清晰後再試。'
const gridCellErrorMessage =
  '部分格子辨識失敗，已標示為待確認，請人工檢查後再試一次。'

function createResultRow(file, index) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const isImage =
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    /\.(jpe?g|png)$/i.test(file.name)

  return {
    id: `${file.name}-${file.lastModified}-${index}`,
    file,
    fileName: file.name,
    className: '—',
    seatNumber: '—',
    studentName: '—',
    studentAnswersText: '',
    pendingQuestions: [],
    status: isPdf || isImage ? '待辨識' : '格式不支援',
    error: '',
    isPdf,
    isImage,
  }
}

function gradeRow(row, parsedAnswerKey, pointsPerQuestion) {
  if (!parsedAnswerKey.isValid || pointsPerQuestion === null) return null
  return gradeSubmission({
    answerKey: parsedAnswerKey.answerKey,
    studentAnswers: parseStudentAnswers(row.studentAnswersText),
    pointsPerQuestion,
  })
}

function displayRowStatus(row, grading) {
  const base = row.status === '待確認' && grading ? '已計分' : row.status
  if (row.pendingQuestions && row.pendingQuestions.length > 0) {
    return `${base}（待確認第${row.pendingQuestions.join('、')}題）`
  }
  return base
}

function buildExportRow(row, parsedAnswerKey, pointsPerQuestion) {
  const grading = gradeRow(row, parsedAnswerKey, pointsPerQuestion)
  return {
    檔案: row.fileName,
    班級: row.className,
    座號: row.seatNumber,
    姓名: row.studentName,
    分數: grading ? grading.score : '—',
    答對題數: grading ? grading.correctCount : '—',
    總題數: grading ? grading.totalCount : '—',
    學生答案: row.studentAnswersText || '—',
    標準答案: parsedAnswerKey.isValid
      ? [...parsedAnswerKey.answerKey.entries()]
          .map(([questionNumber, answer]) => `${questionNumber}:${answer}`)
          .join('、')
      : '—',
    錯題清單: grading ? formatWrongQuestions(grading.wrongQuestions) : '—',
    狀態: displayRowStatus(row, grading),
  }
}

// tesseract.js v7's `createWorker` promise only rejects when the *core*
// fails to load; a failed language-data fetch is only reported through the
// worker's internal message handler and otherwise leaves the returned
// promise pending forever. Racing it against an `errorHandler`-driven
// rejection ensures language load failures (and any other worker-reported
// error) surface instead of hanging indefinitely.
function createOcrWorker(createWorker, options) {
  let startupRejected = false
  // Set synchronously inside the rejecting call itself (rather than relying
  // on `startupFailure`'s `.catch()` callback having already run) so the
  // flag is correct even if `workerPromise` resolves in the same microtask
  // tick as the rejection.
  const rejectStartup = (error) => {
    startupRejected = true
    rejectStartupPromise(error)
  }
  let rejectStartupPromise
  const startupFailure = new Promise((_resolve, reject) => {
    rejectStartupPromise = reject
  })
  // If the worker starts successfully, `startupFailure` has already lost the
  // race below but keeps living (the `errorHandler` option stays attached
  // for the worker's full lifetime). Without this, a later job failure could
  // reject it with nothing listening, producing an unhandled rejection.
  startupFailure.catch(() => {})
  const workerPromise = createWorker(['chi_tra', 'eng'], undefined, {
    ...options,
    errorHandler: (error) => rejectStartup(error),
  })
  // If startup is ultimately reported as failed (e.g. language data failed
  // to load) but the underlying worker thread still ends up resolving later
  // (tesseract.js's `createWorker` promise can remain pending well past the
  // point the errorHandler already fired), terminate it instead of leaking
  // it silently, since nothing else references this worker in that case.
  workerPromise.then((worker) => {
    if (startupRejected) {
      worker.terminate().catch(() => {})
    }
  }, () => {})
  return Promise.race([workerPromise, startupFailure])
}

// Attempts to start the OCR worker using same-site assets first, falling
// back to the default CDN options (at most once, via `shouldAttemptCdnFallback`)
// only if the same-site attempt failed. Returns the worker on success, or
// throws the last error if both attempts failed.
async function startOcrWorkerWithFallback({
  createWorker,
  baseUrl,
  logger,
  onFallbackStart,
}) {
  const sameSiteOptions = buildSameSiteWorkerOptions(baseUrl)
  let fallbackAttempted = false
  let lastError = null
  try {
    return await createOcrWorker(createWorker, {
      cacheMethod: 'none',
      ...sameSiteOptions,
      logger,
    })
  } catch (sameSiteError) {
    lastError = sameSiteError
  }

  if (shouldAttemptCdnFallback({ sameSiteFailed: true, fallbackAttempted })) {
    fallbackAttempted = true
    onFallbackStart?.(lastError)
    try {
      return await createOcrWorker(createWorker, {
        cacheMethod: 'none',
        logger,
      })
    } catch (fallbackError) {
      lastError = fallbackError
    }
  }

  throw lastError
}

// Loads an image File into an off-screen canvas so it can be cropped into
// per-question cells for grid OCR (the existing free-text flow passes image
// Files straight to `worker.recognize`, which doesn't expose pixel
// dimensions needed for cropping).
function loadImageFileToCanvas(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas 不支援')
        context.drawImage(image, 0, 0)
        resolve(canvas)
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(gridLocateErrorMessage))
    }
    image.src = objectUrl
  })
}

// Crops one grid cell out of a full answer-sheet canvas into its own small
// canvas, for isolated single-character OCR.
function cropCanvasCell(sourceCanvas, rect) {
  const cellCanvas = document.createElement('canvas')
  cellCanvas.width = rect.width
  cellCanvas.height = rect.height
  const context = cellCanvas.getContext('2d')
  if (!context) throw new Error('Canvas 不支援')
  context.drawImage(
    sourceCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  )
  return cellCanvas
}

// Runs the fixed-grid OCR flow on a full answer-sheet canvas: locates every
// cell via `layout`, OCRs each cell in isolation restricted to A/B/C/D, and
// returns the parsed answers/blank/pending questions (see
// `parseGridAnswerResults` in gridAnswerSheet.js for the no-guessing rules).
async function recognizeGridCells(worker, canvas, layout) {
  let cellRects
  try {
    cellRects = computeGridCellPixelRects(layout, canvas.width, canvas.height)
  } catch (error) {
    throw new Error(gridLocateErrorMessage, { cause: error })
  }

  await worker.setParameters({ tessedit_char_whitelist: GRID_ANSWER_CHAR_WHITELIST })
  try {
    const cellResults = []
    for (const rect of cellRects) {
      try {
        const cellCanvas = cropCanvasCell(canvas, rect)
        const { data } = await worker.recognize(cellCanvas)
        cellResults.push({
          questionNumber: rect.questionNumber,
          text: data.text,
          confidence: data.confidence,
        })
      } catch {
        // A single cell failing to OCR must not abort the whole sheet; treat
        // it as unclear so it is surfaced as "待確認" instead of silently
        // dropped or guessed.
        cellResults.push({ questionNumber: rect.questionNumber, text: '?', confidence: 0 })
      }
    }
    return parseGridAnswerResults(cellResults)
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: '' })
  }
}

function App() {
  const [resultRows, setResultRows] = useState([])
  const [exportStatus, setExportStatus] = useState(null)
  const [xlsxModule, setXlsxModule] = useState(null)
  const [answerKeyText, setAnswerKeyText] = useState('')
  const [pointsPerQuestionText, setPointsPerQuestionText] = useState('1')
  const [gridMode, setGridMode] = useState(false)
  const [gridTotalQuestionsText, setGridTotalQuestionsText] = useState(
    DEFAULT_GRID_TOTAL_QUESTIONS,
  )
  const [gridColumnsText, setGridColumnsText] = useState(DEFAULT_GRID_COLUMNS)
  const [standardSheetFile, setStandardSheetFile] = useState(null)
  const [standardSheetStatus, setStandardSheetStatus] = useState(null)
  const [ocrStatus, setOcrStatus] = useState({
    running: false,
    message: '',
    fileName: '',
    progress: null,
    pageNumber: null,
    totalPages: null,
    pageProgress: null,
  })
  const activeWorkerRef = useRef(null)
  const activePdfLoadingTaskRef = useRef(null)
  const activePdfDocumentRef = useRef(null)
  const activeRenderTaskRef = useRef(null)
  const currentWorkRef = useRef(null)
  const ocrRunIdRef = useRef(0)

  useEffect(() => {
    let isMounted = true
    import('@e965/xlsx')
      .then((module) => {
        if (isMounted) setXlsxModule(module)
      })
      .catch(() => {
        if (isMounted) {
          setExportStatus({
            type: 'error',
            message: 'Excel 模組載入失敗，請重新整理頁面後再試。',
          })
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(
    () => () => {
      ocrRunIdRef.current += 1
      const worker = activeWorkerRef.current
      activeWorkerRef.current = null
      if (worker) void worker.terminate().catch(() => {})
      activeRenderTaskRef.current?.cancel()
      activeRenderTaskRef.current = null
      const loadingTask = activePdfLoadingTaskRef.current
      activePdfLoadingTaskRef.current = null
      if (loadingTask) void loadingTask.destroy().catch(() => {})
      const pdfDocument = activePdfDocumentRef.current
      activePdfDocumentRef.current = null
      if (pdfDocument) void pdfDocument.destroy().catch(() => {})
    },
    [],
  )

  const cancelOcr = () => {
    ocrRunIdRef.current += 1
    const worker = activeWorkerRef.current
    activeWorkerRef.current = null
    if (worker) void worker.terminate().catch(() => {})
    activeRenderTaskRef.current?.cancel()
    activeRenderTaskRef.current = null
    const loadingTask = activePdfLoadingTaskRef.current
    activePdfLoadingTaskRef.current = null
    if (loadingTask) void loadingTask.destroy().catch(() => {})
    const pdfDocument = activePdfDocumentRef.current
    activePdfDocumentRef.current = null
    if (pdfDocument) void pdfDocument.destroy().catch(() => {})
    currentWorkRef.current = null
  }

  const handleFileChange = (event) => {
    const cancelledRun = ocrStatus.running
    cancelOcr()

    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setResultRows(files.map(createResultRow))
    setExportStatus(null)
    setOcrStatus({
      running: false,
      message: cancelledRun ? '已取消前次辨識，請重新開始。' : '',
      fileName: '',
      progress: null,
      pageNumber: null,
      totalPages: null,
      pageProgress: null,
    })
  }

  const handleCancelOcr = () => {
    cancelOcr()
    setResultRows((rows) =>
      rows.map((row) =>
        row.status === '辨識中' ? { ...row, status: '待辨識', error: '' } : row,
      ),
    )
    setOcrStatus({
      running: false,
      message: '已取消辨識，可重新開始或選擇其他檔案。',
      fileName: '',
      progress: null,
      pageNumber: null,
      totalPages: null,
      pageProgress: null,
    })
  }

  const updateRow = (id, updates) => {
    setResultRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...updates } : row)),
    )
  }

  const handleStartOcr = async () => {
    const ocrRows = resultRows.filter(
      (row) =>
        (row.isImage || row.isPdf) &&
        ['待辨識', '辨識失敗'].includes(row.status),
    )
    if (ocrRows.length === 0) return

    let gridLayoutResult = null
    if (gridMode) {
      try {
        gridLayoutResult = {
          layout: createGridLayout({
            totalQuestions: Number(gridTotalQuestionsText),
            columns: Number(gridColumnsText),
          }),
        }
      } catch {
        setOcrStatus({
          running: false,
          message: gridLayoutErrorMessage,
          fileName: '',
          progress: null,
          pageNumber: null,
          totalPages: null,
          pageProgress: null,
        })
        return
      }
    }

    const runId = ocrRunIdRef.current + 1
    ocrRunIdRef.current = runId
    let worker
    let failedCount = 0
    let ocrStartupSettled = false

    setOcrStatus({
      running: true,
      message: '正在載入本機 OCR 引擎與繁體中文辨識資料…',
      fileName: ocrRows[0].fileName,
      progress: 0,
      pageNumber: null,
      totalPages: null,
      pageProgress: null,
    })

    try {
      const { createWorker } = await import('tesseract.js')
      if (ocrRunIdRef.current !== runId) return

      const ocrWorkerLogger = ({ status, progress }) => {
        if (ocrRunIdRef.current !== runId) return
        // Ignore stale "loading" events from an abandoned worker attempt
        // (e.g. a same-site attempt still finishing in the background after
        // we've already moved on to a CDN fallback or failed outright).
        if (status !== 'recognizing text' && ocrStartupSettled) return
        const currentWork = currentWorkRef.current
        const pageProgress = Math.round(progress * 100)
        const fileProgress = currentWork
          ? ((currentWork.pageNumber - 1 + progress) /
              currentWork.totalPages) *
            100
          : progress * 100
        const message =
          status === 'recognizing text'
            ? currentWork?.isPdf
              ? `正在辨識 PDF 第 ${currentWork.pageNumber} 頁…`
              : '正在辨識圖片…'
            : `正在載入 OCR 資料：${status}`
        setOcrStatus({
          running: true,
          message,
          fileName: currentWork?.fileName ?? ocrRows[0].fileName,
          progress: currentWork
            ? calculateOverallProgress(
                currentWork.fileIndex,
                ocrRows.length,
                fileProgress,
              )
            : null,
          pageNumber: currentWork?.isPdf ? currentWork.pageNumber : null,
          totalPages: currentWork?.isPdf ? currentWork.totalPages : null,
          pageProgress: currentWork?.isPdf ? pageProgress : null,
        })
      }

      let startupError = null
      try {
        worker = await startOcrWorkerWithFallback({
          createWorker,
          baseUrl: import.meta.env.BASE_URL,
          logger: ocrWorkerLogger,
          onFallbackStart: (sameSiteError) => {
            if (ocrRunIdRef.current !== runId) return
            console.error('同站 OCR 資源載入失敗，改嘗試 CDN 備援資源。', sameSiteError)
            setOcrStatus({
              running: true,
              message: '同站 OCR 資源載入失敗，正在嘗試備援 OCR 資源（CDN）…',
              fileName: ocrRows[0].fileName,
              progress: 0,
              pageNumber: null,
              totalPages: null,
              pageProgress: null,
            })
          },
        })
      } catch (error) {
        startupError = error
      }

      ocrStartupSettled = true
      if (startupError) throw startupError

      if (ocrRunIdRef.current !== runId) {
        await worker.terminate()
        return
      }
      activeWorkerRef.current = worker

      for (const [fileIndex, row] of ocrRows.entries()) {
        if (ocrRunIdRef.current !== runId) break
        updateRow(row.id, { status: '辨識中', error: '' })
        setOcrStatus({
          running: true,
          message: row.isPdf ? '正在讀取 PDF…' : '正在辨識圖片…',
          fileName: row.fileName,
          progress: calculateOverallProgress(fileIndex, ocrRows.length),
          pageNumber: null,
          totalPages: null,
          pageProgress: null,
        })

        let text
        let loadingTask
        let pdfDocument
        let gridSourceCanvas
        try {
          if (row.isPdf) {
            if (row.file.size > MAX_PDF_SIZE) {
              throw new Error(PDF_SIZE_ERROR)
            }

            const pdfData = await row.file.arrayBuffer()
            if (ocrRunIdRef.current !== runId) break
            loadingTask = pdfjsLib.getDocument({ data: pdfData })
            activePdfLoadingTaskRef.current = loadingTask
            pdfDocument = await loadingTask.promise
            if (ocrRunIdRef.current !== runId) break
            activePdfLoadingTaskRef.current = null
            activePdfDocumentRef.current = pdfDocument

            if (pdfDocument.numPages > MAX_PDF_PAGES) {
              throw new Error(PDF_PAGE_LIMIT_ERROR)
            }

            // Fixed-grid answer sheets are a single page; only the first
            // page is rendered/recognized in grid mode.
            const pagesToProcess = gridMode ? 1 : pdfDocument.numPages

            const pageTexts = []
            for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
              if (ocrRunIdRef.current !== runId) break
              const page = await pdfDocument.getPage(pageNumber)
              let canvas
              let renderTask
              try {
                if (ocrRunIdRef.current !== runId) break
                const initialViewport = page.getViewport({ scale: 1 })
                const scale = getPdfRenderScale(
                  initialViewport.width,
                  initialViewport.height,
                )
                const viewport = page.getViewport({ scale })
                canvas = document.createElement('canvas')
                canvas.width = Math.ceil(viewport.width)
                canvas.height = Math.ceil(viewport.height)
                const context = canvas.getContext('2d')
                if (!context) throw new Error('Canvas 不支援')
                currentWorkRef.current = {
                  fileName: row.fileName,
                  fileIndex,
                  isPdf: true,
                  pageNumber,
                  runId,
                  totalPages: pdfDocument.numPages,
                }
                setOcrStatus({
                  running: true,
                  message: `正在轉換 PDF 第 ${pageNumber} 頁…`,
                  fileName: row.fileName,
                  progress: calculateOverallProgress(
                    fileIndex,
                    ocrRows.length,
                    ((pageNumber - 1) / pdfDocument.numPages) * 100,
                  ),
                  pageNumber,
                  totalPages: pdfDocument.numPages,
                  pageProgress: 0,
                })
                renderTask = page.render({
                  canvasContext: context,
                  viewport,
                })
                activeRenderTaskRef.current = renderTask
                await renderTask.promise
                if (activeRenderTaskRef.current === renderTask) {
                  activeRenderTaskRef.current = null
                }
                if (ocrRunIdRef.current !== runId) break
                if (gridMode && pageNumber === 1) {
                  gridSourceCanvas = document.createElement('canvas')
                  gridSourceCanvas.width = canvas.width
                  gridSourceCanvas.height = canvas.height
                  gridSourceCanvas.getContext('2d').drawImage(canvas, 0, 0)
                }
                const {
                  data: { text: pageText },
                } = await worker.recognize(canvas)
                if (ocrRunIdRef.current !== runId) break
                pageTexts.push(pageText)
              } finally {
                if (canvas) {
                  canvas.width = 0
                  canvas.height = 0
                }
                page.cleanup()
                if (activeRenderTaskRef.current === renderTask) {
                  activeRenderTaskRef.current = null
                }
              }
            }
            if (ocrRunIdRef.current !== runId) break
            text = mergePdfPageTexts(pageTexts)
          } else {
            currentWorkRef.current = {
              fileName: row.fileName,
              fileIndex,
              isPdf: false,
              pageNumber: 1,
              runId,
              totalPages: 1,
            }
            if (gridMode) {
              gridSourceCanvas = await loadImageFileToCanvas(row.file)
              if (ocrRunIdRef.current !== runId) break
              const { data } = await worker.recognize(gridSourceCanvas)
              text = data.text
            } else {
              const result = await worker.recognize(row.file)
              text = result.data.text
            }
            if (ocrRunIdRef.current !== runId) break
          }

          let gridAnswersResult = null
          if (gridMode && gridSourceCanvas) {
            gridAnswersResult = await recognizeGridCells(
              worker,
              gridSourceCanvas,
              gridLayoutResult.layout,
            )
          }

          updateRow(row.id, {
            ...parseOcrFields(text),
            studentAnswersText: gridAnswersResult
              ? gridAnswersToText(gridAnswersResult.answers)
              : extractStudentAnswerText(text),
            pendingQuestions: gridAnswersResult
              ? gridAnswersResult.pendingQuestions
              : [],
            status: '待確認',
            error: gridAnswersResult && gridAnswersResult.pendingQuestions.length > 0
              ? gridCellErrorMessage
              : '',
          })
        } catch (error) {
          if (ocrRunIdRef.current !== runId) break
          failedCount += 1
          updateRow(row.id, {
            status: '辨識失敗',
            error:
              error?.message === gridLocateErrorMessage
                ? gridLocateErrorMessage
                : row.isPdf
                  ? error?.message === PDF_SIZE_ERROR
                    ? 'PDF 檔案超過 20 MB，請縮小檔案後再試。'
                    : error?.message === PDF_PAGE_LIMIT_ERROR
                      ? 'PDF 超過 100 頁，請拆分檔案後再試。'
                      : pdfErrorMessage
                  : imageErrorMessage,
          })
        } finally {
          if (currentWorkRef.current?.runId === runId) {
            currentWorkRef.current = null
          }
          if (activePdfLoadingTaskRef.current === loadingTask) {
            activePdfLoadingTaskRef.current = null
          }
          if (activePdfDocumentRef.current === pdfDocument) {
            activePdfDocumentRef.current = null
          }
          if (gridSourceCanvas) {
            gridSourceCanvas.width = 0
            gridSourceCanvas.height = 0
          }
          if (pdfDocument) {
            try {
              await pdfDocument.destroy()
            } catch {}
          } else if (loadingTask) {
            try {
              await loadingTask.destroy()
            } catch {}
          }
        }
      }

      if (ocrRunIdRef.current === runId) {
        setOcrStatus({
          running: false,
          message:
            failedCount > 0
              ? `辨識作業完成，有 ${failedCount} 個檔案辨識失敗，請查看各列提示或重試。`
              : '辨識完成，請逐筆人工確認結果。',
          fileName: '',
          progress: 100,
          pageNumber: null,
          totalPages: null,
          pageProgress: null,
        })
      }
    } catch (error) {
      ocrStartupSettled = true
      if (ocrRunIdRef.current === runId) {
        console.error('OCR 引擎啟動失敗：', error)
        const { message } = classifyOcrStartupError(error)
        for (const row of ocrRows) {
          updateRow(row.id, {
            status: '辨識失敗',
            error: message,
          })
        }
        setOcrStatus({
          running: false,
          message,
          fileName: '',
          progress: null,
          pageNumber: null,
          totalPages: null,
          pageProgress: null,
        })
      }
    } finally {
      if (worker) {
        try {
          await worker.terminate()
        } catch {}
        if (activeWorkerRef.current === worker) activeWorkerRef.current = null
      }
    }
  }

  const parsedAnswerKey = useMemo(
    () => parseAnswerKey(answerKeyText),
    [answerKeyText],
  )
  const pointsResult = useMemo(
    () => parsePointsPerQuestion(pointsPerQuestionText),
    [pointsPerQuestionText],
  )
  const gradingByRowId = useMemo(
    () =>
      new Map(
        resultRows.map((row) => [
          row.id,
          gradeRow(row, parsedAnswerKey, pointsResult.points),
        ]),
      ),
    [resultRows, parsedAnswerKey, pointsResult],
  )

  const statistics = useMemo(
    () =>
      computeStatistics(
        resultRows.map((row) => ({
          grading: gradingByRowId.get(row.id) ?? null,
          pendingCount: row.pendingQuestions?.length ?? 0,
        })),
      ),
    [resultRows, gradingByRowId],
  )

  const handleStandardSheetFileChange = (event) => {
    const [file] = event.target.files ?? []
    setStandardSheetFile(file ?? null)
    setStandardSheetStatus(null)
  }

  const handleStandardSheetOcr = async () => {
    if (!standardSheetFile) return

    let layout
    try {
      layout = createGridLayout({
        totalQuestions: Number(gridTotalQuestionsText),
        columns: Number(gridColumnsText),
      })
    } catch {
      setStandardSheetStatus({ type: 'error', message: gridLayoutErrorMessage })
      return
    }

    setStandardSheetStatus({ type: 'info', message: '正在辨識標準答案紙…' })

    let worker
    try {
      const { createWorker } = await import('tesseract.js')
      worker = await startOcrWorkerWithFallback({
        createWorker,
        baseUrl: import.meta.env.BASE_URL,
        logger: () => {},
      })

      const isPdf =
        standardSheetFile.type === 'application/pdf' ||
        /\.pdf$/i.test(standardSheetFile.name)

      let canvas
      if (isPdf) {
        const pdfData = await standardSheetFile.arrayBuffer()
        const loadingTask = pdfjsLib.getDocument({ data: pdfData })
        const pdfDocument = await loadingTask.promise
        try {
          const page = await pdfDocument.getPage(1)
          const initialViewport = page.getViewport({ scale: 1 })
          const scale = getPdfRenderScale(initialViewport.width, initialViewport.height)
          const viewport = page.getViewport({ scale })
          canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas 不支援')
          await page.render({ canvasContext: context, viewport }).promise
          page.cleanup()
        } finally {
          await pdfDocument.destroy()
        }
      } else {
        canvas = await loadImageFileToCanvas(standardSheetFile)
      }

      const { answers, pendingQuestions, blankQuestions } = await recognizeGridCells(
        worker,
        canvas,
        layout,
      )
      canvas.width = 0
      canvas.height = 0

      setAnswerKeyText(gridAnswersToText(answers))

      if (pendingQuestions.length > 0 || blankQuestions.length > 0) {
        const parts = []
        if (pendingQuestions.length > 0) parts.push(`待確認：第${pendingQuestions.join('、')}題`)
        if (blankQuestions.length > 0) parts.push(`未作答：第${blankQuestions.join('、')}題`)
        setStandardSheetStatus({
          type: 'warning',
          message: `標準答案紙辨識完成，已填入 ${answers.size} 題，但有${parts.join('；')}，請人工確認。`,
        })
      } else {
        setStandardSheetStatus({
          type: 'success',
          message: `標準答案紙辨識完成，已自動填入 ${answers.size} 題標準答案，請確認後使用。`,
        })
      }
    } catch (error) {
      console.error('標準答案紙 OCR 失敗：', error)
      setStandardSheetStatus({ type: 'error', message: gridLocateErrorMessage })
    } finally {
      if (worker) {
        try {
          await worker.terminate()
        } catch {}
      }
    }
  }

  const handleExport = () => {
    try {
      const now = new Date()
      const worksheet = xlsxModule.utils.json_to_sheet(
        resultRows.map((row) =>
          buildExportRow(row, parsedAnswerKey, pointsResult.points),
        ),
      )
      const statisticsWorksheet = xlsxModule.utils.json_to_sheet([
        formatStatisticsSummary(statistics),
      ])
      const workbook = xlsxModule.utils.book_new()
      xlsxModule.utils.book_append_sheet(workbook, worksheet, '批改結果')
      xlsxModule.utils.book_append_sheet(workbook, statisticsWorksheet, '統計摘要')

      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-')

      xlsxModule.writeFile(workbook, `考卷批改結果-${date}.xlsx`)
      setExportStatus({ type: 'success', message: 'Excel 檔案已成功匯出，包含批改結果與統計摘要。' })
    } catch {
      setExportStatus({
        type: 'error',
        message: '匯出失敗，請稍後再試或確認瀏覽器允許下載。',
      })
    }
  }


  const hasOcrCandidates = resultRows.some(
    (row) =>
      (row.isImage || row.isPdf) &&
      ['待辨識', '辨識失敗'].includes(row.status),
  )

  return (
    <main className="app">
      <h1>考卷批改系統（MVP）</h1>

      <section className="card">
        <h2>標準答案設定</h2>
        <p className="hint">
          目前僅支援選擇題，格式為每行一題「題號:答案」，例如：
        </p>
        <pre className="answer-key-example">{'1:A\n2:C\n3:B'}</pre>
        <p className="hint">僅接受 A、B、C、D，題號需從 1 開始連續且不可重複或空白。</p>
        <label htmlFor="answer-key-input">標準答案</label>
        <textarea
          id="answer-key-input"
          rows={6}
          value={answerKeyText}
          onChange={(event) => setAnswerKeyText(event.target.value)}
          aria-describedby="answer-key-status"
        />
        <label htmlFor="points-per-question">每題配分</label>
        <input
          id="points-per-question"
          type="number"
          min="0"
          step="any"
          value={pointsPerQuestionText}
          onChange={(event) => setPointsPerQuestionText(event.target.value)}
          aria-describedby="answer-key-status"
        />
        <div id="answer-key-status" aria-live="polite">
          {pointsResult.error && (
            <p className="error-message" role="alert">
              {pointsResult.error}
            </p>
          )}
          {parsedAnswerKey.errors.length > 0 && (
            <ul className="error-message" role="alert">
              {parsedAnswerKey.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {parsedAnswerKey.isValid && (
            <p className="success-message">
              已解析 {parsedAnswerKey.totalQuestions} 題標準答案：
              {[...parsedAnswerKey.answerKey.entries()]
                .map(([questionNumber, answer]) => `${questionNumber}:${answer}`)
                .join('、')}
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <h2>固定格子答案紙 OCR（標準答案／學生答案）</h2>
        <p className="hint">
          三個階段：① 標準答案 OCR → ② 學生答案 OCR → ③ 比對與統計。此模式不辨識自由書寫文字，
          只針對固定格子中的單一字元進行 A/B/C/D 分類，無法清楚判讀時會標示「待確認」，不會猜測。
        </p>
        <label htmlFor="grid-mode-toggle">
          <input
            id="grid-mode-toggle"
            type="checkbox"
            checked={gridMode}
            onChange={(event) => setGridMode(event.target.checked)}
          />
          {' '}使用固定格子答案紙模式（標準答案與學生答案皆為固定格子 A/B/C/D）
        </label>
        {gridMode && (
          <>
            <div className="grid-settings">
              <label htmlFor="grid-total-questions">總題數</label>
              <input
                id="grid-total-questions"
                type="number"
                min="1"
                step="1"
                value={gridTotalQuestionsText}
                onChange={(event) => setGridTotalQuestionsText(event.target.value)}
              />
              <label htmlFor="grid-columns">每列格數</label>
              <input
                id="grid-columns"
                type="number"
                min="1"
                step="1"
                value={gridColumnsText}
                onChange={(event) => setGridColumnsText(event.target.value)}
              />
            </div>
            <h3>階段一：標準答案 OCR</h3>
            <label htmlFor="standard-sheet-file">上傳固定格子標準答案紙（單張影像或 PDF）</label>
            <input
              id="standard-sheet-file"
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              onChange={handleStandardSheetFileChange}
            />
            <div className="result-actions">
              <button
                type="button"
                onClick={handleStandardSheetOcr}
                disabled={!standardSheetFile || standardSheetStatus?.type === 'info'}
              >
                標準答案 OCR
              </button>
            </div>
            <div id="standard-sheet-status" aria-live="polite">
              {standardSheetStatus && (
                <p
                  className={
                    standardSheetStatus.type === 'error'
                      ? 'error-message'
                      : standardSheetStatus.type === 'warning'
                        ? 'hint'
                        : 'success-message'
                  }
                  role={standardSheetStatus.type === 'error' ? 'alert' : 'status'}
                >
                  {standardSheetStatus.message}
                </p>
              )}
            </div>
            <p className="hint">
              階段二「學生答案 OCR」：在下方「上傳考卷檔案」選擇學生固定格子答案紙後，按「開始
              OCR」即會以相同格子版面逐格辨識學生答案。階段三「比對與統計」：辨識完成後會自動與標準答案比對，
              並於下方統計摘要顯示整體結果。
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>上傳考卷檔案</h2>
        <label htmlFor="exam-files">選擇考卷檔案</label>
        <input
          id="exam-files"
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
          multiple
          onChange={handleFileChange}
        />
        <p className="hint">
          支援格式：JPG、JPEG、PNG、PDF。PDF 限制為 20 MB、最多 100 頁；系統會逐頁轉換與辨識。
          {gridMode && '目前為固定格子答案紙模式，僅會辨識每題格子中的 A/B/C/D，PDF 僅使用第一頁。'}
        </p>
      </section>

      <section className="card">
        <h2>已選檔案清單</h2>
        {resultRows.length === 0 ? (
          <p>尚未選擇檔案。</p>
        ) : (
          <ul>
            {resultRows.map((row) => (
              <li key={row.id}>
                {row.fileName}（{Math.ceil(row.file.size / 1024)} KB）
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="results-header">
          <h2>辨識結果</h2>
          <div className="result-actions">
            <button
              type="button"
              onClick={handleStartOcr}
              disabled={!hasOcrCandidates || ocrStatus.running}
            >
              開始 OCR
            </button>
            {ocrStatus.running && (
              <button type="button" onClick={handleCancelOcr}>
                取消辨識
              </button>
            )}
            <button
              type="button"
              onClick={handleExport}
              disabled={resultRows.length === 0 || !xlsxModule}
            >
              {xlsxModule ? '匯出 Excel' : '載入 Excel 中…'}
            </button>
          </div>
        </div>
        <p className="ocr-progress" role="status" aria-live="polite">
          {ocrStatus.message}
          {ocrStatus.fileName && (
            <>
              {' '}
              目前處理：{ocrStatus.fileName}
              {ocrStatus.pageNumber !== null &&
                `（第 ${ocrStatus.pageNumber} / ${ocrStatus.totalPages} 頁${ocrStatus.pageProgress !== null ? `，本頁 ${ocrStatus.pageProgress}%` : ''}）`}
              {ocrStatus.progress !== null &&
                `（整體進度 ${ocrStatus.progress}%）`}
            </>
          )}
        </p>
        {exportStatus && (
          <p
            className={`export-message ${exportStatus.type}`}
            role={exportStatus.type === 'error' ? 'alert' : 'status'}
            aria-live={exportStatus.type === 'error' ? 'assertive' : 'polite'}
          >
            {exportStatus.message}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>檔案</th>
                <th>班級</th>
                <th>座號</th>
                <th>姓名</th>
                <th>分數</th>
                <th>答對題數</th>
                <th>學生答案</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.length === 0 ? (
                <tr>
                  <td colSpan="8">尚無資料</td>
                </tr>
              ) : (
                resultRows.map((row) => {
                  const grading = gradingByRowId.get(row.id) ?? null
                  return (
                    <tr key={row.id}>
                      <td>{row.fileName}</td>
                      <td>
                        <input
                          aria-label={`${row.fileName}的班級`}
                          type="text"
                          value={row.className}
                          onChange={(event) =>
                            updateRow(row.id, { className: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${row.fileName}的座號`}
                          type="text"
                          value={row.seatNumber}
                          onChange={(event) =>
                            updateRow(row.id, { seatNumber: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${row.fileName}的姓名`}
                          type="text"
                          value={row.studentName}
                          onChange={(event) =>
                            updateRow(row.id, { studentName: event.target.value })
                          }
                        />
                      </td>
                      <td>{grading ? `${grading.score} 分` : '—'}</td>
                      <td>
                        {grading
                          ? `${grading.correctCount}/${grading.totalCount}（已作答 ${grading.answeredCount}）`
                          : '—'}
                      </td>
                      <td>
                        <label
                          className="visually-hidden"
                          htmlFor={`student-answers-${row.id}`}
                        >
                          {`${row.fileName}的學生答案`}
                        </label>
                        <textarea
                          id={`student-answers-${row.id}`}
                          rows={3}
                          value={row.studentAnswersText}
                          onChange={(event) =>
                            updateRow(row.id, {
                              studentAnswersText: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        {displayRowStatus(row, grading)}
                        {row.error && (
                          <small className="row-error">{row.error}</small>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>統計摘要</h2>
        <p role="status" aria-live="polite">
          總人數 {statistics.totalStudents}、已計分 {statistics.gradedCount} 人、平均分{' '}
          {statistics.averageScore ?? '—'}、最高分 {statistics.highestScore ?? '—'}、最低分{' '}
          {statistics.lowestScore ?? '—'}、總已作答題數 {statistics.totalAnsweredQuestions}、
          待確認 {statistics.rowsWithPending} 人（共 {statistics.totalPendingCells} 格）、
          辨識成功率{' '}
          {statistics.recognitionSuccessRate === null
            ? '—'
            : `${statistics.recognitionSuccessRate}%`}
        </p>
      </section>

      <section className="card">
        <h2>使用注意事項</h2>
        <ul>
          <li>
            支援 JPG、JPEG、PNG 與 PDF。PDF 會逐頁渲染成影像後辨識，文字型與掃描圖片型 PDF 均不使用 PDF 文字層。
          </li>
          <li>PDF 檔案上限為 20 MB、100 頁；頁面依序處理並釋放影像，可隨時取消或重試。</li>
          <li>
            辨識準確度會受圖片清晰度、方向、版面與文字影響，OCR
            結果皆須人工確認。
          </li>
          <li>
            系統僅嘗試擷取「班級」、「座號」、「姓名」標籤旁的文字；無法解析時會保留「—」。
          </li>
          <li>
            系統僅嘗試從 OCR 文字擷取「題號:答案」格式的選擇題答案；無法可靠解析時保留空白，不會自動猜測。
          </li>
          <li>
            第一版僅支援選擇題 A、B、C、D 的自動計分，且每題配分固定相同；尚未支援非選擇題、手寫答案或其他題型的自動批改。
          </li>
          <li>
            標準答案與學生答案皆須人工確認；未作答或無法辨識的題目不計為答對。
          </li>
          <li>
            固定格子答案紙模式：版面為題號固定、每格只限填一個 A/B/C/D
            答案的格子版面，系統先定位版面格子再逐格辨識，不是自由書寫文字
            OCR；答案模糊或無法判讀時標示「待確認」，絕不猜測；PDF 僅使用第一頁。
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>隱私說明</h2>
        <p>
          PDF／圖片、OCR 結果、標準答案與計分結果只在瀏覽器記憶體中處理，不會上傳考卷或結果，也不使用
          localStorage。PDF.js 與 worker 隨網站部署；首次辨識時，瀏覽器會從 jsDelivr 載入 Tesseract.js OCR 引擎與語言資料。CDN 僅提供程式及語言資源，檔案內容與 OCR 結果不會傳送給 CDN。
        </p>
      </section>

      <div className="version">{APP_VERSION}</div>
    </main>
  )
}

export default App
