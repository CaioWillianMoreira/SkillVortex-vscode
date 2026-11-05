import * as vscode from 'vscode'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { createVault, readVault, readContained, saveVaultData, writeSkillFile } from './vault'
import { initializeSql, migrateDesktop, rebuildIndex } from './database'
import {
  agentSkillKey, deploymentAgent, deploymentRoot, hasErrorCode, isAgentLinked, projectBindings,
  setProjectBindings, skillAgentSchema, skillRegistrationSchema, skillSchema, uniqueSkillFilePath
} from './model'
import type { SkillAgent } from './model'
import { projectMarkdownAgent, readProjectMarkdown, scanProjectMarkdown } from './project-scan'
import { createVaultBackup, listVaultBackups, restoreVaultBackup } from './backup'
import { createDocumentedExamples, reconcileDocumentedExamples } from './documented-examples'
import { saveProjectSkills } from './project-skills'
import { assertSkillInactive, deleteSkillFiles, planSkillDeletion } from './skill-deletion'
import type { SkillCardColor } from './skill-colors'

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('refresh') }),
  z.object({ type: z.literal('openSkill'), id: z.string() }),
  z.object({ type: z.literal('backToDashboard') }),
  z.object({ type: z.literal('createVault') }),
  z.object({ type: z.literal('openVault') }),
  z.object({ type: z.literal('migrateDesktop') }),
  z.object({ type: z.literal('createBackup') }),
  z.object({ type: z.literal('restoreBackup') }),
  z.object({ type: z.literal('createSkill'), cardColor: skillSchema.shape.cardColor.nullable() }),
  z.object({ type: z.literal('createDocumentedExamples') }),
  z.object({ type: z.literal('importMarkdown') }),
  z.object({ type: z.literal('createCategory'), name: z.string() }),
  z.object({ type: z.literal('setProjectFolder') }),
  z.object({ type: z.literal('scanProject') }),
  z.object({ type: z.literal('setActiveProject'), id: z.string().nullable() }),
  z.object({ type: z.literal('toggleProjectSkill'), id: z.string(), agent: skillAgentSchema.optional() }),
  z.object({ type: z.literal('runSkill'), id: z.string(), agent: skillAgentSchema.optional() }),
  z.object({
    type: z.literal('saveSkill'), id: z.string(),
    ...skillRegistrationSchema.shape,
    cardColor: skillSchema.shape.cardColor.nullable(),
    projectIds: z.array(z.string()).max(10000)
  }),
  z.object({ type: z.literal('unlinkSkill'), id: z.string(), agent: skillAgentSchema.optional() }),
  z.object({ type: z.literal('deleteSkill'), id: z.string(), agent: skillAgentSchema.optional() })
])

async function availableSkillFilePath(
  root: string,
  name: string,
  existingPaths: Iterable<string>,
  keepPath?: string
): Promise<string> {
  const paths = [...existingPaths]
  while (true) {
    const filePath = uniqueSkillFilePath(name, paths)
    if (filePath === keepPath) return filePath
    try {
      await fs.lstat(join(root, filePath))
      paths.push(filePath)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      return filePath
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('SkillVortex')
  context.subscriptions.push(output)
  const openButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  openButton.text = '$(book) SkillVortex'
  openButton.tooltip = 'Abrir a biblioteca do SkillVortex'
  openButton.command = 'skillVortex.open'
  openButton.show()
  context.subscriptions.push(openButton)
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
  async function publishedMarkdownSkills(data: Awaited<ReturnType<typeof readVault>>): Promise<string[]> {
    const skillIds = new Set<string>()
    for (const project of data.projects.projects) {
      if (!project.sourcePath || !project.deployedSkills?.length) continue
      let projectPath: string
      try {
        projectPath = await fs.realpath(project.sourcePath)
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) continue
        throw error
      }
      for (const deployed of project.deployedSkills) {
        const markdown = join(projectPath, deploymentRoot(deployed), 'skills', deployed.directory, 'SKILL.md')
        try {
          const stat = await fs.lstat(markdown)
          if (stat.isFile() && !stat.isSymbolicLink()) {
            skillIds.add(deployed.skillId)
            skillIds.add(agentSkillKey(deployed.skillId, deploymentAgent(deployed)))
          }
        } catch (error) {
          if (!hasErrorCode(error, 'ENOENT') && !hasErrorCode(error, 'ENOTDIR')) throw error
        }
      }
    }
    return [...skillIds]
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
    let canonical: string
    try {
      canonical = await fs.realpath(root)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      await context.globalState.update('vaultPath', undefined)
      editingSkillId = null
      await panel?.webview.postMessage({
        type: 'state', root: null, catalog: null, projects: null,
        editingSkillId: null, content: '', saved
      })
      const message = 'A pasta do cofre salvo nao foi encontrada. Use “Abrir cofre” para escolher outra pasta ou “Criar cofre” para iniciar.'
      output.appendLine(`${message} Caminho anterior: ${root}`)
      await panel?.webview.postMessage({ type: 'error', message })
      return
    }
    let data: Awaited<ReturnType<typeof readVault>>
    try {
      data = await readVault(canonical)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      await context.globalState.update('vaultPath', undefined)
      editingSkillId = null
      await panel?.webview.postMessage({
        type: 'state', root: null, catalog: null, projects: null,
        editingSkillId: null, content: '', saved
      })
      const message = 'A pasta selecionada nao contem os arquivos de cofre esperados (.skillvortex/catalogo.json e projetos.json). Use “Abrir cofre” para escolher um cofre valido ou “Criar cofre” para iniciar.'
      output.appendLine(`${message} Caminho: ${canonical}`)
      await panel?.webview.postMessage({ type: 'error', message })
      return
    }
    await rebuildIndex(await sql(), context.globalStorageUri.fsPath, canonical, data)
    const skill = editingSkillId
      ? data.catalog.skills.find(item => item.id === editingSkillId)
      : undefined
    const content = skill ? await readContained(canonical, join(canonical, skill.filePath)) : ''
    if (editingSkillId && !skill) editingSkillId = null
    const activeProject = data.projects.projects.find(project => project.id === data.projects.activeProject)
    const projectPaths = activeProject?.sourcePath ? [activeProject.sourcePath]
      : (vscode.workspace.workspaceFolders ?? [])
        .filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath)
    const existingProjectPaths: string[] = []
    for (const path of projectPaths) {
      try {
        existingProjectPaths.push(await fs.realpath(path))
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
        output.appendLine(`Pasta de projeto nao encontrada ao verificar skills: ${path}`)
      }
    }
    await panel?.webview.postMessage({
      type: 'state', root: canonical, ...data, editingSkillId, content,
      hasProjectMarkdown: (await scanProjectMarkdown(existingProjectPaths)).length > 0,
      publishedMarkdown: await publishedMarkdownSkills(data), saved
    })
  }
  async function currentVault(): Promise<{ root: string; data: Awaited<ReturnType<typeof readVault>> }> {
    const selected = context.globalState.get<string>('vaultPath')
    if (!selected) throw new Error('Crie ou abra um cofre primeiro.')
    const root = await fs.realpath(selected)
    return { root, data: await readVault(root) }
  }
  async function persist(root: string, data: Awaited<ReturnType<typeof readVault>>, agent?: SkillAgent): Promise<void> {
    await saveProjectSkills(root, await readVault(root), data, saveVaultData, agent)
  }
  async function chooseProjectFolder(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 1 && folders[0].uri.scheme === 'file') {
      return fs.realpath(folders[0].uri.fsPath)
    }
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: 'Selecionar projeto para usar a skill'
    })
    return selected?.[0] ? fs.realpath(selected[0].fsPath) : undefined
  }
  async function createBackup(): Promise<void> {
    const { root } = await currentVault()
    const backup = await createVaultBackup(root)
    void vscode.window.showInformationMessage(
      `Backup criado: ${backup.id} (${backup.skills} skills, ${backup.projects} projetos).`
    )
  }
  async function restoreBackup(): Promise<void> {
    const { root } = await currentVault()
    const backups = await listVaultBackups(root)
    if (!backups.length) {
      void vscode.window.showInformationMessage('Este cofre ainda nao tem backups.')
      return
    }
    const selected = await vscode.window.showQuickPick(backups.map(backup => ({
      label: new Date(backup.createdAt).toLocaleString(),
      description: `${backup.skills} skills, ${backup.projects} projetos`,
      detail: backup.id,
      backup
    })), { placeHolder: 'Selecione um backup para restaurar' })
    if (!selected) return
    const confirmation = await vscode.window.showWarningMessage(
      `Restaurar o backup de ${new Date(selected.backup.createdAt).toLocaleString()}?`,
      {
        modal: true,
        detail: `${selected.backup.skills} skills e ${selected.backup.projects} projetos substituirão os metadados atuais. Arquivos que nao fizerem parte do backup serao preservados no disco. O estado atual sera salvo automaticamente como ponto de recuperacao.`
      },
      'Restaurar backup'
    )
    if (confirmation !== 'Restaurar backup') return
    const result = await restoreVaultBackup(root, selected.backup.id, persist)
    await refresh()
    if (result.warning) {
      void vscode.window.showWarningMessage(
        `${result.warning} Ponto de recuperacao: ${result.recoveryPoint.id}.`
      )
    } else {
      void vscode.window.showInformationMessage(
        `Backup restaurado. Ponto de recuperacao do estado anterior: ${result.recoveryPoint.id}.`
      )
    }
  }
  async function createSkill(cardColor?: SkillCardColor | null): Promise<void> {
    const { root, data } = await currentVault()
    const category = data.catalog.categories.includes('Geral')
      ? 'Geral' : data.catalog.categories[0] ?? 'Geral'
    if (!data.catalog.categories.includes(category)) data.catalog.categories.push(category)
    const id = randomBytes(16).toString('hex')
    const name = 'Nova Skill'
    const filePath = await availableSkillFilePath(root, name,
      data.catalog.skills.map(item => item.filePath))
    const skill = {
      id, name, category,
      description: 'Descreva o objetivo e quando usar esta skill.',
      filePath,
      agents: [], status: 'pending' as const, tags: [],
      ...(cardColor ? { cardColor } : {})
    }
    data.catalog.skills.push(skill)
    await writeSkillFile(root, skill.filePath, `# ${name}\n\n`)
    await persist(root, data)
    editingSkillId = id
    await refresh()
  }
  async function createExamples(): Promise<void> {
    const { root, data } = await currentVault()
    if (data.catalog.skills.length > 0) {
      throw new Error('Carregar exemplos so e permitido quando nao existe nenhum card na biblioteca.')
    }
    const examples = createDocumentedExamples()
    const { toCreate, updated, blockedSkillIds, orderedSkillIds } =
      reconcileDocumentedExamples(data.catalog.skills, examples)
    if (!toCreate.length && !updated) {
      void vscode.window.showInformationMessage('Os cards ja correspondem aos exemplos da documentacao.')
      return
    }
    if (data.catalog.skills.length + toCreate.length > 10000) {
      throw new Error('O catalogo nao pode ultrapassar 10.000 skills.')
    }
    const addedCategories = [...new Set(examples.map(({ skill }) => skill.category))]
      .filter(category => !data.catalog.categories.includes(category))
    data.catalog.categories.push(...addedCategories)
    const occupiedPaths = data.catalog.skills.map(skill => skill.filePath)
    for (const item of toCreate) {
      item.skill.filePath = await availableSkillFilePath(root, item.skill.name, occupiedPaths)
      occupiedPaths.push(item.skill.filePath)
    }
    const blockedIds = new Set(blockedSkillIds)
    for (const project of data.projects.projects) {
      project.skillIds = project.skillIds.filter(id => !blockedIds.has(id))
      if (project.agentBindings) project.agentBindings = project.agentBindings.filter(item => !blockedIds.has(item.skillId))
    }
    const written: string[] = []
    try {
      for (const { skill, content } of toCreate) {
        await writeSkillFile(root, skill.filePath, content)
        written.push(join(root, skill.filePath))
        data.catalog.skills.push(skill)
      }
      const skillsById = new Map(data.catalog.skills.map(skill => [skill.id, skill]))
      const exampleIds = new Set(orderedSkillIds)
      data.catalog.skills = [
        ...orderedSkillIds.flatMap(id => {
          const skill = skillsById.get(id)
          return skill ? [skill] : []
        }),
        ...data.catalog.skills.filter(skill => !exampleIds.has(skill.id))
      ]
      await persist(root, data)
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
        throw new AggregateError([error, ...cleanupErrors], 'A criacao dos exemplos falhou e nem todos os arquivos puderam ser removidos.')
      }
      throw error
    }
    await refresh()
    const messages = []
    if (toCreate.length) messages.push(`${toCreate.length} cards criados`)
    if (updated) messages.push(`${updated} cards atualizados`)
    void vscode.window.showInformationMessage(`${messages.join(' e ')} conforme a documentação.`)
  }
  async function importMarkdown(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
      filters: { Markdown: ['md'] }, openLabel: 'Importar Markdown'
    })
    if (!selected?.length) return
    await importFiles(selected.map(file => file.fsPath))
  }
  async function importFiles(filePaths: string[], projectRoots?: string[]): Promise<void> {
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
      if (!projectRoots) {
        const stat = await fs.stat(filePath)
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
          throw new Error(`O arquivo precisa ser Markdown e ter no maximo 2 MB: ${filePath}`)
        }
      }
      const content = projectRoots
        ? await readProjectMarkdown(projectRoots, filePath)
        : await fs.readFile(filePath, 'utf8')
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) {
        throw new Error(`Markdown excede o limite de 2 MB: ${filePath}`)
      }
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(filePath, '.md')
      const description = content.split(/\r?\n/).map(line => line.trim())
        .find(line => line && !line.startsWith('#'))?.slice(0, 1000) ||
        `Instrucoes para ${title.slice(0, 100)}.`
      const agentPath = filePath.replace(/\\/g, '/').match(/(?:^|\/)(\.(?:github|agents|agent)\/skills\/.+)$/)?.[1]
      const importedAgent = agentPath ? projectMarkdownAgent(agentPath) : undefined
      imported.push({
        skill: {
          id: randomBytes(16).toString('hex'), name: title.slice(0, 100) || 'Markdown importado',
          category, description,
          filePath: await availableSkillFilePath(root, title, [
            ...data.catalog.skills.map(item => item.filePath),
            ...imported.map(item => item.skill.filePath)
          ]),
          originPath: filePath,
          agents: importedAgent ? [importedAgent === 'Antigravity' ? 'Antigravity' : 'GitHub Copilot'] : [],
          status: 'pending', tags: []
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
    const projectRoot = await fs.realpath(project.sourcePath)
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
      .filter(folder => folder.uri.scheme === 'file')
      .map(folder => folder.uri.fsPath)
    const projectRoots = [...new Set([projectRoot, ...workspaceRoots])]
    const canonicalRoots = [...new Set(await Promise.all(projectRoots.map(path => fs.realpath(path))))]
    const files = await scanProjectMarkdown(canonicalRoots)
    if (!files.length) {
      void vscode.window.showInformationMessage(
        'Nenhum Markdown de skill encontrado nas pastas dos agentes do projeto ou dos workspaces abertos.'
      )
      return
    }
    const existing = new Set(data.catalog.skills.map(item => item.originPath)
      .filter((path): path is string => Boolean(path))
      .map(path => resolve(path)))
    const published = new Set((project.deployedSkills ?? []).map(item =>
      resolve(projectRoot, deploymentRoot(item), 'skills', item.directory, 'SKILL.md')))
    const selected = await vscode.window.showQuickPick(files.map(file => {
      const sourceRoot = canonicalRoots.find(root => {
        const path = relative(root, file)
        return path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
      })
      if (!sourceRoot) throw new Error(`A skill encontrada esta fora das pastas verificadas: ${file}`)
      const path = relative(sourceRoot, file)
      const note = existing.has(resolve(file)) ? 'Ja importado na biblioteca'
        : published.has(resolve(file)) ? 'Publicada pelo SkillVortex' : undefined
      return {
        label: basename(file),
        description: `${projectMarkdownAgent(path) ?? 'Agente'} · ${basename(sourceRoot)} / ${path}`,
        detail: note ?? file,
        picked: !note,
        file
      }
    }), {
      canPickMany: true,
      placeHolder: `Selecione skills nas pastas do projeto ou dos workspaces abertos (${files.length} encontrados)`
    })
    if (!selected?.length) return
    const fresh = selected.filter(item => !existing.has(resolve(item.file)))
    if (!fresh.length) {
      void vscode.window.showInformationMessage('Os arquivos selecionados ja estao na biblioteca.')
      return
    }
    await importFiles(fresh.map(item => item.file), canonicalRoots)
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
    current.webview.html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${current.webview.cspSource} 'unsafe-inline'; script-src ${current.webview.cspSource} 'nonce-${nonce}'; worker-src ${current.webview.cspSource} blob:; font-src ${current.webview.cspSource} data:; img-src ${current.webview.cspSource} data:;"><link rel="stylesheet" href="${css}"><title>SkillVortex</title></head><body><div id="runtime-fallback" role="status"><strong>Carregando SkillVortex...</strong><span>Se a tela nao abrir, verifique a extensao SkillVortex no painel Saida.</span><button id="reload-webview" type="button">Tentar novamente</button></div><div id="root"></div><script nonce="${nonce}">const fallback=document.getElementById('runtime-fallback');const showError=message=>{fallback.classList.add('has-error');fallback.querySelector('strong').textContent='Nao foi possivel carregar as telas do SkillVortex';fallback.querySelector('span').textContent=message||'Abra Exibir > Saida e selecione SkillVortex para consultar o erro.'};window.addEventListener('error',event=>showError(event.message));window.addEventListener('unhandledrejection',event=>showError(event.reason?.message||String(event.reason)));window.addEventListener('securitypolicyviolation',event=>showError('A politica de seguranca bloqueou um recurso: '+event.violatedDirective));document.getElementById('reload-webview').addEventListener('click',()=>location.reload());</script><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`
    context.subscriptions.push(current.onDidDispose(() => { if (panel === current) panel = undefined }))
    context.subscriptions.push(current.webview.onDidReceiveMessage((raw: unknown) => run(async () => {
      const message = messageSchema.parse(raw)
      if (message.type === 'ready' || message.type === 'refresh') await refresh()
      if (message.type === 'createVault') await create()
      if (message.type === 'openVault') await openVault()
      if (message.type === 'migrateDesktop') await migrate()
      if (message.type === 'createBackup') await createBackup()
      if (message.type === 'restoreBackup') await restoreBackup()
      if (message.type === 'backToDashboard') {
        editingSkillId = null
        await refresh()
      }
      if (message.type === 'createSkill') await createSkill(message.cardColor)
      if (message.type === 'createDocumentedExamples') await createExamples()
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
        if (!skill) throw new Error('Skill nao encontrada.')
        if (skill.status === 'blocked') throw new Error('Skills bloqueadas nao podem ser vinculadas.')
        if (message.agent && !skill.agents.includes(message.agent)) throw new Error('Agente nao associado a esta skill.')
        let project = data.projects.projects.find(item => item.id === data.projects.activeProject)
        const canRemoveLegacyLink = project?.skillIds.includes(skill.id) && !project.deployedSkills?.length
        if (!project?.sourcePath && !canRemoveLegacyLink) {
          const sourcePath = await chooseProjectFolder()
          if (!sourcePath) return
          if (!project) {
            project = data.projects.projects.find(item => item.sourcePath === sourcePath)
            if (!project) {
              let name = basename(sourcePath).slice(0, 60) || 'Projeto'
              let suffix = 1
              while (data.projects.projects.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
                name = `${basename(sourcePath).slice(0, 50)} (${suffix++})`
              }
              project = { id: randomBytes(16).toString('hex'), name, sourcePath, skillIds: [] }
              data.projects.projects.push(project)
            }
            data.projects.activeProject = project.id
          } else {
            if (data.projects.projects.some(item => item.id !== project?.id && item.sourcePath === sourcePath)) {
              throw new Error('Esta pasta ja esta associada a outro projeto. Selecione esse projeto.')
            }
            project.sourcePath = sourcePath
          }
        }
        if (!project) throw new Error('Projeto nao encontrado.')
        if (message.agent) {
          const agent = message.agent
          const bindings = projectBindings(project)
          setProjectBindings(project, isAgentLinked(project, skill.id, agent)
            ? bindings.filter(item => item.skillId !== skill.id || item.agent !== agent)
            : [...bindings, { skillId: skill.id, agent }])
        } else {
          project.skillIds = project.skillIds.includes(skill.id)
            ? project.skillIds.filter(id => id !== skill.id)
            : [...project.skillIds, skill.id]
          if (project.agentBindings) {
            const bindings = project.agentBindings.filter(item => project!.skillIds.includes(item.skillId))
            if (project.skillIds.includes(skill.id) && !bindings.some(item => item.skillId === skill.id)) {
              bindings.push({ skillId: skill.id, agent: 'GitHub Copilot' })
            }
            setProjectBindings(project, bindings)
          }
        }
        await persist(root, data, message.agent)
        await refresh()
      }
      if (message.type === 'runSkill') {
        if (message.agent === 'Antigravity') {
          throw new Error('A execucao automatica esta disponivel somente para GitHub Copilot. Use esta skill no Antigravity.')
        }
        const { data } = await currentVault()
        const project = data.projects.projects.find(item => item.id === data.projects.activeProject)
        if (!project?.sourcePath || !isAgentLinked(project, message.id, message.agent ?? 'GitHub Copilot')) {
          throw new Error('Ative a skill no projeto antes de executa-la.')
        }
        const deployed = project.deployedSkills?.find(item => item.skillId === message.id &&
          deploymentAgent(item) === (message.agent ?? 'GitHub Copilot'))
        if (!deployed) throw new Error('A skill ainda nao foi publicada no projeto.')
        const projectPath = await fs.realpath(project.sourcePath)
        const workspaceContainsProject = await Promise.all(
          (vscode.workspace.workspaceFolders ?? [])
            .filter(folder => folder.uri.scheme === 'file')
            .map(async folder => await fs.realpath(folder.uri.fsPath) === projectPath)
        )
        if (!workspaceContainsProject.includes(true)) {
          throw new Error('Abra no VS Code a pasta associada ao projeto antes de executar a skill.')
        }
        await vscode.commands.executeCommand('workbench.action.chat.open', {
          query: `/${deployed.directory} `,
          isPartialQuery: true
        })
      }
      if (message.type === 'saveSkill') {
        const { root, data } = await currentVault()
        if (Buffer.byteLength(message.content) > 2 * 1024 * 1024) {
          throw new Error('O Markdown excede o limite de 2 MB.')
        }
        const index = data.catalog.skills.findIndex(item => item.id === message.id)
        if (index < 0) throw new Error('Skill nao encontrada.')
        assertSkillInactive(data, message.id)
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
          status: message.status,
          cardColor: message.cardColor === null ? undefined : message.cardColor ?? current.cardColor
        })
        data.catalog.skills[index] = updated
        const linked = new Set(message.projectIds)
        if (updated.status !== 'blocked' && linked.size &&
            !skillAgentSchema.options.some(agent => updated.agents.includes(agent))) {
          throw new Error('Selecione GitHub Copilot ou Antigravity para publicar a skill no projeto.')
        }
        for (const project of data.projects.projects) {
          const bindings = projectBindings(project).filter(item => item.skillId !== updated.id)
          if (updated.status !== 'blocked' && linked.has(project.id)) {
            for (const agent of skillAgentSchema.options) {
              if (updated.agents.includes(agent)) bindings.push({ skillId: updated.id, agent })
            }
          }
          setProjectBindings(project, bindings)
        }
        for (const project of data.projects.projects) {
          if (project.skillIds.includes(updated.id) && !project.sourcePath) {
            throw new Error(`Associe uma pasta ao projeto ${project.name} no Dashboard antes de vincular a skill.`)
          }
        }
        const previousFilePath = current.filePath
        const previousContent = await readContained(root, join(root, previousFilePath))
        const nextFilePath = await availableSkillFilePath(
          root,
          updated.name,
          data.catalog.skills.filter(item => item.id !== updated.id).map(item => item.filePath),
          previousFilePath
        )
        updated.filePath = nextFilePath
        await writeSkillFile(root, nextFilePath, message.content)
        try {
          await persist(root, data)
        } catch (error) {
          try {
            if (nextFilePath === previousFilePath) {
              await writeSkillFile(root, previousFilePath, previousContent)
            } else {
              await fs.unlink(join(root, nextFilePath))
            }
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Falha ao salvar a skill e restaurar o Markdown do cofre.')
          }
          throw error
        }
        if (nextFilePath !== previousFilePath) await fs.unlink(join(root, previousFilePath))
        editingSkillId = data.projects.projects.some(project => project.skillIds.includes(updated.id))
          ? null : updated.id
        await refresh(true)
      }
      if (message.type === 'unlinkSkill' || message.type === 'deleteSkill') {
        const { root, data } = await currentVault()
        const skill = data.catalog.skills.find(item => item.id === message.id)
        if (!skill) throw new Error('Skill nao encontrada.')
        const deleting = message.type === 'deleteSkill'
        if (!message.agent && skillAgentSchema.options.filter(agent => skill.agents.includes(agent)).length > 1) {
          throw new Error('Escolha o card do agente para desvincular ou excluir. Recarregue a biblioteca se necessario.')
        }
        if (message.agent && !skill.agents.includes(message.agent)) throw new Error('Agente nao associado a esta skill.')
        if (deleting && !message.agent) assertSkillInactive(data, skill.id)
        const linkedProjects = data.projects.projects.filter(project => message.agent
          ? isAgentLinked(project, skill.id, message.agent) : project.skillIds.includes(skill.id))
        if (!deleting && linkedProjects.length &&
            !(await publishedMarkdownSkills(data)).includes(message.agent ? agentSkillKey(skill.id, message.agent) : skill.id)) {
          throw new Error('Nao existe um SKILL.md publicado para preservar no projeto.')
        }
        const plan = deleting ? await planSkillDeletion(root, data, skill, message.agent) : undefined
        const action = deleting ? 'Excluir permanentemente' : 'Desvincular'
        const confirmation = await vscode.window.showWarningMessage(
          deleting
            ? `Excluir permanentemente ${skill.name}${message.agent ? ` (${message.agent})` : ''}?`
            : `Desvincular ${skill.name}${message.agent ? ` (${message.agent})` : ''} da biblioteca? O arquivo sera preservado.`,
          {
            modal: true,
            detail: plan
              ? `Os seguintes arquivos e pastas serao apagados, incluindo todo o conteudo das pastas. As origens importadas serao preservadas:\n${[...(plan.deleteVault === false ? [] : [plan.vaultFile]), ...plan.archives, ...plan.folders].join('\n')}`
              : undefined
          }, action
        )
        if (confirmation !== action) return
        if (plan) {
          try {
            await deleteSkillFiles(root, plan, (path, next) => persist(path, next, message.agent))
          } catch (error) {
            try {
              await refresh()
            } catch (refreshError) {
              throw new AggregateError([error, refreshError], 'Falha ao excluir a skill e atualizar a biblioteca.')
            }
            throw error
          }
        } else {
          if (message.agent) {
            skill.agents = skill.agents.filter(agent => agent !== message.agent)
            skill.publishedFolders = skill.publishedFolders?.filter(item => deploymentAgent(item) !== message.agent)
          }
          if (!message.agent || !skill.agents.length) data.catalog.skills = data.catalog.skills.filter(item => item.id !== skill.id)
          for (const project of data.projects.projects) {
            setProjectBindings(project, projectBindings(project).filter(item =>
              item.skillId !== skill.id || Boolean(message.agent && item.agent !== message.agent)))
            project.deployedSkills = project.deployedSkills?.filter(item =>
              item.skillId !== skill.id || Boolean(message.agent && deploymentAgent(item) !== message.agent))
          }
          await saveVaultData(root, data)
        }
        if (editingSkillId === skill.id) editingSkillId = null
        await refresh()
      }
      if (message.type === 'openSkill') {
        const { data } = await currentVault()
        if (!data.catalog.skills.some(item => item.id === message.id)) throw new Error('Skill nao encontrada.')
        assertSkillInactive(data, message.id)
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
