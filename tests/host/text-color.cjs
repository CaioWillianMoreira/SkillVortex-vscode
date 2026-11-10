const assert = require('node:assert/strict')
const vscode = require('vscode')

module.exports = async function testTextColor(extension) {
  const panel = vscode.window.createWebviewPanel('textColorTest', 'Text color test', vscode.ViewColumn.One, {
    enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
  })
  const { webview } = panel
  const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview', name))
  const yaml = '---\r\nname: color-test\r\ndescription: preservar\r\n---\r\n'
  const state = {
    type: 'state', root: '/test-vault',
    catalog: { version: 1, categories: ['Geral'], skills: [{
      id: 'color-test', name: 'Color test', category: 'Geral', description: 'Teste',
      filePath: 'skills/color-test.md', agents: [], status: 'allowed', tags: ['teste']
    }] },
    projects: { version: 1, projects: [], activeProject: null }, editingSkillId: 'color-test',
    content: yaml + '\r\n# Cores\r\n\r\nTexto para colorir e preservar.\r\n'
  }
  let listener, timer
  let stage = 'apply'
  const result = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out testing persistent text colors')), 45000)
    listener = webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ready') {
          await webview.postMessage(state)
          await webview.postMessage({ type: 'test-color-apply' })
        } else if (message.type === 'saveSkill') {
          assert.ok(message.content.startsWith(yaml), 'Color changes must preserve YAML byte-for-byte')
          assert.doesNotMatch(message.content, /(?<!\r)\n/, 'Color changes must preserve CRLF')
          if (stage === 'apply') {
            assert.match(message.content, /<span style="color: #ff8800">colorir<\/span>/)
            stage = 'remove'
            await webview.postMessage({ ...state, content: message.content, saved: true })
            await webview.postMessage({ type: 'test-color-remove' })
          } else {
            assert.equal(stage, 'remove')
            assert.doesNotMatch(message.content, /<span/)
            assert.match(message.content, /Texto para colorir e preservar/)
            stage = 'guard'
            await webview.postMessage({ ...state, content: yaml + '<span style="color: #ff8800"><img src=x onerror=alert(1)></span>', saved: true })
            await webview.postMessage({ type: 'test-color-guard' })
          }
        } else if (message.type === 'text-color-done') resolve()
        else if (message.type === 'text-color-error') reject(new Error(message.message))
      } catch (error) { reject(error) }
    })
  })
  webview.html = `<!doctype html><html><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-colorTest'; worker-src ${webview.cspSource} blob:; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;">
    <link rel="stylesheet" href="${asset('app.css')}"></head><body><div id="root"></div>
    <script nonce="colorTest">
      const bridge = acquireVsCodeApi();
      globalThis.acquireVsCodeApi = () => bridge;
      ${require('./select-skills.cjs')}
      const wait = async (label, predicate) => {
        const start = Date.now();
        while (!predicate()) {
          if (Date.now() - start > 10000) throw new Error('Timed out: ' + label);
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      };
      ${require('./text-color-helper.cjs')}
      window.addEventListener('message', async event => {
        try {
          if (event.data.type === 'test-color-apply') {
            await wait('visual editor', () => document.querySelector('.tiptap'));
            await applyTextColor('colorir', '#ff8800');
            await wait('save color', () => !document.querySelector('.editor-top-actions .action-save').disabled);
            document.querySelector('.editor-top-actions .action-save').click();
          } else if (event.data.type === 'test-color-remove') {
            await wait('saved color rendered', () => document.querySelector('.tiptap span[style]')?.style.color === 'rgb(255, 136, 0)');
            if (document.querySelector('.ant-alert-warning')) throw new Error('Allowed color must not trigger HTML warning');
            const span = document.querySelector('.tiptap span[style]');
            document.querySelector('.tiptap').focus();
            const range = document.createRange(); range.selectNodeContents(span);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            await wait('remove color enabled', () => !document.querySelector('button[aria-label="Remover cor"]').disabled);
            document.querySelector('button[aria-label="Remover cor"]').click();
            await wait('color removed', () => !document.querySelector('.tiptap span[style]'));
            await wait('save removed color', () => !document.querySelector('.editor-top-actions .action-save').disabled);
            document.querySelector('.editor-top-actions .action-save').click();
          } else if (event.data.type === 'test-color-guard') {
            await wait('nested unsupported HTML warning', () => document.querySelector('.ant-alert-warning')?.textContent.includes('HTML'));
            if (document.querySelector('.tiptap')) throw new Error('Unsupported nested HTML must not be editable visually');
            bridge.postMessage({ type: 'text-color-done' });
          }
        } catch (error) { bridge.postMessage({ type: 'text-color-error', message: error.message }); }
      });
    </script><script type="module" nonce="colorTest" src="${asset('app.js')}"></script></body></html>`
  try {
    await result
    console.log('SkillVortex: persistent text color, removal, YAML/CRLF and nested HTML guard passed')
  } finally { clearTimeout(timer); listener?.dispose(); panel.dispose() }
}
