const assert = require('node:assert/strict')
const vscode = require('vscode')
const { mkdtemp, writeFile, readFile, readdir, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('skillvortex.skillvortex-extension')
  assert.ok(extension, 'Extension must be discoverable in isolated VS Code host')
  await extension.activate()
  const commands = await vscode.commands.getCommands()
  for (const name of ['open', 'createVault', 'openVault', 'migrateDesktop']) {
    assert.ok(commands.includes(`skillVortex.${name}`), `Missing command ${name}`)
  }
  const webviewAssets = await readdir(join(extension.extensionPath, 'dist/webview/assets'))
  const mainBundle = webviewAssets.find(name => /^main-.*\.js$/.test(name))
  assert.ok(mainBundle, 'Webview entry bundle must be packaged')
  const mainSource = await readFile(join(extension.extensionPath, 'dist/webview/assets', mainBundle), 'utf8')
  assert.doesNotMatch(mainSource, /process\.env\.NODE_ENV/, 'Webview bundle must not require Node.js process globals')
  assert.match(mainSource, /Criar cofre/, 'Welcome screen must contain the create-vault action')
  assert.match(mainSource, /Conheca as telas/, 'Welcome screen must describe the screen previews')
  assert.match(mainSource, /data:image\/png;base64,/, 'Desktop reference screenshots must be bundled locally')
  const extensionSource = await readFile(join(extension.extensionPath, 'dist/extension.js'), 'utf8')
  assert.match(extensionSource, /runtime-fallback/, 'Webview must show diagnostics instead of a blank page')
  await vscode.commands.executeCommand('skillVortex.open')
  const hasTab = () => vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'SkillVortex'))
  if (!hasTab()) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { listener.dispose(); reject(new Error('Webview tab did not open within 10 seconds')) }, 10000)
      const listener = vscode.window.tabGroups.onDidChangeTabs(() => {
        if (hasTab()) { clearTimeout(timeout); listener.dispose(); resolve() }
      })
      if (hasTab()) { clearTimeout(timeout); listener.dispose(); resolve() }
    })
  }
  assert.ok(hasTab())
  await require('./clipboard.cjs')(extension)
  await require('./card-colors.cjs')(extension)

  // Run the shipped WASM against real data in the host's runtime, not Node/Electron SQLite.
  const { initializeSql, migrateDesktop, rebuildIndex } = require(join(extension.extensionPath, 'dist/database.js'))
  const { createVault, readVault } = require(join(extension.extensionPath, 'dist/vault.js'))
  const temporary = await mkdtemp(join(tmpdir(), 'skillvortex-host-data-'))
  try {
    const SQL = await initializeSql(join(extension.extensionPath, 'dist/sql-wasm.wasm'))
    const db = new SQL.Database()
    const markdown = join(temporary, 'source.md')
    await writeFile(markdown, '# Host smoke test')
    db.run(`
      CREATE TABLE skills (id TEXT, name TEXT, category TEXT, description TEXT, file_path TEXT, agents_json TEXT, status TEXT, tags_json TEXT, content TEXT);
      CREATE TABLE projects (name TEXT);
      CREATE TABLE project_skills (project_name TEXT, skill_id TEXT);
      CREATE TABLE settings (key TEXT, value TEXT);
    `)
    db.run('INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['host', 'Host', 'Geral', '', markdown, '[]', 'pending', '[]', null])
    const source = join(temporary, 'desktop.sqlite')
    await writeFile(source, db.export())
    db.close()
    const imported = await migrateDesktop(SQL, source)
    const root = join(temporary, 'vault')
    await createVault(root, imported.data, imported.contents)
    const data = await readVault(root)
    assert.equal(data.catalog.skills.length, 1)
    assert.equal(await readFile(join(root, data.catalog.skills[0].filePath), 'utf8'), '# Host smoke test')
    await rebuildIndex(SQL, join(temporary, 'index'), root, data)
    assert.equal((await readdir(join(temporary, 'index'))).length, 1)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  console.log('SkillVortex: extension activation, Webview tab, clipboard, card colors, migration and WASM index passed in VS Code host')
}
