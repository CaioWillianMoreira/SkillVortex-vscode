const { runTests } = require('@vscode/test-electron')
const { mkdtempSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const temporary = mkdtempSync(join(tmpdir(), 'skillvortex-host-'))
const macExecutable = [
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
].find(existsSync)
const executable = process.env.VSCODE_EXECUTABLE_PATH ||
  (process.platform === 'darwin' ? macExecutable : undefined)
runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: [
    resolve(__dirname, '..'),
    resolve(__dirname, '../extensions/mindcards'),
    resolve(__dirname, '../extensions/product-builder')
  ],
  extensionTestsPath: resolve(__dirname, process.env.SKILLVORTEX_TEST_BUILDER_ONLY === '1'
    ? '../tests/host/product-builder.cjs' : '../tests/host/suite.cjs'),
  launchArgs: [
    '--user-data-dir', join(temporary, 'profile'),
    '--extensions-dir', join(temporary, 'extensions'),
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
    '--disable-updates'
  ]
}).catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => rmSync(temporary, { recursive: true, force: true }))
