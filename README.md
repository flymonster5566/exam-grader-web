# 考卷批改系統 MVP

此專案為可部署到 GitHub Pages 的純前端考卷批改系統，使用 Vite + React 建置，並以 PDF.js 和 Tesseract.js 在瀏覽器執行 OCR。

目前版本：<!-- APP_VERSION -->v0.3.0-dev<!-- /APP_VERSION -->

預計部署網址：

- https://flymonster5566.github.io/exam-grader-web/

## 功能

- 繁體中文首頁
- 支援選擇 JPG、JPEG、PNG、PDF 檔案
- 顯示已選檔案清單
- JPG、JPEG、PNG 與 PDF 可在瀏覽器啟動 OCR；可辨識繁體中文與英文印刷文字
- PDF 逐頁渲染成 canvas，再依序進行 OCR；文字型與掃描圖片型 PDF 均使用相同流程
- 顯示目前檔名、PDF 頁碼／總頁數、單頁 OCR 進度與整體檔案進度，可取消後重新開始
- PDF 限制為 20 MB、最多 100 頁，並限制頁面渲染尺寸以控制記憶體使用
- 嘗試擷取 OCR 文字中以「班級」、「座號」、「姓名」標籤標示的欄位；無法解析時不猜測
- OCR 欄位可人工修改，結果狀態為「待確認」；分數維持「—」
- 可在瀏覽器端將目前結果表格匯出為 Excel `.xlsx` 檔案
- 圖片、OCR 文字與結果僅在瀏覽器記憶體中處理，不上傳伺服器、不使用 `localStorage`
- 答案辨識與自動計分尚未實作
- 首頁包含「使用注意事項」與「隱私說明」
- 左下角版本與此處版本皆由 `package.json` 的 version 欄位產生

## OCR 限制與隱私

- 支援 JPG、JPEG、PNG 與 PDF。PDF 每頁轉成影像後逐頁執行 OCR，不使用 PDF 文字層；單一 PDF 不超過 20 MB 且最多 100 頁。
- 辨識準確率會受圖片清晰度、方向及版面影響，OCR 結果必須人工確認；系統不會自動批改或保證正確。
- 系統僅依「班級」、「座號」、「姓名」標籤解析文字；未能可靠解析時保留「—」，每筆結果均須人工確認。
- PDF.js 及其 worker 隨網站建置並部署於 GitHub Pages；首次 OCR 會從 jsDelivr 載入 Tesseract.js OCR 引擎與繁體中文／英文語言資料。瀏覽器會向 CDN 請求程式與語言資源，但 PDF／圖片檔案及 OCR 結果只在瀏覽器記憶體處理，不會傳送至 CDN 或任何伺服器。
- OCR 結果只存在目前頁面的記憶體中；重新整理或離開頁面後不會保留。
- 分數仍為「—」，答案辨識與自動計分尚未完成。

## 版本管理

`package.json` 的 `version` 是唯一版本來源。`npm run dev`、`npm run build` 與 `npm run test` 會先執行 `scripts/generate-version.mjs`，更新已納入版本控制的 `src/version.js` 與本文件版本標記；請勿手動修改產生內容。新增功能或發布版本時，明確更新 package 版本（例如 `npm version 0.4.0-dev --no-git-tag-version`），再提交同步產生的檔案。部署不會自行遞增版本，也不會自動建立版本 commit 或 tag。

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

`npm run test` 使用 Node.js 內建測試執行器，驗證欄位標籤解析、版本來源、PDF 頁面文字合併、進度計算及渲染尺寸限制。

## GitHub Pages 自動部署

已提供 `.github/workflows/deploy-pages.yml`：

- 推送到 `main` 時自動建置並部署至 GitHub Pages
- 也可透過 GitHub Actions 手動觸發 (`workflow_dispatch`)
