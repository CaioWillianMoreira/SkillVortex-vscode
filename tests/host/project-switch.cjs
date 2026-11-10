const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const vscode = require('vscode')

async function testProjectSwitch(extension) {
  const { createVault, readVault, saveVaultData, writeSkillFile } = require(join(extension.extensionPath, 'dist/vault.js'))
  const { projectBindings, setProjectBindings, isCollectionLinked, setCollectionLinked, selectedSkillIds } =
    require(join(extension.extensionPath, 'dist/model.js'))
  const { saveProjectSkills } = require(join(extension.extensionPath, 'dist/project-skills.js'))
  const temporary = await mkdtemp(join(tmpdir(), 'skillvortex-switch-'))
  const root = join(temporary, 'vault')
  const projectPath = join(temporary, 'project')
  let panel
  let listener
  let timeout
  try {
    await mkdir(projectPath)
    await createVault(root)
    const data = await readVault(root)
    const agents = ['GitHub Copilot', 'Antigravity']
    for (const id of ['first', 'second']) {
      data.catalog.skills.push({
        id, name: id, category: 'Geral', description: 'Switch regression test',
        filePath: `skills/${id}.md`, agents, tags: ['test'], status: 'allowed'
      })
      await writeSkillFile(root, `skills/${id}.md`, `# ${id}\n`)
    }

    data.catalog.collections = data.catalog.skills.map(skill => ({
      id: `${skill.id}-card`, name: `${skill.name} card`, skillIds: [skill.id], agents
    }))
    data.projects.activeProject = 'project'
    data.projects.projects = [{
      id: 'project', name: 'Project', sourcePath: projectPath, sharedPublication: true,
      skillIds: ['first', 'second'],
      agentBindings: data.catalog.skills.flatMap(skill => agents.map(agent => ({ skillId: skill.id, agent })))
    }]
    await saveProjectSkills(root, await readVault(root), data)
    panel = vscode.window.createWebviewPanel('projectSwitchTest', 'Project switch test', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
    })
    const { webview } = panel
    const state = async () => ({
      type: 'state', root, ...await readVault(root), editingSkillId: null, content: ''
    })
    const steps = [
      { id: 'first-card', enabled: false, selection: 'first' },
      { id: 'first-card', enabled: false },
      { id: 'first-card', enabled: true },
      { id: 'first-card', enabled: true, selection: 'first' },
      { id: 'second-card', enabled: false },
      { id: 'first-card', enabled: false }
    ]
    let index = 0
    const result = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out clicking project switches in the webview')), 15000)
      listener = webview.onDidReceiveMessage(async message => {
        try {
          if (message.type === 'ready') {
            await webview.postMessage(await state())
            await webview.postMessage({ type: 'switch-test-step', ...steps[index] })
          } else if (message.type === 'toggleCollection' || message.type === 'setCollectionSkillEnabled') {
            const step = steps[index]
            assert.deepEqual(message, step.selection
              ? { type: 'setCollectionSkillEnabled', id: step.id, skillId: step.selection, enabled: step.enabled, agents }
              : { type: 'toggleCollection', ...step, agents })
            const before = await readVault(root)
            const next = structuredClone(before)
            const collection = next.catalog.collections.find(card => card.id === step.id)
            const project = next.projects.projects[0]
            const active = step.selection ? agents.some(agent => isCollectionLinked(project, collection, agent)) : step.enabled
            if (step.selection) {
              collection.disabledSkillIds = step.enabled ? [] : [step.selection]
            }
            const bindings = projectBindings(project).filter(binding => !collection.skillIds.includes(binding.skillId))
            for (const agent of agents) {
              setCollectionLinked(project, collection.id, agent, active)
              if (active) for (const skillId of selectedSkillIds(collection)) bindings.push({ skillId, agent })
            }
            setProjectBindings(project, bindings)
            await saveProjectSkills(root, before, next, saveVaultData)
            for (const folder of ['.github', '.agents']) {
              const file = join(projectPath, folder, 'skills', collection.skillIds[0], 'SKILL.md')
              if (active && !collection.disabledSkillIds?.includes(collection.skillIds[0])) {
                assert.match(await readFile(file, 'utf8'), /Switch regression test/)
              }
              else await assert.rejects(readFile(file), { code: 'ENOENT' })
            }
            if (collection.id === 'first-card') {
              for (const folder of ['.github', '.agents']) {
                const file = join(projectPath, folder, 'skills/second/SKILL.md')
                if (project.skillIds.includes('second')) assert.match(await readFile(file, 'utf8'), /Switch regression test/)
                else await assert.rejects(readFile(file), { code: 'ENOENT' })
              }
            }
            await webview.postMessage(await state())
            await webview.postMessage({ type: 'switch-test-check', ...step })
          } else if (message.type === 'switch-test-checked') {
            assert.equal(message.enabled, steps[index].enabled)
            if (++index === steps.length) resolve()
            else await webview.postMessage({ type: 'switch-test-step', ...steps[index] })
          } else if (message.type === 'switch-test-error') {
            reject(new Error(message.message))
          }
        } catch (error) {
          reject(error)
        }
      })
    })
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview/app.js'))
    const css = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview/app.css'))
    webview.html = `<!doctype html><html><head>
      <meta charset="UTF-8"><link rel="stylesheet" href="${css}">
      </head><body><div id="root"></div><script>
        const bridge = acquireVsCodeApi();
        window.acquireVsCodeApi = () => bridge;
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.type !== 'switch-test-step' && message.type !== 'switch-test-check') return;
          let attempts = 0;
          const timer = setInterval(() => {
            const name = message.id.replace('-card', ' card');
            const selector = message.selection
              ? '[aria-label="Habilitar ' + message.selection + ' no card ' + name + '"]'
              : '[aria-label="Usar ' + name + ' no projeto"]';
            const toggle = document.querySelector(selector);
            const checked = toggle && (message.selection ? String(toggle.checked) : toggle.getAttribute('aria-checked'));
            if (toggle && !toggle.disabled && checked ===
                String(message.type === 'switch-test-check' ? message.enabled : !message.enabled)) {
              clearInterval(timer);
              if (message.type === 'switch-test-step') toggle.click();
              else bridge.postMessage({ type: 'switch-test-checked', enabled: message.enabled });
            } else if (++attempts > 100) {
              clearInterval(timer);
              bridge.postMessage({ type: 'switch-test-error', message: 'Project switch did not become clickable or change state: ' + message.id });
            }
          }, 30);
        });
      </script><script type="module" src="${script}"></script></body></html>`
    await result
  } finally {
    clearTimeout(timeout)
    listener?.dispose()
    panel?.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
}

exports.testProjectSwitch = testProjectSwitch
exports.run = async () => {
  const extension = vscode.extensions.getExtension('skillvortex.skillvortex-extension')
  assert.ok(extension)
  await extension.activate()
  await testProjectSwitch(extension)
  console.log('SkillVortex: two-agent card switches publish, disable and reactivate in the VS Code webview')
}
