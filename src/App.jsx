import { useMemo, useState } from 'react'
import * as XLSX from '@e965/xlsx'
import './App.css'

function App() {
  const [selectedFiles, setSelectedFiles] = useState([])
  const [exportStatus, setExportStatus] = useState(null)

  const resultRows = useMemo(
    () =>
      selectedFiles.map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}`,
        fileName: file.name,
        className: '—',
        seatNumber: '—',
        studentName: file.name,
        score: '—',
        status: '待辨識',
      })),
    [selectedFiles],
  )

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files ?? [])
    setSelectedFiles(files)
    setExportStatus(null)
  }

  const handleExport = () => {
    try {
      const worksheet = XLSX.utils.json_to_sheet(
        resultRows.map((row) => ({
          檔案: row.fileName,
          班級: row.className,
          座號: row.seatNumber,
          姓名: row.studentName,
          分數: row.score,
          狀態: row.status,
        })),
      )
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, '批改結果')

      const now = new Date()
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-')

      XLSX.writeFile(workbook, `考卷批改結果-${date}.xlsx`)
      setExportStatus({ type: 'success', message: 'Excel 檔案已成功匯出。' })
    } catch {
      setExportStatus({
        type: 'error',
        message: '匯出失敗，請稍後再試或確認瀏覽器允許下載。',
      })
    }
  }

  return (
    <main className="app">
      <h1>考卷批改系統（MVP）</h1>

      <section className="card">
        <h2>上傳考卷檔案</h2>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
          multiple
          onChange={handleFileChange}
        />
        <p className="hint">支援格式：JPG、JPEG、PNG、PDF</p>
      </section>

      <section className="card">
        <h2>已選檔案清單</h2>
        {selectedFiles.length === 0 ? (
          <p>尚未選擇檔案。</p>
        ) : (
          <ul>
            {selectedFiles.map((file) => (
              <li key={`${file.name}-${file.lastModified}`}>
                {file.name}（{Math.ceil(file.size / 1024)} KB）
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="results-header">
          <h2>辨識結果</h2>
          <button
            type="button"
            onClick={handleExport}
            disabled={resultRows.length === 0}
          >
            匯出 Excel
          </button>
        </div>
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
                    <td>{row.className}</td>
                    <td>{row.seatNumber}</td>
                    <td>{row.studentName}</td>
                    <td>{row.score}</td>
                    <td>{row.status}</td>
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
          <li>目前為 MVP 階段，功能以流程驗證為主。</li>
          <li>OCR 辨識尚未完成，所有資料狀態會顯示為「待辨識」。</li>
          <li>請確認上傳檔案為清晰的 JPG、JPEG、PNG 或 PDF。</li>
        </ul>
      </section>

      <section className="card">
        <h2>隱私說明</h2>
        <p>
          本系統為純前端應用，檔案與結果僅在您的瀏覽器中處理，不會上傳至伺服器，也不會使用 localStorage 儲存。
        </p>
      </section>

      <div className="version">v0.1.0-dev</div>
    </main>
  )
}

export default App
