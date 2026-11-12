import * as vscode from 'vscode'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  createMindCardsExamples, deleteMindFolder, deleteMindNote, readMindCards, readMindNote,
  saveMindFolder, saveMindNote, setMindNoteArchived
} from '../../../src/mindcards'
import {
  mindFolderSchema, mindNoteInputSchema
} from '../../../src/mindcards-model'
import type { MindNoteDocument } from '../../../src/mindcards-model'
import { hasErrorCode } from '../../../src/model'

const extensionPointId = 'skillvortex.skillvortex-extension'
const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('loadMindCards') }),
  z.object({ type: z.literal('createMindCardsExamples') }),
  z.object({ type: z.literal('openMindNote'), id: z.string().uuid() }),
  z.object({ type: z.literal('saveMindFolder'), folder: mindFolderSchema, revision: z.string().nullable() }),
  z.object({ type: z.literal('deleteMindFolder'), id: z.string().uuid(), revision: z.string().nullable() }),
  z.object({ type: z.literal('saveMindNote'), value: mindNoteInputSchema, id: z.string().uuid().optional(), revision: z.string().optional() }),
  z.object({ type: z.literal('deleteMindNote'), id: z.string().uuid(), revision: z.string() }),
  z.object({ type: z.literal('archiveMindNote'), id: z.string().uuid(), revision: z.string(), archived: z.boolean() })
])

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('MindCards')
  context.subscriptions.push(output)
  let panel: vscode.WebviewPanel | undefined
  let root: string | undefined
  let queue = Promise.resolve()

  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    output.appendLine(message)
    void vscode.window.showErrorMessage(`MindCards: ${message}`)
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
    const choices = workspaceRoot ? [{ label: 'Usar pasta do workspace', path: workspaceRoot }] : []
    const choice = choices.length
      ? await vscode.window.showQuickPick([
          ...choices.map(item => ({ label: item.label, description: item.path, path: item.path })),
          { label: 'Escolher outra pasta...', path: '' }
        ], { placeHolder: 'Escolha a pasta que contem ou contera mindcards/' })
      : undefined
    const selected = choice?.path
      ? choice.path
      : (await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Selecionar pasta'
        }))?.[0]?.fsPath
    if (!selected) throw new Error('Selecione uma pasta para abrir o MindCards.')
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
    panel = vscode.window.createWebviewPanel('mindCards', 'MindCards', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist/webview')]
    })
    const current = panel
    const nonce = randomBytes(24).toString('base64')
    const script = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/app.js'))
    const css = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/webview/app.css'))
    const policy = `default-src 'none'; style-src ${current.webview.cspSource} 'unsafe-inline'; script-src ${current.webview.cspSource} 'nonce-${nonce}'; img-src ${current.webview.cspSource} data:; font-src ${current.webview.cspSource} data:;`
    current.webview.html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><link rel="stylesheet" href="${css}"><title>MindCards</title></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`
    current.onDidDispose(() => { if (panel === current) panel = undefined })
    current.webview.onDidReceiveMessage((raw: unknown) => run(async () => {
      if (z.object({ type: z.literal('ready') }).safeParse(raw).success) {
        await current.webview.postMessage({ type: 'standaloneRoot', root })
        return
      }
      const message = requestSchema.parse(raw)
      const activeRoot = root
      if (!activeRoot) throw new Error('Abra uma pasta antes de usar o MindCards.')
      if (message.type === 'openMindNote') {
        await current.webview.postMessage({
          type: 'mindNote', root: activeRoot, document: await readMindNote(activeRoot, message.id)
        })
        return
      }
      let document: MindNoteDocument | undefined
      if (message.type === 'createMindCardsExamples') await createMindCardsExamples(activeRoot)
      if (message.type === 'saveMindFolder') await saveMindFolder(activeRoot, message.folder, message.revision)
      if (message.type === 'deleteMindFolder') await deleteMindFolder(activeRoot, message.id, message.revision)
      if (message.type === 'saveMindNote') document = await saveMindNote(activeRoot, message.value, message.id, message.revision)
      if (message.type === 'deleteMindNote') await deleteMindNote(activeRoot, message.id, message.revision)
      if (message.type === 'archiveMindNote') {
        await setMindNoteArchived(activeRoot, message.id, message.revision, message.archived)
      }
      await current.webview.postMessage({
        type: 'mindCards', root: activeRoot, state: await readMindCards(activeRoot), document,
        saved: message.type === 'saveMindNote', deleted: message.type === 'deleteMindNote',
        notice: message.type === 'loadMindCards' ? undefined : 'Alteracoes salvas no MindCards.'
      })
    }))
  }
  context.subscriptions.push(vscode.commands.registerCommand('mindCards.open', async () => {
    const skillVortex = vscode.extensions.getExtension(extensionPointId)
    if (skillVortex) {
      await skillVortex.activate()
      await vscode.commands.executeCommand('skillVortex.openArea', 'mindcards')
      return
    }
    await openStandalone()
  }))
}
