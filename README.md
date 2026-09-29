# 考卷批改系統 MVP

此專案為可部署到 GitHub Pages 的純前端考卷批改系統 MVP，使用 Vite + React 建置。

預計部署網址：

- https://flymonster5566.github.io/exam-grader-web/

## 功能

- 繁體中文首頁
- 支援選擇 JPG、JPEG、PNG、PDF 檔案
- 顯示已選檔案清單
- 顯示結果表格（檔案、班級、座號、姓名、分數、狀態）
- 可在瀏覽器端將目前結果表格匯出為 Excel `.xlsx` 檔案
- 檔案與結果僅在瀏覽器中處理，不使用 `localStorage`
- OCR、答案辨識與自動計分尚未完成，目前結果為 placeholder 資料，狀態統一顯示「待辨識」
- 首頁包含「使用注意事項」與「隱私說明」
- 左下角顯示開發版本 `v0.1.0-dev`

## 本機開發

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```

## GitHub Pages 自動部署

已提供 `.github/workflows/deploy-pages.yml`：

- 推送到 `main` 時自動建置並部署至 GitHub Pages
- 也可透過 GitHub Actions 手動觸發 (`workflow_dispatch`)
