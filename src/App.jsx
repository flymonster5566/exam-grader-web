import { useEffect, useRef, useState } from 'react'
import { parseOcrFields } from './parseOcrFields.js'
import './App.css'

const imageErrorMessage =
  '圖片無法讀取或 OCR 辨識失敗，請確認檔案完整且清晰後再試。'

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
    score: '—',
    status: isPdf ? 'PDF 暫不支援' : isImage ? '待辨識' : '格式不支援',
    error: '',
    isImage,
  }
}

function App() {
  const [resultRows, setResultRows] = useState([])
  const [exportStatus, setExportStatus] = useState(null)
  const [xlsxModule, setXlsxModule] = useState(null)
  const [ocrStatus, setOcrStatus] = useState({
    running: false,
    message: '',
    fileName: '',
    progress: null,
  })
  const activeWorkerRef = useRef(null)
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
    },
    [],
  )

  const handleFileChange = (event) => {
    const worker = activeWorkerRef.current
    const cancelledRun = ocrStatus.running
    ocrRunIdRef.current += 1
    activeWorkerRef.current = null
    if (worker) void worker.terminate().catch(() => {})

    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setResultRows(files.map(createResultRow))
    setExportStatus(null)
    setOcrStatus({
      running: false,
      message: cancelledRun ? '已取消前次辨識，請重新開始。' : '',
      fileName: '',
      progress: null,
    })
  }

  const updateRow = (id, updates) => {
    setResultRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...updates } : row)),
    )
  }

  const handleStartOcr = async () => {
    const imageRows = resultRows.filter(
      (row) =>
        row.isImage && ['待辨識', '辨識失敗'].includes(row.status),
    )
    if (imageRows.length === 0) return

    const runId = ocrRunIdRef.current + 1
    ocrRunIdRef.current = runId
    let activeFileName = imageRows[0].fileName
    let worker
    let failedCount = 0

    setOcrStatus({
      running: true,
      message: '正在載入 OCR 引擎與繁體中文辨識資料…',
      fileName: activeFileName,
      progress: 0,
    })

    try {
      const { createWorker } = await import('tesseract.js')
      if (ocrRunIdRef.current !== runId) return
      worker = await createWorker(['chi_tra', 'eng'], undefined, {
        cacheMethod: 'none',
        logger: ({ status, progress }) => {
          if (ocrRunIdRef.current !== runId) return
          const message =
            status === 'recognizing text'
              ? '正在辨識圖片…'
              : `正在載入 OCR 資料：${status}`
          setOcrStatus({
            running: true,
            message,
            fileName: activeFileName,
            progress:
              status === 'recognizing text'
                ? Math.round(progress * 100)
                : null,
          })
        },
      })

      if (ocrRunIdRef.current !== runId) {
        await worker.terminate()
        return
      }
      activeWorkerRef.current = worker

      for (const row of imageRows) {
        if (ocrRunIdRef.current !== runId) break
        activeFileName = row.fileName
        updateRow(row.id, { status: '辨識中', error: '' })
        setOcrStatus({
          running: true,
          message: '正在辨識圖片…',
          fileName: activeFileName,
          progress: 0,
        })

        try {
          const {
            data: { text },
          } = await worker.recognize(row.file)
          if (ocrRunIdRef.current !== runId) break
          updateRow(row.id, {
            ...parseOcrFields(text),
            status: '待確認',
            error: '',
          })
        } catch {
          if (ocrRunIdRef.current !== runId) break
          failedCount += 1
          updateRow(row.id, {
            status: '辨識失敗',
            error: imageErrorMessage,
          })
        }
      }

      if (ocrRunIdRef.current === runId) {
        setOcrStatus({
          running: false,
          message:
            failedCount > 0
              ? `辨識作業完成，有 ${failedCount} 個圖片檔辨識失敗，請查看各列提示或重試。`
              : '圖片辨識完成，請逐筆人工確認結果。',
          fileName: '',
          progress: null,
        })
      }
    } catch {
      if (ocrRunIdRef.current === runId) {
        for (const row of imageRows) {
          if (row.status !== '待確認') {
            updateRow(row.id, {
              status: '辨識失敗',
              error: 'OCR 引擎啟動失敗，請確認網路連線後再試。',
            })
          }
        }
        setOcrStatus({
          running: false,
          message: 'OCR 引擎啟動失敗，請確認網路連線後再試。',
          fileName: '',
          progress: null,
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

  const handleExport = () => {
    try {
      const worksheet = xlsxModule.utils.json_to_sheet(
        resultRows.map((row) => ({
          檔案: row.fileName,
          班級: row.className,
          座號: row.seatNumber,
          姓名: row.studentName,
          分數: row.score,
          狀態: row.status,
        })),
      )
      const workbook = xlsxModule.utils.book_new()
      xlsxModule.utils.book_append_sheet(workbook, worksheet, '批改結果')

      const now = new Date()
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-')

      xlsxModule.writeFile(workbook, `考卷批改結果-${date}.xlsx`)
      setExportStatus({ type: 'success', message: 'Excel 檔案已成功匯出。' })
    } catch {
      setExportStatus({
        type: 'error',
        message: '匯出失敗，請稍後再試或確認瀏覽器允許下載。',
      })
    }
  }

  const hasOcrCandidates = resultRows.some(
    (row) =>
      row.isImage && ['待辨識', '辨識失敗'].includes(row.status),
  )

  return (
    <main className="app">
      <h1>考卷批改系統（MVP）</h1>

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
          支援格式：JPG、JPEG、PNG、PDF。第一版 OCR 僅支援 JPG、JPEG、PNG
          圖片；PDF 可匯出結果，但尚未支援 OCR。
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
              {ocrStatus.progress !== null && `（${ocrStatus.progress}%）`}
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
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.length === 0 ? (
                <tr>
                  <td colSpan="6">尚無資料</td>
                </tr>
              ) : (
                resultRows.map((row) => (
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
                    <td>{row.score}</td>
                    <td>
                      {row.status}
                      {row.error && (
                        <small className="row-error">{row.error}</small>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>使用注意事項</h2>
        <ul>
          <li>
            第一版 OCR 僅辨識 JPG、JPEG、PNG 圖片中的印刷文字，不支援 PDF 或手寫辨識。
          </li>
          <li>
            辨識準確度會受圖片清晰度、方向、版面與文字影響，OCR
            結果皆須人工確認。
          </li>
          <li>
            系統僅嘗試擷取「班級」、「座號」、「姓名」標籤旁的文字；無法解析時會保留「—」。
          </li>
          <li>答案辨識與自動計分尚未實作，分數欄位維持「—」。</li>
        </ul>
      </section>

      <section className="card">
        <h2>隱私說明</h2>
        <p>
          考卷圖片與 OCR 結果只在瀏覽器記憶體中處理，不會上傳考卷或結果，也不使用
          localStorage。首次辨識時，瀏覽器會從 jsDelivr 載入 OCR 引擎與語言資料；圖片和辨識結果不會傳送給該服務。
        </p>
      </section>

      <div className="version">v0.1.0-dev</div>
    </main>
  )
}

export default App
