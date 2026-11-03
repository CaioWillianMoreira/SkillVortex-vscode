import * as vscode from 'vscode'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { createVault, readVault, readContained } from './vault'
import { initializeSql, migrateDesktop, rebuildIndex } from './database'

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('refresh') }),
  z.object({ type: z.literal('openSkill'), id: z.string() }),
  z.object({ type: z.literal('createVault') }),
  z.object({ type: z.literal('openVault') }),
  z.object({ type: z.literal('migrateDesktop') })
])

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('SkillVortex')
  context.subscriptions.push(output)
  const sql = () => initializeSql(context.asAbsolutePath('dist/sql-wasm.wasm'))
  let panel: vscode.WebviewPanel | undefined
  let queue = Promise.resolve()
  let disposed = false
  context.subscriptions.push({ dispose: () => { disposed = true } })

  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    output.appendLine(message)
    void vscode.window.showErrorMessage(`SkillVortex: ${message}`)
    void panel?.webview.postMessage({ type: 'error', message })
  }
  const run = (action: () => Promise<void>) => {
    queue = queue.then(async () => { if (!disposed) await action() }).catch(report)
    return queue
  }
  async function refresh(): Promise<void> {
    const root = context.globalState.get<string>('vaultPath')
    if (!root) {
      await panel?.webview.postMessage({ type: 'state', root: null, catalog: null, projects: null })
      return
    }
    const canonical = await fs.realpath(root)
    const data = await readVault(canonical)
    await rebuildIndex(await sql(), context.globalStorageUri.fsPath, canonical, data)
    await panel?.webview.postMessage({ type: 'state', root: canonical, ...data })
  }
  async function chooseDestination(): Promise<string | undefined> {
    const parent = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: 'Selecionar pasta que recebera o cofre'
    })
    if (!parent?.[0]) return
    const name = await vscode.window.showInputBox({
      prompt: 'Nome de uma nova pasta para o cofre', value: 'MeuCofre',
      validateInput: value => /^[a-zA-Z0-9_-]{1,60}$/.test(value)
        ? null : 'Use 1 a 60 letras ASCII, numeros, hifen ou sublinhado.'
    })
    return name ? join(parent[0].fsPath, name) : undefined
  }
  async function create(): Promise<void> {
    const destination = await chooseDestination()
    if (!destination) return
    await createVault(destination)
    await context.globalState.update('vaultPath', destination)
    await refresh()
    void vscode.window.showInformationMessage('Cofre criado. Abra a biblioteca para visualizar.')
  }
  async function openVault(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Abrir cofre'
    })
    if (!selected?.[0]) return
    await readVault(selected[0].fsPath)
    await context.globalState.update('vaultPath', selected[0].fsPath)
    await refresh()
  }
  async function migrate(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      openLabel: 'Selecionar skillvortex.sqlite do desktop'
    })
    if (!selected?.[0]) return
    const confirmation = await vscode.window.showWarningMessage(
      'Feche o SkillVortex desktop antes de continuar. O banco sera apenas lido e os Markdown serao copiados para um cofre novo.',
      { modal: true }, 'Desktop fechado, continuar'
    )
    if (!confirmation) return
    const imported = await migrateDesktop(await sql(), selected[0].fsPath)
    const accept = await vscode.window.showInformationMessage(
      `Importar ${imported.data.catalog.skills.length} skills e ${imported.data.projects.projects.length} projetos?`,
      { modal: true, detail: imported.warnings.join('\n') || 'Metadados, categorias e vinculos serao preservados. Caminhos de projetos precisam ser revisados em outra maquina.' },
      'Escolher destino'
    )
    if (!accept) return
    const destination = await chooseDestination()
    if (!destination) return
    await createVault(destination, imported.data, imported.contents)
    await context.globalState.update('vaultPath', destination)
    await refresh()
    void vscode.window.showInformationMessage('Migracao concluida. Arquivos e banco originais preservados.')
  }
  async function show(): Promise<void> {
    if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Use um workspace local e confiavel.')
    if (panel) { panel.reveal(); await refresh(); return }
    panel = vscode.window.createWebviewPanel('skillVortex', 'SkillVortex', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist/webview')]
    })
    const current = panel
    const nonce = randomBytes(24).toString('base64')
    const script = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/app.js'))
    const css = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/app.css'))
    current.webview.html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${current.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${current.webview.cspSource} data:;"><link rel="stylesheet" href="${css}"><title>SkillVortex</title></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`
    context.subscriptions.push(current.onDidDispose(() => { if (panel === current) panel = undefined }))
    context.subscriptions.push(current.webview.onDidReceiveMessage((raw: unknown) => run(async () => {
      const message = messageSchema.parse(raw)
      if (message.type === 'ready' || message.type === 'refresh') await refresh()
      if (message.type === 'createVault') await create()
      if (message.type === 'openVault') await openVault()
      if (message.type === 'migrateDesktop') await migrate()
      if (message.type === 'openSkill') {
        const root = context.globalState.get<string>('vaultPath')
        if (!root) throw new Error('Abra um cofre.')
        const data = await readVault(root)
        const skill = data.catalog.skills.find(item => item.id === message.id)
        if (!skill) throw new Error('Skill nao encontrada.')
        const file = join(root, skill.filePath)
        await readContained(root, file)
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)))
      }
    })))
  }
  for (const [command, action] of [
    ['skillVortex.open', show], ['skillVortex.createVault', create],
    ['skillVortex.openVault', openVault], ['skillVortex.migrateDesktop', migrate]
  ] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(command, () => run(async () => {
      if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Use um workspace local e confiavel.')
      await action()
    })))
  }
}
