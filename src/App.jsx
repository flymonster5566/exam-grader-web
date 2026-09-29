import { useMemo, useState } from 'react'
import './App.css'

function App() {
  const [selectedFiles, setSelectedFiles] = useState([])

  const resultRows = useMemo(
    () =>
      selectedFiles.map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}`,
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
        <h2>辨識結果</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
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
                  <td colSpan="5">尚無資料</td>
                </tr>
              ) : (
                resultRows.map((row) => (
                  <tr key={row.id}>
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
          本系統為純前端應用，檔案僅在您的瀏覽器中處理，不會上傳至本專案的後端伺服器。
        </p>
      </section>

      <div className="version">v0.1.0-dev</div>
    </main>
  )
}

export default App
