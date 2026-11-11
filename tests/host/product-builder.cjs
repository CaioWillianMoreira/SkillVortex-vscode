const assert = require('node:assert/strict')
const vscode = require('vscode')
const { join } = require('node:path')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')

module.exports = async function testProductBuilder(extension) {
  const realAI = process.env.SKILLVORTEX_TEST_LOCAL_AI === '1'
  const liveW3c = process.env.SKILLVORTEX_TEST_W3C === '1'
  const cache = process.env.SKILLVORTEX_TEST_MODEL_CACHE || await mkdtemp(join(tmpdir(), 'builder-model-'))
  const { ensureLocalModel } = require(join(extension.extensionPath, 'dist/local-model.js'))
  const root = '/builder-test'
  const note = { id: '550e8400-e29b-41d4-a716-446655440000', title: 'Desconto', folderId: 'business', tags: ['checkout'], revision: 'current', links: [] }
  const sources = [{ id: note.id, title: note.title, content: 'O desconto maximo e 10%. Nao acumular com cupons.' }]
  const references = liveW3c
    ? await require(join(extension.extensionPath, 'dist/w3c-references.js')).fetchW3cReferences('teclado', [], new AbortController().signal)
    : [{ title: 'W3C WAI - Keyboard', url: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
    html: '<html><body><nav>IGNORE_NAVIGATION</nav><main><h1>Keyboard</h1><p>' + 'Official keyboard reference. '.repeat(60) + '</p><script>IGNORE_SCRIPT</script></main></body></html>' }]
  const panel = vscode.window.createWebviewPanel('productBuilderTest', 'Product Builder test', vscode.ViewColumn.One, {
    enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview'), vscode.Uri.file(cache)]
  })
  const asset = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview', name))
  const state = { type: 'state', root, catalog: { version: 1, categories: ['Geral'], skills: [] },
    projects: { version: 1, activeProject: null, projects: [] }, editingSkillId: null, content: '' }
  let listener, timer
  let opened = false
  try {
    const result = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out testing Product Builder')), realAI ? 480000 : 60000)
      listener = panel.webview.onDidReceiveMessage(async message => {
        try {
          if (message.type === 'ready') {
            await panel.webview.postMessage(state)
            await panel.webview.postMessage({ type: 'builder-test-start' })
          } else if (message.type === 'loadMindCards') {
            await panel.webview.postMessage({ type: 'mindCards', root, state: {
              folders: [{ id: 'business', name: 'Negocio', color: '#1677ff' }], notes: [note], revision: null
            } })
          } else if (message.type === 'prepareBuilder') {
            assert.equal(message.objective, 'Crie uma skill curta para implementar desconto no checkout.')
            assert.deepEqual(message.notes, [{ id: note.id, revision: note.revision }])
            assert.equal(message.useW3c, true)
            if (realAI) await ensureLocalModel(join(cache, 'qwen'), new AbortController().signal, message => console.log('Product Builder:', message))
            await panel.webview.postMessage({ type: 'builderSources', root, requestId: message.requestId, sources, references,
              runtimePath: asset('onnx').toString() + '/', modelPath: panel.webview.asWebviewUri(vscode.Uri.file(cache)).toString() + '/' })
          } else if (message.type === 'openBuilderSkill') {
            assert.equal(message.title, 'Desconto no checkout')
            assert.ok(message.content.length > 30)
            assert.ok(message.content.includes(sources[0].content))
            assert.ok(!message.content.includes('SUGESTAO_NAO_APROVADA'))
            assert.ok(message.content.includes('## Regras e contexto originais'))
            assert.ok(message.content.includes(references[0].url))
            assert.ok(!message.content.includes('IGNORE_SCRIPT'))
            if (realAI) {
              assert.match(message.content, /^#{1,6}\s+\S/)
              assert.match(message.content, /10/)
              assert.match(message.content, /cupons/i)
            }
            opened = true
            await panel.webview.postMessage({ ...state, editingSkillId: 'generated', creating: true, content: message.content,
              catalog: { ...state.catalog, skills: [{ id: 'generated', name: message.title, category: 'Geral', description: 'Rascunho local',
                filePath: 'skills/desconto.md', status: 'blocked', tags: ['product-builder'], agents: ['GitHub Copilot'] }] } })
            await panel.webview.postMessage({ type: 'builderSkillOpened', root })
          } else if (message.type === 'builder-test-done') { assert.equal(opened, true); resolve() }
          else if (message.type === 'builder-test-error') reject(new Error(message.message.slice(0, 1000) + (message.message.length > 2000 ? '\n...\n' + message.message.slice(-1000) : '')))
          else if (message.type === 'builder-test-progress') console.log('Product Builder:', message.message)
        } catch (error) { reject(error) }
      })
    })
    panel.webview.html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} blob: 'nonce-builderTest' 'wasm-unsafe-eval'; style-src ${panel.webview.cspSource} 'unsafe-inline'; worker-src ${panel.webview.cspSource} blob:; connect-src ${panel.webview.cspSource} blob:; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource} data:;">
      <link rel="stylesheet" href="${asset('app.css')}"></head><body><div id="root"></div><script nonce="builderTest">
      const bridge = acquireVsCodeApi(); window.acquireVsCodeApi = () => bridge;
      if (bridge.getState()?.started) bridge.postMessage({ type: 'builder-test-error', message: 'A webview reiniciou durante a inferencia local; possivel excesso de memoria.' });
      ${realAI ? `const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => {
            if (event.data.type === 'progress') bridge.postMessage({ type: 'builder-test-progress', message: event.data.message });
          });
        }
      };` : `const originalFetch = window.fetch;
      window.fetch = (url, options) => String(url).includes('/qwen/') || String(url).includes('/onnx/')
        ? Promise.resolve(new Response(new Uint8Array([0]))) : originalFetch(url, options);
      let attempts = 0;
      window.Worker = class {
        postMessage(input) {
          if (!input.sources[0].content.includes('10%')) throw new Error('Missing selected note content');
          if (!input.references[0].content.includes(${JSON.stringify(liveW3c ? 'Keyboard' : 'Official keyboard reference.')}) ||
              input.references[0].content.includes('IGNORE_') ||
              input.references[0].content.length > 1300) throw new Error('Invalid W3C excerpt extraction');
          const attempt = ++attempts;
          setTimeout(() => this.onmessage({ data: attempt === 1
            ? { type: 'error', message: 'Falha simulada do modelo local' }
            : { type: 'result', content: '## Passos sugeridos\\nSUGESTAO_NAO_APROVADA: conceder desconto de 99%.' }
          }), attempt === 2 ? 600 : 30);
        }

        terminate() {}
      };`}
      const button = text => Array.from(document.querySelectorAll('button')).find(item => item.textContent.trim() === text && !item.disabled);
      const wait = async (label, predicate, timeout = 12000, allowError = false) => {
        const start = Date.now(); let last = '';
        while (!predicate()) {
          const error = document.querySelector('.product-builder .ant-alert-error');
          if (error && !allowError) throw new Error(error.textContent);
          const status = document.querySelector('.product-builder [role="status"]')?.textContent;
          if (status && status !== last) { last = status; bridge.postMessage({ type: 'builder-test-progress', message: status }); }
          if (Date.now() - start > timeout) throw new Error('Timed out: ' + label);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      };
      const input = (label, value, tag = 'input') => {
        const element = document.querySelector('[aria-label="' + label + '"]');
        Object.getOwnPropertyDescriptor(tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      window.addEventListener('message', async event => {
        if (event.data.type !== 'builder-test-start') return;
        bridge.setState({ started: true });
        try {
          await wait('builder entry', () => button('Abrir Product Builder'));
          button('Abrir Product Builder').click();
          await wait('notes', () => document.querySelector('.builder-note-list input'));
          input('Titulo da skill gerada', 'Desconto no checkout');
          input('Objetivo da skill', 'Crie uma skill curta para implementar desconto no checkout.', 'textarea');
          document.querySelector('.builder-note-list input').click();
          const w3cOption = Array.from(document.querySelectorAll('label')).find(item => item.textContent.includes('Consultar referencias oficiais do W3C'));
          w3cOption.querySelector('input').click();
          await wait('generate enabled', () => button('Gerar skill'));
          button('Gerar skill').click();
          await wait('W3C network consent', () => button('Consultar W3C'));
          button('Consultar W3C').click();
          await wait('download consent', () => button('Continuar e baixar'));
          button('Continuar e baixar').click();
          ${realAI ? '' : `
          await wait('explicit inference error', () => document.querySelector('.product-builder .ant-alert-error')?.textContent.includes('Falha simulada'));
          if (!document.querySelector('[aria-label="Rascunho da skill"]').value.includes('O desconto maximo e 10%. Nao acumular com cupons.')) throw new Error('Inference failure lost original rules');
          await wait('retry enabled', () => button('Gerar skill'));
          button('Gerar skill').click();
          await wait('W3C retry consent', () => button('Consultar W3C'), 12000, true);
          button('Consultar W3C').click();
          await wait('replacement confirmation', () => button('Gerar novamente'), 12000, true);
          button('Gerar novamente').click();
          await wait('worker running', () => attempts === 2, 12000, true);
          button('Cancelar geracao').click();
          await new Promise(resolve => setTimeout(resolve, 750));
          if (!document.querySelector('[aria-label="Rascunho da skill"]').value.includes('O desconto maximo e 10%. Nao acumular com cupons.')) throw new Error('Cancellation lost original rules');
          if (document.querySelector('[aria-label="Sugestoes da IA"]')) throw new Error('Cancelled inference added stale suggestions');
          await wait('retry after cancellation', () => button('Gerar skill'));
          button('Gerar skill').click();
          await wait('W3C retry after cancellation consent', () => button('Consultar W3C'));
          button('Consultar W3C').click();
          await wait('replacement after cancellation', () => button('Gerar novamente'));
          button('Gerar novamente').click();
          `}
          await wait('AI suggestions separate from skill', () => document.querySelector('[aria-label="Sugestoes da IA"]'), ${realAI ? 440000 : 12000});
          if (document.querySelector('[aria-label="Rascunho da skill"]').value.includes('SUGESTAO_NAO_APROVADA')) throw new Error('AI changed original rules');
          button('Revisar no SkillVortex').click();
          await wait('skill editor', () => document.querySelector('input[value="Desconto no checkout"]') && button('Salvar'));
          bridge.postMessage({ type: 'builder-test-done' });
        } catch (error) { bridge.postMessage({ type: 'builder-test-error', message: error.message }); }
      });
      </script><script type="module" nonce="builderTest" src="${asset('app.js')}"></script></body></html>`
    await result
    console.log(`Product Builder: selection, ${realAI ? 'real local model inference' : 'mocked inference'}, preview and draft handoff passed`)
  } finally {
    clearTimeout(timer); listener?.dispose(); panel.dispose()
    if (!process.env.SKILLVORTEX_TEST_MODEL_CACHE) await rm(cache, { recursive: true, force: true })
  }
}

module.exports.run = async () => {
  const extension = vscode.extensions.getExtension('skillvortex.skillvortex-extension')
  assert.ok(extension)
  await extension.activate()
  await module.exports(extension)
}
