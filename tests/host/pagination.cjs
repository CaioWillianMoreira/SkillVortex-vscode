const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const vscode = require('vscode')

async function testPanel(extension, standalone) {
  const panel = vscode.window.createWebviewPanel('paginationTest', 'Card pagination test', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
  })
  const { webview } = panel
  const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview', name))
  const folders = ['Pasta A', 'Pasta B'].map(name => ({ id: randomUUID(), name, color: '#1677ff' }))
  let root = '/pagination-vault'
  let notes
  let lastMessage = 'waiting for ready'
  let timeout
  let listener
  const result = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out testing ${standalone ? 'standalone' : 'integrated'} card pagination: ${lastMessage}`)), 60000)
    listener = webview.onDidReceiveMessage(async message => {
      lastMessage = `${message.type} ${message.request ?? ''}`
      try {
        if (message.type === 'ready') {
          await webview.postMessage({ type: 'pagination-start' })
        } else if (message.type === 'pagination-fixture') {
          root = message.root
          const items = (count, archived = false) => Array.from({ length: count }, (_, index) => {
            const number = index + 1
            const date = `2026-01-${String(number).padStart(2, '0')}T00:00:00.000Z`
            return {
              id: randomUUID(), name: `${archived ? 'Arquivado' : 'Card'} ${String(number).padStart(2, '0')}`,
              archived, category: 'Geral', description: 'Descricao de teste.', tags: [],
              status: 'allowed', agents: ['GitHub Copilot'], filePath: `skills/${index}.md`,
              title: `${archived ? 'Arquivado' : 'Card'} ${String(number).padStart(2, '0')}`,
              folderId: folders[number % 2 === 0 ? 0 : 1].id, links: [],
              createdAt: date, updatedAt: date, revision: date
            }
          })
          const entries = [...items(message.count), ...items(7, true)]
          notes = { folders, notes: entries, revision: String(message.request) }
          await webview.postMessage(standalone ? { type: 'standaloneRoot', root } : {
            type: 'state', root, editingSkillId: null, content: '',
            features: { mindCards: true, productBuilder: false },
            catalog: { version: 1, categories: ['Geral'], skills: entries },
            projects: { version: 1, activeProject: null, projects: [] }
          })
          await webview.postMessage({ type: 'mindCards', root, state: notes })
          await webview.postMessage({ type: 'pagination-fixture-ready', request: message.request })
        } else if (message.type === 'loadMindCards') {
          await webview.postMessage({ type: 'mindCards', root, state: notes })
        } else if (message.type === 'pagination-complete') {
          assert.deepEqual(message.apps, standalone ? ['mindcards'] : ['skills', 'mindcards'])
          resolve()
        } else if (message.type === 'pagination-error') {
          reject(new Error(`${standalone ? 'Standalone' : 'Integrated'} pagination: ${message.message}`))
        }
      } catch (error) { reject(error) }
    })
  })
  webview.html = `<!doctype html><html><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-paginationTest'; worker-src ${webview.cspSource} blob:; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;">
    <link rel="stylesheet" href="${asset('app.css')}"></head><body><div id="root"></div>
    <script nonce="paginationTest">
      const bridge = acquireVsCodeApi();
      globalThis.acquireVsCodeApi = () => bridge;
      window.addEventListener('error', event => bridge.postMessage({
        type: 'pagination-error', message: event.error?.stack ?? event.message
      }));
      window.addEventListener('unhandledrejection', event => bridge.postMessage({
        type: 'pagination-error', message: String(event.reason)
      }));
      const standalone = ${standalone};
      let request = 0;
      let acknowledged = 0;
      const wait = async (label, predicate) => {
        const start = Date.now();
        while (!predicate()) {
          if (Date.now() - start > 10000) throw new Error('Timed out: ' + label);
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      };
      const fixture = async (count, root = '/pagination-vault') => {
        bridge.postMessage({ type: 'pagination-fixture', count, root, request: ++request });
        await wait('fixture acknowledgement', () => acknowledged === request);
      };
      const setSearch = (label, value) => {
        const input = document.querySelector('input[aria-label="' + label + '"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const button = (scope, label) => Array.from(document.querySelectorAll(scope + ' button'))
        .find(item => item.textContent.trim() === label);
      window.addEventListener('message', async event => {
        if (event.data.type === 'pagination-fixture-ready') { acknowledged = event.data.request; return; }
        if (event.data.type !== 'pagination-start') return;
        try {
          const apps = standalone ? ['mindcards'] : ['skills', 'mindcards'];
          for (const app of apps) {
            await fixture(0);
            if (!standalone) {
              const label = app === 'skills' ? 'SkillVortex' : 'MindCards';
              await wait('workspace navigation', () => button('.workspace-navigation', label));
              button('.workspace-navigation', label).click();
            }
            const selector = app === 'skills' ? '.skills-grid .skill-card-heading h5' : '.mind-note-grid .mind-note-title';
            const pagination = () => document.querySelector('[aria-label="Paginas do ' +
              (app === 'skills' ? 'SkillVortex' : 'MindCards') + '"]');
            const names = () => Array.from(document.querySelectorAll(selector), item => item.textContent.trim());
            const expected = (count, page = 1, archived = false) => {
              const all = Array.from({ length: count }, (_, index) =>
                (archived ? 'Arquivado' : 'Card') + ' ' + String(index + 1).padStart(2, '0'));
              if (app === 'mindcards') all.reverse();
              return all.slice((page - 1) * 6, page * 6);
            };
            const page = async (count, current = 1, archived = false) => {
              const wanted = expected(count, current, archived);
              await wait(app + ' exact rendered cards: ' + wanted.join(', '), () =>
                names().join('|') === wanted.join('|') && Boolean(pagination()) === (count > 6));
              if (count > 6) {
                await wait('active page ' + current, () =>
                  pagination().querySelector('.ant-pagination-item-active')?.textContent === String(current));
                if (pagination().querySelector('.ant-select')) throw new Error('Page size must stay fixed at six');
              }
            };
            const go = number => pagination().querySelector('li[title="' + number + '"]').click();
            await page(0);
            for (const count of [6, 7, 13]) { await fixture(count); await page(count); }
            go(3);
            await page(13, 3);
            await fixture(12);
            await page(12, 2);
            await fixture(6);
            await page(6);
            await fixture(13);
            await page(13);
            go(2);
            await page(13, 2);
            const searchLabel = app === 'skills' ? 'Buscar skills' : 'Buscar notas';
            setSearch(searchLabel, 'Card 13');
            await wait('search includes cards outside the current page and resets pagination', () =>
              names().join('|') === 'Card 13' && !pagination());
            setSearch(searchLabel, '');
            await page(13);
            if (app === 'mindcards') {
              go(2);
              await page(13, 2);
              document.querySelector('.mind-folder-button[title="Pasta A"]').click();
              await wait('folder filter applies before pagination', () =>
                names().join('|') === 'Card 12|Card 10|Card 08|Card 06|Card 04|Card 02' && !pagination());
              document.querySelector('.mind-sidebar > .mind-folder-button').click();
              await page(13);
            }
            go(2);
            await page(13, 2);
            const heading = app === 'skills' ? '.library-heading' : '.mind-topbar';
            button(heading, 'Arquivados').click();
            await page(7, 1, true);
            go(2);
            await page(7, 2, true);
            button(heading, app === 'skills' ? 'Voltar para cards' : 'Voltar para notas').click();
            await page(13);
            go(2);
            await page(13, 2);
            await fixture(13, '/pagination-other-vault');
            await page(13);
          }
          bridge.postMessage({ type: 'pagination-complete', apps });
        } catch (error) { bridge.postMessage({ type: 'pagination-error', message: error.message }); }
      });
    </script><script type="module" nonce="paginationTest" src="${asset('app.js')}"></script>
    </body></html>`
  try {
    await result
  } finally {
    clearTimeout(timeout)
    listener.dispose()
    panel.dispose()
  }
}

module.exports = async function testPagination(extension) {
  await testPanel(extension, false)
  const mindCards = vscode.extensions.getExtension('skillvortex.mindcards')
  assert.ok(mindCards, 'Standalone MindCards extension must be available')
  await testPanel(mindCards, true)
  console.log('SkillVortex: six-card pagination, filters, archives, ordering and page clamping passed in integrated and standalone views')
}
