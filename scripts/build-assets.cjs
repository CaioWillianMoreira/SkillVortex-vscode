const { mkdirSync, copyFileSync } = require('node:fs')
const { resolve } = require('node:path')
mkdirSync(resolve(__dirname, '../release'), { recursive: true })
copyFileSync(
  require.resolve('sql.js/dist/sql-wasm.wasm'),
  resolve(__dirname, '../dist/sql-wasm.wasm')
)
