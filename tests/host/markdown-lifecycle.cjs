const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, readdir, cp, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const vscode = require('vscode')

exports.testMarkdownLifecycle = async function testMarkdownLifecycle(extension) {
  const load = name => require(join(extension.extensionPath, `dist/${name}.js`))
  const { createVault, readVault, saveVaultData, writeSkillFile } = load('vault')
  const { createVaultBackup, restoreVaultBackup } = load('backup')
  const { detectExternalChanges, resolveExternalChange } = load('external-changes')
  const { setSharedSkillPublication } = load('model')
  const { saveProjectSkills } = load('project-skills')
  const { planSkillDeletion, deleteSkillFiles } = load('skill-deletion')
  const temporary = await mkdtemp(join(tmpdir(), 'skillvortex-editor-qa-'))
  const root = join(temporary, 'library')
  const persist = async (path, next) => saveProjectSkills(path, await readVault(path), next)
  const edit = async (path, content) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    await vscode.window.showTextDocument(document)
    const change = new vscode.WorkspaceEdit()
    change.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content)
    assert.equal(await vscode.workspace.applyEdit(change), true)
    assert.equal(await document.save(), true)
    assert.equal(await readFile(path, 'utf8'), content)
  }
  try {
    await createVault(root)
    const before = await readVault(root)
    before.catalog.skills = [{
      id: 'editor-qa', name: 'Editor QA', category: 'Geral', description: 'Manual editing regression',
      filePath: 'skills/editor-qa.md', agents: ['GitHub Copilot', 'Antigravity'],
      status: 'allowed', tags: ['qa']
    }]
    before.catalog.collections = [{
      id: 'qa-card', name: 'QA card', skillIds: ['editor-qa'], agents: ['GitHub Copilot', 'Antigravity']
    }]
    const library = join(root, 'skills/editor-qa.md')
    await writeSkillFile(root, 'skills/editor-qa.md', '# Original\n\nShared requirement.\n')
    for (const id of ['one', 'two']) {
      const sourcePath = join(temporary, id)
      await mkdir(sourcePath)
      before.projects.projects.push({ id, name: id, sourcePath, skillIds: [] })
    }
    before.projects.activeProject = 'one'
    await saveVaultData(root, before)
    const enabled = structuredClone(before)
    for (const project of enabled.projects.projects) setSharedSkillPublication(project, 'editor-qa', true)
    await saveProjectSkills(root, before, enabled)
    const files = enabled.projects.projects.flatMap(project =>
      ['.github', '.agents'].map(folder => join(project.sourcePath, folder, 'skills/editor-qa/SKILL.md')))
    const published = await readFile(files[0], 'utf8')
    await edit(files[0], `${published}\nProject-only requirement.\n`)
    await edit(library, '# Library revision\n\nLibrary-only requirement.\n')
    const [reviewed] = await detectExternalChanges(root, await readVault(root))
    assert.equal(reviewed.library.changed, true)
    assert.equal(reviewed.publications.filter(version => version.changed).length, 1)
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(files[0]), vscode.Uri.file(library), 'QA: manual merge')
    const merged = '# Manual merge\n\nShared requirement.\nProject-only requirement.\nLibrary-only requirement.\n'
    await edit(library, merged)
    await assert.rejects(resolveExternalChange(root, reviewed, library), /mudaram apos/)
    const [fresh] = await detectExternalChanges(root, await readVault(root))
    const recovery = await resolveExternalChange(root, fresh, library)
    const manifest = JSON.parse(await readFile(join(recovery, 'manifest.json'), 'utf8'))
    const projectSnapshot = manifest.find(entry => entry.path === fresh.publications.find(version =>
      version.projectId === 'one' && version.agent === 'GitHub Copilot').path)
    assert.match(await readFile(join(recovery, projectSnapshot.snapshot), 'utf8'), /Project-only requirement/)
    for (const file of files) assert.match(await readFile(file, 'utf8'), /Project-only requirement\.\nLibrary-only requirement/)
    assert.deepEqual(await detectExternalChanges(root, await readVault(root)), [])
    const backup = await createVaultBackup(root)
    await edit(library, '# Temporary replacement\n')
    const [changed] = await detectExternalChanges(root, await readVault(root))
    await resolveExternalChange(root, changed, library)
    await restoreVaultBackup(root, backup.id, persist)
    assert.equal(await readFile(library, 'utf8'), merged)
    assert.deepEqual(await detectExternalChanges(root, await readVault(root)), [])
    const disabled = await readVault(root)
    for (const project of disabled.projects.projects) setSharedSkillPublication(project, 'editor-qa', false)
    await persist(root, disabled)
    for (const file of files) await assert.rejects(readFile(file), { code: 'ENOENT' })
    const current = await readVault(root)
    const plan = await planSkillDeletion(root, current, current.catalog.skills[0])
    await deleteSkillFiles(root, plan, persist)
    assert.deepEqual((await readVault(root)).catalog.skills, [])
    assert.deepEqual(await readdir(join(root, 'skills')), [])
    const portable = join(temporary, 'portable')
    await cp(root, portable, { recursive: true })
    assert.deepEqual(await readVault(portable), await readVault(root))
    await rm(root, { recursive: true })
    await createVault(root)
    assert.deepEqual((await readVault(root)).catalog.skills, [])
    console.log('SkillVortex QA: real editor save, manual merge, two-project synchronization, recovery, deletion and library recreation passed')
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await rm(temporary, { recursive: true, force: true })
  }
}
