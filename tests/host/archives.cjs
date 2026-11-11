const assert = require('node:assert/strict')
const { join } = require('node:path')
const vscode = require('vscode')

module.exports = async function testArchives(extension) {
  const { setCardArchived } = require(join(extension.extensionPath, 'dist/model.js'))
  const skill = (id, name) => ({
    id, name, category: 'Geral', description: 'Archive test', filePath: `skills/${id}.md`,
    agents: ['GitHub Copilot'], tags: [], status: 'allowed'
  })
  const data = {
    catalog: { version: 1, categories: ['Geral'], skills: [skill('one', 'Standalone'), skill('two', 'Member'), skill('active', 'Active')],
      collections: [{ id: 'group', name: 'Group', skillIds: ['two'], disabledSkillIds: ['two'] }] },
    projects: { version: 1, activeProject: 'project', projects: [{ id: 'project', name: 'Project', skillIds: ['active'] }] }
  }
  const panel = vscode.window.createWebviewPanel('archivesTest', 'Archives test', vscode.ViewColumn.One, {
    enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
  })
  const asset = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview', name))
  const publish = () => panel.webview.postMessage({ type: 'state', root: '/test-vault', ...data, editingSkillId: null, content: '' })
  let listener, timer
  let changes = 0
  try {
    const result = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out testing archived skill cards')), 45000)
      listener = panel.webview.onDidReceiveMessage(async message => {
        try {
          if (message.type === 'ready') {
            await publish()
            await panel.webview.postMessage({ type: 'archives-start' })
          } else if (message.type === 'archiveCard') {
            setCardArchived(data, message.kind, message.id, message.archived)
            changes++
            await publish()
          } else if (message.type === 'archives-done') {
            assert.equal(changes, 4)
            assert.deepEqual(data.catalog.collections[0].disabledSkillIds, ['two'])
            assert.deepEqual(data.projects.projects[0].skillIds, ['active'])
            resolve()
          } else if (message.type === 'archives-error') reject(new Error(message.message))
        } catch (error) { reject(error) }
      })
    })
    panel.webview.html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-archivesTest'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource};">
      <link rel="stylesheet" href="${asset('app.css')}"></head><body><div id="root"></div>
      <script nonce="archivesTest">
        const bridge = acquireVsCodeApi();
        window.acquireVsCodeApi = () => bridge;
        const wait = async (label, predicate) => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > 10000) throw new Error('Timed out: ' + label);
            await new Promise(resolve => setTimeout(resolve, 40));
          }
        };
        const button = text => Array.from(document.querySelectorAll('button')).find(item => item.textContent.trim() === text && !item.disabled);
        const card = name => Array.from(document.querySelectorAll('.skill-card')).find(item => item.querySelector('h5')?.textContent === name);
        window.addEventListener('message', async event => {
          if (event.data.type !== 'archives-start') return;
          try {
            await wait('chooser', () => button('Abrir SkillVortex'));
            button('Abrir SkillVortex').click();
            await wait('active card', () => card('Active'));
            if (!card('Standalone').querySelector('.skill-card-heading .card-archive-button[aria-label="Arquivar"]') ||
                card('Standalone').querySelector('.skill-card-actions .action-archive')) {
              throw new Error('Archive icon must be in the card header, not the footer');
            }
            if (!card('Active').querySelector('.action-archive').disabled) throw new Error('Active card must not archive');
            for (const name of ['Standalone', 'Group']) {
              card(name).querySelector('.action-archive').click();
              await wait('hidden ' + name, () => !card(name));
            }
            button('Arquivados').click();
            await wait('archive screen', () => card('Standalone') && card('Group'));
            if (card('Active') || document.querySelector('.skills-grid [role="switch"]')) throw new Error('Archive must not expose activation');
            for (const name of ['Standalone', 'Group']) {
              card(name).querySelector('.action-restore').click();
              await wait('restored ' + name, () => !card(name));
            }
            button('Voltar para cards').click();
            await wait('all cards restored', () => document.querySelectorAll('.skill-card').length === 3);
            bridge.postMessage({ type: 'archives-done' });
          } catch (error) { bridge.postMessage({ type: 'archives-error', message: error.message }); }
        });
      </script><script type="module" nonce="archivesTest" src="${asset('app.js')}"></script></body></html>`
    await result
    console.log('SkillVortex: standalone and collection archive/restore and active-card protection passed')
  } finally {
    clearTimeout(timer)
    listener?.dispose()
    panel.dispose()
  }
}
