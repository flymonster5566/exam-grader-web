import { createRequire } from 'node:module'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Copies the Tesseract.js worker, a single LSTM-only WASM core variant, and
// the `chi_tra`/`eng` (LSTM-only "best_int") traineddata files from
// node_modules into `public/ocr/`, so Vite serves them as same-site static
// assets under the GitHub Pages base path instead of relying on the
// jsDelivr CDN at runtime. Re-run on every `npm run dev`/`build`/`test` via
// the `predev`/`prebuild`/`pretest` npm scripts, so nothing OCR-related is
// committed to git (see `public/ocr` in .gitignore).

const require = createRequire(import.meta.url)
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const ocrPublicDir = path.join(projectRoot, 'public', 'ocr')

function packageDir(packageJsonSpecifier) {
  try {
    return path.dirname(require.resolve(packageJsonSpecifier))
  } catch (error) {
    throw new Error(
      `無法找到 OCR 資源套件 "${packageJsonSpecifier}"。請確認已執行 npm install，` +
        `且 package.json 中列有對應的 devDependency（例如 tesseract.js-core、` +
        `@tesseract.js-data/chi_tra、@tesseract.js-data/eng）。原始錯誤：${error.message}`,
    )
  }
}

async function copyInto(sourcePath, destDir, destFileName = path.basename(sourcePath)) {
  await mkdir(destDir, { recursive: true })
  try {
    await copyFile(sourcePath, path.join(destDir, destFileName))
  } catch (error) {
    throw new Error(
      `無法複製 OCR 資源檔案 "${sourcePath}"。這可能表示已安裝的套件版本內部目錄結構` +
        `已變更，需要更新本腳本。原始錯誤：${error.message}`,
    )
  }
}

// The LSTM-only "best_int" traineddata lives under a version-prefixed
// directory (e.g. "4.0.0_best_int"). Rather than hardcoding the version
// (which would silently break on a routine package update), discover it by
// name pattern so a minor/patch bump in `@tesseract.js-data/*` keeps working.
async function findBestIntDir(packageRoot) {
  let entries
  try {
    entries = await readdir(packageRoot, { withFileTypes: true })
  } catch (error) {
    throw new Error(
      `無法讀取 OCR 語言資料套件目錄 "${packageRoot}"。原始錯誤：${error.message}`,
    )
  }
  const match = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith('_best_int'),
  )
  if (!match) {
    throw new Error(
      `在 "${packageRoot}" 中找不到 "*_best_int" 語言資料目錄。這表示已安裝的套件` +
        `版本內部目錄結構已變更，需要更新本腳本以符合新的套件結構。`,
    )
  }
  return path.join(packageRoot, match.name)
}

async function main() {
  await rm(ocrPublicDir, { recursive: true, force: true })

  const tesseractJsDistDir = path.join(
    packageDir('tesseract.js/package.json'),
    'dist',
  )
  await copyInto(
    path.join(tesseractJsDistDir, 'worker.min.js'),
    ocrPublicDir,
  )

  const tesseractCoreDir = packageDir('tesseract.js-core/package.json')
  const coreDestDir = path.join(ocrPublicDir, 'core')
  for (const fileName of [
    'tesseract-core-lstm.js',
    'tesseract-core-lstm.wasm',
    'tesseract-core-lstm.wasm.js',
  ]) {
    await copyInto(path.join(tesseractCoreDir, fileName), coreDestDir)
  }

  const langDestDir = path.join(ocrPublicDir, 'lang')
  for (const lang of ['chi_tra', 'eng']) {
    const packageRoot = packageDir(`@tesseract.js-data/${lang}/package.json`)
    const langDataDir = await findBestIntDir(packageRoot)
    await copyInto(
      path.join(langDataDir, `${lang}.traineddata.gz`),
      langDestDir,
    )
  }
}

await main()
