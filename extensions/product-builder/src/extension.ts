import * as vscode from 'vscode'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { fetchW3cReferences } from '../../../src/w3c-references'
import { readMindCards } from '../../../src/mindcards'
import { builderRequestSchema } from '../../../src/product-builder-model'
import { readBuilderSources } from '../../../src/product-builder'
import { ensureLocalModel, LOCAL_MODEL_REVISION } from '../../../src/local-model'
import { hasErrorCode } from '../../../src/model'

const extensionPointId = 'skillvortex.skillvortex-extension'
const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('loadMindCards') }),
  z.object({ type: z.literal('cancelBuilder') }),
  z.object({ type: z.literal('prepareBuilder'), requestId: z.string().uuid(), ...builderRequestSchema.shape }),
  z.object({ type: z.literal('openBuilderSkill'), title: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(100000) })
])

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ProductBuilder')
  context.subscriptions.push(output)
  let panel: vscode.WebviewPanel | undefined
  let root: string | undefined
  let builderDownload: AbortController | undefined
  let queue = Promise.resolve()

  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    output.appendLine(message)
    void vscode.window.showErrorMessage(`ProductBuilder: ${message}`)
    void panel?.webview.postMessage({ type: 'error', root, message })
  }
  const run = (action: () => Promise<void>): Promise<void> => {
    queue = queue.then(action).catch(report)
    return queue
  }
  const standaloneRoot = async (): Promise<string> => {
    const configuration = vscode.workspace.getConfiguration('skillVortex')
    const saved = configuration.get<string>('vaultPath') || context.globalState.get<string>('root')
    if (saved) {
      try {
        const canonical = await fs.realpath(saved)
        if ((await fs.stat(canonical)).isDirectory()) return canonical
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
      }
      await configuration.update('vaultPath', undefined, vscode.ConfigurationTarget.Global)
      await context.globalState.update('root', undefined)
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file')?.uri.fsPath
    const choices = workspaceRoot
      ? await vscode.window.showQuickPick([
          { label: 'Usar pasta do workspace', description: workspaceRoot, path: workspaceRoot },
          { label: 'Escolher outra pasta...', path: '' }
        ], { placeHolder: 'Escolha a biblioteca que contem mindcards/' })
      : undefined
    const selected = choices?.path
      ? choices.path
      : (await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Selecionar biblioteca'
        }))?.[0]?.fsPath
    if (!selected) throw new Error('Selecione uma biblioteca para abrir o ProductBuilder.')
    const canonical = await fs.realpath(selected)
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('A pasta selecionada nao e um diretorio.')
    await configuration.update('vaultPath', canonical, vscode.ConfigurationTarget.Global)
    await context.globalState.update('root', canonical)
    return canonical
  }
  const openStandalone = async (): Promise<void> => {
    if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Use um workspace local e confiavel.')
    root = await standaloneRoot()
    if (panel) {
      panel.reveal()
      await panel.webview.postMessage({ type: 'standaloneRoot', root })
      return
    }
    panel = vscode.window.createWebviewPanel('productBuilder', 'ProductBuilder', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist/webview'),
        vscode.Uri.joinPath(context.globalStorageUri, 'builder-models')
      ]
    })
    const current = panel
    const nonce = randomBytes(24).toString('base64')
    const script = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/app.js'))
    const css = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/app.css'))
    const policy = `default-src 'none'; style-src ${current.webview.cspSource} 'unsafe-inline'; script-src ${current.webview.cspSource} blob: 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src ${current.webview.cspSource} blob:; connect-src ${current.webview.cspSource} blob:; font-src ${current.webview.cspSource} data:; img-src ${current.webview.cspSource} data:;`
    current.webview.html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><link rel="stylesheet" href="${css}"><title>ProductBuilder</title></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`
    current.onDidDispose(() => {
      builderDownload?.abort()
      if (panel === current) panel = undefined
    })
    current.webview.onDidReceiveMessage((raw: unknown) => {
      if (z.object({ type: z.literal('cancelBuilder') }).safeParse(raw).success) builderDownload?.abort()
    })
    current.webview.onDidReceiveMessage((raw: unknown) => run(async () => {
      if (z.object({ type: z.literal('ready') }).safeParse(raw).success) {
        await current.webview.postMessage({ type: 'standaloneRoot', root })
        return
      }
      const message = requestSchema.parse(raw)
      const activeRoot = root
      if (!activeRoot) throw new Error('Abra uma biblioteca antes de usar o ProductBuilder.')
      if (message.type === 'cancelBuilder') {
        builderDownload?.abort()
        builderDownload = undefined
        return
      }
      if (message.type === 'loadMindCards') {
        await current.webview.postMessage({ type: 'mindCards', root: activeRoot, state: await readMindCards(activeRoot) })
        return
      }
      if (message.type === 'openBuilderSkill') {
        const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: message.content })
        await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside)
        await current.webview.postMessage({ type: 'builderSkillOpened', root: activeRoot })
        await current.webview.postMessage({
          type: 'standaloneNotice', message: `Rascunho "${message.title}" aberto para revisao; ainda nao foi salvo.`
        })
        return
      }
      builderDownload = new AbortController()
      const signal = builderDownload.signal
      try {
        const sources = await readBuilderSources(activeRoot, message)
        if (message.useW3c) await current.webview.postMessage({
          type: 'builderProgress', root: activeRoot, requestId: message.requestId,
          message: 'Consultando documentos oficiais do W3C...'
        })
        const references = message.useW3c
          ? await fetchW3cReferences(message.objective, sources, signal)
          : []
        const modelRoot = vscode.Uri.joinPath(context.globalStorageUri, 'builder-models', LOCAL_MODEL_REVISION)
        await ensureLocalModel(join(modelRoot.fsPath, 'qwen'), signal, progress => {
          void current.webview.postMessage({ type: 'builderProgress', root: activeRoot, requestId: message.requestId, message: progress })
        })
        const runtimePath = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/onnx')).toString() + '/'
        const modelPath = current.webview.asWebviewUri(modelRoot).toString() + '/'
        await current.webview.postMessage({
          type: 'builderSources', root: activeRoot, requestId: message.requestId, sources, references,
          referenceNotice: message.useW3c && !references.length
            ? 'Nenhum documento do catalogo W3C corresponde ao tema. Nenhuma consulta W3C foi feita.'
            : '',
          runtimePath, modelPath
        })
      } catch (error) {
        if (signal.aborted) {
          await current.webview.postMessage({
            type: 'builderError', root: activeRoot, requestId: message.requestId, message: 'Geracao cancelada.'
          })
          return
        }
        const detail = error instanceof Error ? error.message : String(error)
        output.appendLine(`ProductBuilder: ${detail}`)
        await current.webview.postMessage({ type: 'builderError', root: activeRoot, requestId: message.requestId, message: detail })
      } finally {
        builderDownload = undefined
      }
    }))
  }
  context.subscriptions.push(vscode.commands.registerCommand('productBuilder.open', async () => {
    const skillVortex = vscode.extensions.getExtension(extensionPointId)
    if (skillVortex) {
      await skillVortex.activate()
      await vscode.commands.executeCommand('skillVortex.openArea', 'builder')
      return
    }
    await openStandalone()
  }))
}
