export function formatVersion(version) {
  return `v${version}`
}

export function replaceReadmeVersion(readme, version) {
  const marker = /<!-- APP_VERSION -->.*?<!-- \/APP_VERSION -->/
  if (!marker.test(readme)) {
    throw new Error('README.md must include the APP_VERSION marker.')
  }
  return readme.replace(
    marker,
    `<!-- APP_VERSION -->${formatVersion(version)}<!-- /APP_VERSION -->`,
  )
}
