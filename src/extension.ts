import * as vscode from 'vscode'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { createVault, readVault, readContained, saveVaultData, writeSkillFile } from './vault'
import { initializeSql, migrateDesktop, rebuildIndex } from './database'
import { hasErrorCode, skillSchema } from './model'
import { readProjectMarkdown, scanProjectMarkdown } from './project-scan'

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('refresh') }),
  z.object({ type: z.literal('openSkill'), id: z.string() }),
  z.object({ type: z.literal('backToDashboard') }),
  z.object({ type: z.literal('createVault') }),
  z.object({ type: z.literal('openVault') }),
  z.object({ type: z.literal('migrateDesktop') }),
  z.object({ type: z.literal('createSkill') }),
  z.object({ type: z.literal('importMarkdown') }),
  z.object({ type: z.literal('createCategory'), name: z.string() }),
  z.object({ type: z.literal('createProject'), name: z.string() }),
  z.object({ type: z.literal('setProjectFolder') }),
  z.object({ type: z.literal('scanProject') }),
  z.object({ type: z.literal('setActiveProject'), id: z.string().nullable() }),
  z.object({ type: z.literal('toggleProjectSkill'), id: z.string() }),
  z.object({
    type: z.literal('saveSkill'), id: z.string(),
    name: z.string().trim().min(1).max(100),
    category: z.string().trim().min(1).max(60),
    description: z.string().max(1000),
    tags: z.array(z.string().trim().min(1).max(60)).max(100),
    agents: z.array(z.string().trim().min(1).max(60)).max(20),
    status: z.enum(['validated', 'pending', 'blocked']),
    content: z.string().max(2 * 1024 * 1024),
    projectIds: z.array(z.string()).max(10000)
  }),
  z.object({ type: z.literal('unlinkSkill'), id: z.string() }),
  z.object({ type: z.literal('deleteSkill'), id: z.string() })
])

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('SkillVortex')
  context.subscriptions.push(output)
  const sql = () => initializeSql(context.asAbsolutePath('dist/sql-wasm.wasm'))
  let panel: vscode.WebviewPanel | undefined
  let editingSkillId: string | null = null
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
  async function refresh(saved = false): Promise<void> {
    const root = context.globalState.get<string>('vaultPath')
    if (!root) {
      await panel?.webview.postMessage({
        type: 'state', root: null, catalog: null, projects: null,
        editingSkillId: null, content: '', saved
      })
      return
    }
    const canonical = await fs.realpath(root)
    const data = await readVault(canonical)
    await rebuildIndex(await sql(), context.globalStorageUri.fsPath, canonical, data)
    const skill = editingSkillId
      ? data.catalog.skills.find(item => item.id === editingSkillId)
      : undefined
    const content = skill ? await readContained(canonical, join(canonical, skill.filePath)) : ''
    if (editingSkillId && !skill) editingSkillId = null
    await panel?.webview.postMessage({
      type: 'state', root: canonical, ...data, editingSkillId, content, saved
    })
  }
  async function currentVault(): Promise<{ root: string; data: Awaited<ReturnType<typeof readVault>> }> {
    const selected = context.globalState.get<string>('vaultPath')
    if (!selected) throw new Error('Crie ou abra um cofre primeiro.')
    const root = await fs.realpath(selected)
    return { root, data: await readVault(root) }
  }
  async function persist(root: string, data: Awaited<ReturnType<typeof readVault>>): Promise<void> {
    await saveVaultData(root, data)
  }
  async function createSkill(): Promise<void> {
    const { root, data } = await currentVault()
    const category = data.catalog.categories.includes('Geral')
      ? 'Geral' : data.catalog.categories[0] ?? 'Geral'
    if (!data.catalog.categories.includes(category)) data.catalog.categories.push(category)
    const id = randomBytes(16).toString('hex')
    const skill = {
      id, name: 'Nova Skill', category,
      description: '', filePath: `skills/${randomBytes(16).toString('hex')}.md`,
      agents: [], status: 'pending' as const, tags: []
    }
    data.catalog.skills.push(skill)
    await writeSkillFile(root, skill.filePath, '# Nova Skill\n\n')
    await persist(root, data)
    editingSkillId = id
    await refresh()
  }
  async function importMarkdown(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
      filters: { Markdown: ['md'] }, openLabel: 'Importar Markdown'
    })
    if (!selected?.length) return
    await importFiles(selected.map(file => file.fsPath))
  }
  async function importFiles(filePaths: string[], projectRoot?: string): Promise<void> {
    const { root, data } = await currentVault()
    const existingPaths = new Set(data.catalog.skills
      .map(item => item.originPath)
      .filter((path): path is string => Boolean(path))
      .map(path => resolve(path)))
    const uniqueFiles: string[] = []
    for (const filePath of filePaths) {
      const canonical = await fs.realpath(filePath)
      if (!existingPaths.has(resolve(canonical)) && !uniqueFiles.includes(canonical)) {
        uniqueFiles.push(canonical)
      }
    }
    if (!uniqueFiles.length) {
      void vscode.window.showInformationMessage('Os arquivos selecionados ja estao na biblioteca.')
      return
    }
    if (data.catalog.skills.length + uniqueFiles.length > 10000) {
      throw new Error('O catalogo nao pode ultrapassar 10.000 skills.')
    }
    const category = data.catalog.categories.includes('Geral')
      ? 'Geral' : data.catalog.categories[0] ?? 'Geral'
    if (!data.catalog.categories.includes(category)) data.catalog.categories.push(category)
    const imported: Array<{ skill: z.infer<typeof skillSchema>; content: string }> = []
    for (const filePath of uniqueFiles) {
      if (!projectRoot) {
        const stat = await fs.stat(filePath)
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
          throw new Error(`O arquivo precisa ser Markdown e ter no maximo 2 MB: ${filePath}`)
        }
      }
      const content = projectRoot
        ? await readProjectMarkdown(projectRoot, filePath)
        : await fs.readFile(filePath, 'utf8')
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) {
        throw new Error(`Markdown excede o limite de 2 MB: ${filePath}`)
      }
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(filePath, '.md')
      const description = content.split(/\r?\n/).map(line => line.trim())
        .find(line => line && !line.startsWith('#'))?.slice(0, 1000) ?? ''
      imported.push({
        skill: {
          id: randomBytes(16).toString('hex'), name: title.slice(0, 100) || 'Markdown importado',
          category, description, filePath: `skills/${randomBytes(16).toString('hex')}.md`,
          originPath: filePath, agents: [], status: 'pending', tags: []
        },
        content
      })
    }
    const written: string[] = []
    try {
      for (const item of imported) {
        await writeSkillFile(root, item.skill.filePath, item.content)
        written.push(join(root, item.skill.filePath))
        data.catalog.skills.push(item.skill)
      }
    } catch (error) {
      const cleanupErrors: unknown[] = []
      for (const file of written.reverse()) {
        try {
          await fs.unlink(file)
        } catch (cleanupError) {
          if (!hasErrorCode(cleanupError, 'ENOENT')) cleanupErrors.push(cleanupError)
        }
      }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'A importacao falhou e nem todos os arquivos temporarios puderam ser removidos.')
      }
      throw error
    }
    await persist(root, data)
    editingSkillId = imported[0].skill.id
    await refresh()
  }
  async function setProjectFolder(): Promise<void> {
    const { root, data } = await currentVault()
    const project = data.projects.projects.find(item => item.id === data.projects.activeProject)
    if (!project) throw new Error('Crie ou selecione um projeto antes de associar uma pasta.')
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: project.sourcePath ? vscode.Uri.file(project.sourcePath) : undefined,
      openLabel: 'Associar pasta ao projeto'
    })
    if (!selected?.[0]) return
    const sourcePath = await fs.realpath(selected[0].fsPath)
    let duplicate: typeof project | undefined
    for (const item of data.projects.projects) {
      if (item.id === project.id || !item.sourcePath) continue
      try {
        if (await fs.realpath(item.sourcePath) === sourcePath) {
          duplicate = item
          break
        }
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
      }
    }
    if (duplicate) throw new Error(`Esta pasta ja esta associada ao projeto ${duplicate.name}.`)
    project.sourcePath = sourcePath
    await persist(root, data)
    await refresh()
  }
  async function scanActiveProject(): Promise<void> {
    const { root, data } = await currentVault()
    const project = data.projects.projects.find(item => item.id === data.projects.activeProject)
    if (!project) throw new Error('Crie ou selecione um projeto antes de buscar Markdown.')
    if (!project.sourcePath) throw new Error('Associe uma pasta ao projeto antes de buscar Markdown.')
    const files = await scanProjectMarkdown(project.sourcePath)
    if (!files.length) {
      void vscode.window.showInformationMessage('Nenhum arquivo Markdown encontrado para importar.')
      return
    }
    const existing = new Set(data.catalog.skills.map(item => item.originPath)
      .filter((path): path is string => Boolean(path))
      .map(path => resolve(path)))
    const selected = await vscode.window.showQuickPick(files.map(file => ({
      label: basename(file),
      description: relative(project.sourcePath!, file),
      detail: existing.has(resolve(file)) ? 'Ja importado na biblioteca' : file,
      picked: !existing.has(resolve(file)),
      file
    })), {
      canPickMany: true,
      placeHolder: `Selecione Markdown para importar (${files.length} encontrados; README excluidos)`
    })
    if (!selected?.length) return
    const fresh = selected.filter(item => !existing.has(resolve(item.file)))
    if (!fresh.length) {
      void vscode.window.showInformationMessage('Os arquivos selecionados ja estao na biblioteca.')
      return
    }
    await importFiles(fresh.map(item => item.file), project.sourcePath)
    void vscode.window.showInformationMessage(`${fresh.length} Markdown importado(s) de ${project.name}.`)
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
    current.webview.html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${current.webview.cspSource} 'unsafe-inline'; script-src ${current.webview.cspSource} 'nonce-${nonce}'; worker-src ${current.webview.cspSource} blob:; font-src ${current.webview.cspSource} data:; img-src ${current.webview.cspSource} data:;"><link rel="stylesheet" href="${css}"><title>SkillVortex</title></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`
    context.subscriptions.push(current.onDidDispose(() => { if (panel === current) panel = undefined }))
    context.subscriptions.push(current.webview.onDidReceiveMessage((raw: unknown) => run(async () => {
      const message = messageSchema.parse(raw)
      if (message.type === 'ready' || message.type === 'refresh') await refresh()
      if (message.type === 'createVault') await create()
      if (message.type === 'openVault') await openVault()
      if (message.type === 'migrateDesktop') await migrate()
      if (message.type === 'backToDashboard') {
        editingSkillId = null
        await refresh()
      }
      if (message.type === 'createSkill') await createSkill()
      if (message.type === 'importMarkdown') await importMarkdown()
      if (message.type === 'setProjectFolder') await setProjectFolder()
      if (message.type === 'scanProject') await scanActiveProject()
      if (message.type === 'createCategory') {
        const { root, data } = await currentVault()
        const name = message.name.trim()
        if (!name || name.length > 60) throw new Error('A categoria deve ter de 1 a 60 caracteres.')
        if (data.catalog.categories.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          throw new Error('Essa categoria ja existe.')
        }
        data.catalog.categories.push(name)
        await persist(root, data)
        await refresh()
      }
      if (message.type === 'createProject') {
        const { root, data } = await currentVault()
        const name = message.name.trim()
        if (!name || name.length > 60) throw new Error('O projeto deve ter de 1 a 60 caracteres.')
        if (data.projects.projects.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          throw new Error('Ja existe um projeto com esse nome.')
        }
        const project = { id: randomBytes(16).toString('hex'), name, skillIds: [] }
        data.projects.projects.push(project)
        data.projects.activeProject = project.id
        await persist(root, data)
        await refresh()
      }
      if (message.type === 'setActiveProject') {
        const { root, data } = await currentVault()
        if (message.id !== null && !data.projects.projects.some(item => item.id === message.id)) {
          throw new Error('Projeto nao encontrado.')
        }
        data.projects.activeProject = message.id
        await persist(root, data)
        await refresh()
      }
      if (message.type === 'toggleProjectSkill') {
        const { root, data } = await currentVault()
        const skill = data.catalog.skills.find(item => item.id === message.id)
        const project = data.projects.projects.find(item => item.id === data.projects.activeProject)
        if (!skill || !project) throw new Error('Selecione um projeto e uma skill validos.')
        if (skill.status === 'blocked') throw new Error('Skills bloqueadas nao podem ser vinculadas.')
        project.skillIds = project.skillIds.includes(skill.id)
          ? project.skillIds.filter(id => id !== skill.id)
          : [...project.skillIds, skill.id]
        await persist(root, data)
        await refresh()
      }
      if (message.type === 'saveSkill') {
        const { root, data } = await currentVault()
        if (Buffer.byteLength(message.content) > 2 * 1024 * 1024) {
          throw new Error('O Markdown excede o limite de 2 MB.')
        }
        const index = data.catalog.skills.findIndex(item => item.id === message.id)
        if (index < 0) throw new Error('Skill nao encontrada.')
        if (!data.catalog.categories.includes(message.category)) throw new Error('Categoria nao encontrada.')
        const projects = new Set(data.projects.projects.map(project => project.id))
        if (message.projectIds.some(id => !projects.has(id))) throw new Error('Projeto nao encontrado.')
        const current = data.catalog.skills[index]
        const updated = skillSchema.parse({
          ...current,
          name: message.name,
          category: message.category,
          description: message.description,
          tags: [...new Set(message.tags.map(tag => tag.trim()).filter(Boolean))],
          agents: [...new Set(message.agents.map(agent => agent.trim()).filter(Boolean))],
          status: message.status
        })
        data.catalog.skills[index] = updated
        const linked = new Set(message.projectIds)
        for (const project of data.projects.projects) {
          project.skillIds = project.skillIds.filter(id => id !== updated.id)
          if (updated.status !== 'blocked' && linked.has(project.id)) project.skillIds.push(updated.id)
        }
        await writeSkillFile(root, updated.filePath, message.content)
        await persist(root, data)
        editingSkillId = updated.id
        await refresh(true)
      }
      if (message.type === 'unlinkSkill' || message.type === 'deleteSkill') {
        const { root, data } = await currentVault()
        const skill = data.catalog.skills.find(item => item.id === message.id)
        if (!skill) throw new Error('Skill nao encontrada.')
        const deleting = message.type === 'deleteSkill'
        const confirmation = await vscode.window.showWarningMessage(
          deleting
            ? `Excluir permanentemente o Markdown ${join(root, skill.filePath)}?`
            : `Desvincular ${skill.name} da biblioteca? O arquivo sera preservado.`,
          { modal: true }, deleting ? 'Excluir arquivo' : 'Desvincular'
        )
        if (!confirmation) return
        if (deleting) await readContained(root, join(root, skill.filePath))
        data.catalog.skills = data.catalog.skills.filter(item => item.id !== skill.id)
        for (const project of data.projects.projects) {
          project.skillIds = project.skillIds.filter(id => id !== skill.id)
        }
        await persist(root, data)
        if (deleting) {
          await fs.unlink(join(root, skill.filePath))
        }
        if (editingSkillId === skill.id) editingSkillId = null
        await refresh()
      }
      if (message.type === 'openSkill') {
        const { data } = await currentVault()
        if (!data.catalog.skills.some(item => item.id === message.id)) throw new Error('Skill nao encontrada.')
        editingSkillId = message.id
        await refresh()
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
