import assert from 'node:assert/strict'
import test from 'node:test'
import packageJson from '../package.json' with { type: 'json' }
import { APP_VERSION } from '../src/version.js'
import { formatVersion, replaceReadmeVersion } from './version-utils.mjs'

test('generated UI version matches package metadata', () => {
  assert.equal(APP_VERSION, formatVersion(packageJson.version))
})

test('README version is generated from package metadata', () => {
  const readme = 'Version: <!-- APP_VERSION -->old<!-- /APP_VERSION -->'
  assert.equal(
    replaceReadmeVersion(readme, packageJson.version),
    `Version: <!-- APP_VERSION -->${APP_VERSION}<!-- /APP_VERSION -->`,
  )
})
