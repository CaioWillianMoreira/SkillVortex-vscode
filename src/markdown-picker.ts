import * as vscode from 'vscode'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { skillDirectoriesForRoot } from './project-scan'

type FolderChoice = vscode.QuickPickItem & (
  { action: 'folder'; path: string } |
  { action: 'files' | 'path' }
)

export async function chooseMarkdownFiles(initialDirectory: string): Promise<string[] | undefined> {
  let directory = await fs.realpath(initialDirectory)
  const home = await fs.realpath(homedir())
  while (true) {
    const insideAgentFolder = directory.split(sep).some((part, index, parts) =>
      parts[index + 1]?.toLowerCase() === 'skills' &&
      skillDirectoriesForRoot(parts.slice(0, index).join(sep) || sep, home)
        .some(agent => agent.directory === part.toLowerCase()))
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const files = entries.filter(entry => entry.isFile() && /\.md$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
    const agentFolder = skillDirectoriesForRoot(dirname(directory), home)
      .some(agent => agent.directory === basename(directory).toLowerCase())
    const agentFolders = new Set<string>(skillDirectoriesForRoot(directory, home).map(agent => agent.directory))
    const folders = entries.filter(entry =>
      entry.isDirectory() && (insideAgentFolder || (agentFolder ? entry.name.toLowerCase() === 'skills'
        : agentFolders.has(entry.name.toLowerCase()))))
      .sort((left, right) => left.name.localeCompare(right.name))
    const choices: FolderChoice[] = [
      { label: '$(edit) Digitar caminho de outra pasta...', action: 'path' }
    ]
    if (insideAgentFolder && files.length) choices.push({
      label: `$(files) Selecionar arquivos .md desta pasta (${files.length})`,
      description: 'Escolha um ou varios arquivos para importar',
      action: 'files'
    })
    const parent = dirname(directory)
    if (parent !== directory) choices.push({
      label: '$(arrow-up) ..', description: 'Pasta superior', action: 'folder', path: parent
    })
    choices.push(...folders.map(entry => ({
      label: `$(folder) ${entry.name}`,
      description: agentFolders.has(entry.name.toLowerCase()) ? 'Pasta de agente' : undefined,
      action: 'folder' as const,
      path: join(directory, entry.name)
    })))
    const selected = await vscode.window.showQuickPick(choices, {
      title: `Importar .md - ${directory}`,
      placeHolder: insideAgentFolder
        ? 'Navegue pelas subpastas do agente ou selecione arquivos .md'
        : 'Skills: .github/skills, .agents/skills, .claude/skills, ~/.copilot/skills e ~/.claude/skills',
      matchOnDescription: true
    })
    if (!selected) return undefined
    if (selected.action === 'folder') {
      directory = await fs.realpath(selected.path)
    } else if (selected.action === 'path') {
      const path = await vscode.window.showInputBox({
        title: 'Abrir pasta para importar Markdown',
        prompt: 'Informe o caminho da pasta; pastas ocultas tambem sao aceitas.',
        value: directory
      })
      if (path === undefined) continue
      if (!path.trim()) throw new Error('Informe um caminho de pasta valido.')
      const destination = await fs.realpath(resolve(directory, path.trim()))
      if (!(await fs.stat(destination)).isDirectory()) throw new Error('O caminho informado nao e uma pasta.')
      directory = destination
    } else {
      const selectedFiles = await vscode.window.showQuickPick(files.map(entry => ({
        label: entry.name, path: join(directory, entry.name)
      })), {
        title: `Selecionar Markdown - ${directory}`,
        placeHolder: 'Marque os arquivos .md para importar; os originais serao preservados.',
        canPickMany: true
      })
      if (selectedFiles === undefined) continue
      return selectedFiles.length ? selectedFiles.map(file => file.path) : undefined
    }
  }
}
