export function mergePdfPageTexts(pageTexts) {
  return pageTexts
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n')
}

export function calculateOverallProgress(completedFiles, fileCount, currentFileProgress = 0) {
  if (fileCount <= 0) return 0
  const progress =
    ((completedFiles + Math.min(100, Math.max(0, currentFileProgress)) / 100) /
      fileCount) *
    100
  return Math.round(Math.min(100, Math.max(0, progress)))
}

export function getPdfRenderScale(width, height) {
  const baseScale = 1.5
  const maxDimension = 2400
  const maxPixels = 12_000_000
  return Math.min(
    baseScale,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / (width * height)),
  )
}
