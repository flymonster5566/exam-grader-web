import { readFile, writeFile } from 'node:fs/promises'
import { formatVersion, replaceReadmeVersion } from './version-utils.mjs'

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

const generatedModule = `export const APP_VERSION = '${formatVersion(packageJson.version)}'\n`
const readmePath = new URL('../README.md', import.meta.url)
const readme = await readFile(readmePath, 'utf8')

await writeFile(new URL('../src/version.js', import.meta.url), generatedModule)
await writeFile(readmePath, replaceReadmeVersion(readme, packageJson.version))
