const assert = require('node:assert/strict')
const vscode = require('vscode')

module.exports = async function testClipboard(extension) {
  const panel = vscode.window.createWebviewPanel('clipboardTest', 'Clipboard test', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
  })
  const webview = panel.webview
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview/app.js'))
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview/app.css'))
  const nonce = 'clipboardTestNonce'
  const state = {
    type: 'state', root: '/test-vault',
    catalog: {
      version: 1, categories: ['Geral'],
      skills: [{
        id: 'clipboard-test', name: 'Teste', category: 'Geral', description: 'Teste',
        filePath: 'skills/test.md', agents: [], status: 'allowed', tags: []
      }]
    },
    projects: { version: 1, activeProject: null, projects: [] },
    editingSkillId: 'clipboard-test', content: 'Conteudo original'
  }
  let timeout
  let listener
  const result = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out testing webview paste')), 20000)
    listener = webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ready') {
          assert.ok(await webview.postMessage(state), 'Could not load the editor test state')
          assert.ok(await webview.postMessage({ type: 'prepare-clipboard-test' }), 'Could not prepare the paste test')
        }
        if (message.type === 'clipboard-test-ready') {
          await vscode.commands.executeCommand('editor.action.clipboardPasteAction')
        }
        if (message.type === 'clipboard-test-result') resolve(message)
        if (message.type === 'clipboard-test-error') reject(new Error(message.message))
      } catch (error) {
        reject(error)
      }
    })
  })

  webview.html = `<!doctype html><html><head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; worker-src ${webview.cspSource} blob:; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;">
    <link rel="stylesheet" href="${css}">
    </head><body><div id="root"></div>
    <script nonce="${nonce}">
      const bridge = acquireVsCodeApi();
      globalThis.acquireVsCodeApi = () => bridge;
      window.addEventListener('message', event => {
        if (event.data.type !== 'prepare-clipboard-test') return;
        const started = Date.now();
        const timer = setInterval(() => {
          const input = document.querySelector('.monaco-editor textarea.inputarea');
          if (input) input.focus();
          if (!input || !document.hasFocus() || !document.querySelector('.monaco-editor.focused')) {
            if (Date.now() - started > 12000) {
              clearInterval(timer);
              bridge.postMessage({type:'clipboard-test-error', message:'Editable Monaco textarea did not receive focus'});
            }
            return;
          }
          clearInterval(timer);
          const originalExecCommand = document.execCommand.bind(document);
          document.execCommand = (command, ...args) => {
            if (command !== 'paste') return originalExecCommand(command, ...args);
            const data = new DataTransfer();
            data.setData('text/plain', 'TESTE_DE_COLAGEM\\nSegunda linha');
            input.dispatchEvent(new ClipboardEvent('paste', {
              bubbles: true, cancelable: true, clipboardData: data
            }));
            const pasteStarted = Date.now();
            const resultTimer = setInterval(() => {
              const text = document.querySelector('.markdown-preview')?.textContent ?? '';
              if (text.includes('TESTE_DE_COLAGEM') && text.includes('Segunda linha') && text.includes('Conteudo original')) {
                clearInterval(resultTimer);
                bridge.postMessage({type:'clipboard-test-result', inserted:true});
              } else if (Date.now() - pasteStarted > 3000) {
                clearInterval(resultTimer);
                bridge.postMessage({type:'clipboard-test-error', message:'Paste did not update the Markdown preview'});
              }
            }, 50);
            return true;
          };
          setTimeout(() => bridge.postMessage({type:'clipboard-test-ready'}), 500);
        }, 100);
      });
    </script><script type="module" nonce="${nonce}" src="${script}"></script>
    </body></html>`

  try {
    assert.equal((await result).inserted, true)
  } finally {
    clearTimeout(timeout)
    listener.dispose()
    panel.dispose()
  }
}
