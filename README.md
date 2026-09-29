# 考卷批改系統 MVP

此專案為可部署到 GitHub Pages 的純前端考卷批改系統 MVP，使用 Vite + React 建置，並以 Tesseract.js 在瀏覽器執行第一版 OCR。

預計部署網址：

- https://flymonster5566.github.io/exam-grader-web/

## 功能

- 繁體中文首頁
- 支援選擇 JPG、JPEG、PNG、PDF 檔案
- 顯示已選檔案清單
- JPG、JPEG、PNG 可在瀏覽器啟動 OCR；可辨識繁體中文與英文印刷文字
- PDF 顯示「PDF 暫不支援」，不會送入圖片 OCR
- 嘗試擷取 OCR 文字中以「班級」、「座號」、「姓名」標籤標示的欄位；無法解析時不猜測
- OCR 欄位可人工修改，結果狀態為「待確認」；分數維持「—」
- 可在瀏覽器端將目前結果表格匯出為 Excel `.xlsx` 檔案
- 圖片、OCR 文字與結果僅在瀏覽器記憶體中處理，不上傳伺服器、不使用 `localStorage`
- 答案辨識與自動計分尚未實作
- 首頁包含「使用注意事項」與「隱私說明」
- 左下角顯示開發版本 `v0.1.0-dev`

## OCR 限制與隱私

- 第一版僅支援清晰 JPG、JPEG、PNG 圖片中的印刷文字，不支援 PDF 或手寫辨識。
- 辨識準確率會受圖片清晰度、方向及版面影響，OCR 結果必須人工確認；系統不會自動批改或保證正確。
- 首次使用 OCR 時，瀏覽器會從 jsDelivr 載入 Tesseract.js OCR 引擎和繁體中文／英文語言資料。考卷圖片及 OCR 結果不會傳送給 jsDelivr 或上傳至伺服器。
- OCR 結果只存在目前頁面的記憶體中；重新整理或離開頁面後不會保留。
- 分數仍為「—」，答案辨識與自動計分尚未完成。

## 本機開發

```bash
npm install
npm run dev
```

安裝相依套件後，首次啟動 OCR 需要網路連線下載 OCR 引擎與語言資料。

## 建置

```bash
npm run build
```

## 測試與檢查

```bash
npm run test
npm run lint
npm run build
npm audit
```

`npm run test` 使用 Node.js 內建測試執行器，驗證欄位標籤解析及無法解析時不猜測。

## GitHub Pages 自動部署

已提供 `.github/workflows/deploy-pages.yml`：

- 推送到 `main` 時自動建置並部署至 GitHub Pages
- 也可透過 GitHub Actions 手動觸發 (`workflow_dispatch`)
