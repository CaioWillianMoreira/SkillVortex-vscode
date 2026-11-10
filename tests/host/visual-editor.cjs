const assert = require('node:assert/strict')
const vscode = require('vscode')

module.exports = async function testVisualEditor(extension) {
  const panel = vscode.window.createWebviewPanel('visualEditorTest', 'Visual editor test', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
  })
  const webview = panel.webview
  const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview', name))
  const metadata = '---\r\n# Preservar comentario\r\nname: visual-test\r\ndescription: teste\r\ncustom: [a, b]\r\n---\r\n'
  const content = metadata + [
    '', '# Exemplo', '', 'Formatar este texto', '', '- Item preservado', '', '- [x] Tarefa preservada', '',
    '| Coluna |', '| --- |', '| Celula |', '', '```js', 'const original = true', '```', ''
  ].join('\r\n')
  const state = {
    type: 'state', root: '/test-vault',
    catalog: { version: 1, categories: ['Geral'], skills: [{
      id: 'visual-test', name: 'Visual test', category: 'Geral', description: 'Descricao',
      filePath: 'skills/visual-test.md', agents: ['GitHub Copilot'], status: 'allowed', tags: ['teste']
    }] },
    projects: { version: 1, activeProject: null, projects: [] },
    editingSkillId: 'visual-test', content
  }
  let listener
  let timeout
  let stage = 'protection'
  const result = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out testing visual Markdown editor')), 40000)
    listener = webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ready') {
          assert.ok(await webview.postMessage(state))
          assert.ok(await webview.postMessage({ type: 'test-metadata-protection' }))
        } else if (message.type === 'visual-roundtrip') {
          assert.equal(message.dirty, false, 'Switching modes must not modify the source')
        } else if (message.type === 'saveSkill') {
          if (stage === 'protection') {
            assert.equal(message.content, metadata + 'Corpo substituido', 'Replacing all editable text must leave the entire YAML unchanged')
            stage = 'roundtrip'
            assert.ok(await webview.postMessage({ ...state, saved: true }))
            assert.ok(await webview.postMessage({ type: 'test-visual-editor' }))
            return
          }
          assert.equal(stage, 'roundtrip')
          assert.ok(message.content.startsWith(metadata), 'YAML must remain byte-for-byte unchanged')
          assert.match(message.content, /\*\*Formatar\*\*/)
          assert.match(message.content, /\*\*texto\*\*/)
          assert.match(message.content, /\*este\*/)
          assert.match(message.content, /## \*\*Formatar\*\*/)
          assert.match(message.content, /\[texto\]\(https:\/\/example\.com\/guia\)/)
          assert.match(message.content, /Item preservado/)
          assert.match(message.content, /\[x\] Tarefa preservada/)
          assert.match(message.content, /\|.*Celula.*\|/)
          assert.match(message.content, /```js\r\nconst original = true/)
          assert.doesNotMatch(message.content, /(?<!\r)\n/, 'CRLF must be preserved')
          stage = 'html'
          assert.ok(await webview.postMessage({ ...state, content: metadata + '\n<div>HTML preservado</div>', saved: true }))
          assert.ok(await webview.postMessage({ type: 'test-visual-html' }))
        } else if (message.type === 'visual-test-complete') {
          assert.equal(stage, 'html')
          resolve()
        } else if (message.type === 'visual-test-error') reject(new Error(message.message))
      } catch (error) { reject(error) }
    })
  })
  webview.html = `<!doctype html><html><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-visualTest'; worker-src ${webview.cspSource} blob:; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;">
    <link rel="stylesheet" href="${asset('app.css')}"></head><body><div id="root"></div>
    <script nonce="visualTest">
      const bridge = acquireVsCodeApi();
      globalThis.acquireVsCodeApi = () => bridge;
      ${require('./select-skills.cjs')}
      const wait = async (label, predicate) => {
        const start = Date.now();
        while (!predicate()) {
          if (Date.now() - start > 10000) throw new Error('Timed out: ' + label);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      const mode = label => Array.from(document.querySelectorAll('.editor-pane-heading'))
        .find(item => item.textContent === label).click();
      const save = () => document.querySelector('.editor-top-actions .action-save');
      const select = text => {
        const editor = document.querySelector('.tiptap');
        editor.focus();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          const index = node.textContent.indexOf(text);
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + text.length);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          return;
        }
        throw new Error('Text not found: ' + text);
      };
      window.addEventListener('message', async event => {
        try {
          if (event.data.type === 'test-metadata-protection') {
            await wait('editable Markdown', () => document.querySelector('.monaco-editor textarea.inputarea'));
            const metadata = document.querySelector('textarea[aria-label="Cabecalho YAML protegido"]');
            if (!metadata?.readOnly || !metadata.value.includes('custom: [a, b]')) {
              throw new Error('YAML must be shown separately in a read-only control');
            }
            mode('Markdown');
            await new Promise(resolve => setTimeout(resolve, 500));
            const input = document.querySelector('.monaco-editor textarea.inputarea');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, metaKey: true, bubbles: true, cancelable: true
            }));
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Home', code: 'Home', keyCode: 36, which: 36, ctrlKey: true, bubbles: true, cancelable: true
            }));
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, metaKey: true, shiftKey: true, bubbles: true, cancelable: true
            }));
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'End', code: 'End', keyCode: 35, which: 35, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
            }));
            const data = new DataTransfer();
            data.setData('text/plain', 'Corpo substituido');
            input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
            await wait('body updated after paste', () => document.querySelector('.tiptap')?.textContent.includes('Corpo substituido'));
            if (document.querySelector('.tiptap')?.textContent !== 'Corpo substituido') {
              throw new Error('Expected whole-body replacement, got: ' + document.querySelector('.tiptap')?.textContent);
            }
            save().click();
          } else if (event.data.type === 'test-visual-editor') {
            mode('Texto');
            await wait('default text editor', () => document.querySelector('.tiptap'));
            await wait('source editor', () => document.querySelector('.monaco-editor'));
            if (!document.querySelector('[aria-label="Editor Texto"]').classList.contains('editor-pane-active')) {
              throw new Error('Text editor must be active by default');
            }
            if (document.querySelector('.markdown-preview')) throw new Error('Separate read-only preview must be removed');
            if (document.querySelectorAll('[role="toolbar"]').length !== 1) throw new Error('Editors must share one toolbar');
            const settings = document.querySelector('.editor-settings');
            if (settings.getBoundingClientRect().bottom > document.querySelector('.markdown-editor-card').getBoundingClientRect().top) {
              throw new Error('Projects and governance must be above the editors');
            }
            const groups = document.querySelectorAll('.visual-editor-toolbar [role="group"]');
            if (groups.length !== 6) throw new Error('Toolbar must have six labeled groups including text color');
            if (!document.querySelector('button[aria-label="Aumentar recuo"]').disabled) {
              throw new Error('Unavailable commands must be disabled');
            }
            if (document.querySelector('.tiptap').textContent.includes('custom:')) throw new Error('Visual editor exposed YAML');
            mode('Markdown');
            await wait('source editor again', () => document.querySelector('.monaco-editor'));
            bridge.postMessage({ type: 'visual-roundtrip', dirty: !save().disabled });
            mode('Texto');
            await wait('visual editor again', () => document.querySelector('.tiptap'));
            select('Celula');
            await wait('table controls', () => document.querySelector('button[aria-label="Adicionar linha"]'));
            document.querySelector('button[aria-label="Adicionar linha"]').click();
            await wait('new table row', () => document.querySelectorAll('.tiptap tr').length === 3);
            document.querySelector('button[aria-label="Desfazer"]').click();
            await wait('undo row', () => document.querySelectorAll('.tiptap tr').length === 2);
            select('Celula');
            await wait('table column controls', () => document.querySelector('button[aria-label="Adicionar coluna"]'));
            document.querySelector('button[aria-label="Adicionar coluna"]').click();
            await wait('new column', () => document.querySelectorAll('.tiptap th').length === 2);
            document.querySelector('button[aria-label="Desfazer"]').click();
            await wait('undo column', () => document.querySelectorAll('.tiptap th').length === 1);
            select('Formatar');
            document.querySelector('button[aria-label="Titulo 6"]').click();
            await wait('heading six', () => document.querySelector('.tiptap h6'));
            document.querySelector('button[aria-label="Limpar formatacao"]').click();
            await wait('clear heading', () => !document.querySelector('.tiptap h6'));
            select('Formatar');
            await new Promise(resolve => setTimeout(resolve, 100));
            document.querySelector('button[aria-label="Negrito"]').click();
            await wait('bold text', () => document.querySelector('.tiptap strong')?.textContent === 'Formatar');
            await wait('active bold button', () => document.querySelector('button[aria-label="Negrito"]').getAttribute('aria-pressed') === 'true');
            select('este');
            await new Promise(resolve => setTimeout(resolve, 100));
            document.querySelector('button[aria-label="Italico"]').click();
            await wait('italic text', () => document.querySelector('.tiptap em')?.textContent === 'este');
            document.querySelector('button[aria-label="Desfazer"]').click();
            await wait('undo', () => !document.querySelector('.tiptap em'));
            document.querySelector('button[aria-label="Refazer"]').click();
            await wait('redo', () => document.querySelector('.tiptap em'));
            document.querySelector('button[aria-label="Titulo 2"]').click();
            await wait('heading', () => document.querySelector('.tiptap h2 strong'));
            select('texto');
            await new Promise(resolve => setTimeout(resolve, 100));
            document.querySelector('button[aria-label="Inserir link"]').click();
            await wait('link modal', () => document.querySelector('input[aria-label="Endereco do link"]'));
            const url = document.querySelector('input[aria-label="Endereco do link"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(url, 'https://example.com/guia');
            url.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 100));
            Array.from(document.querySelectorAll('.ant-modal button')).find(button => button.textContent === 'Aplicar').click();
            await wait('link text', () => document.querySelector('.tiptap a')?.getAttribute('href') === 'https://example.com/guia');
            const toolbar = document.querySelector('.visual-editor-toolbar');
            const card = document.querySelector('.markdown-editor-card');
            const originalWidth = card.style.width;
            card.style.width = '320px';
            await new Promise(resolve => setTimeout(resolve, 100));
            if (toolbar.scrollWidth > toolbar.clientWidth + 1) throw new Error('Toolbar must wrap on narrow screens');
            const buttons = Array.from(toolbar.querySelectorAll('button'));
            if (!buttons.every(button => button.querySelector('svg'))) throw new Error('Every toolbar button must have an icon');
            const heights = buttons.map(button => button.getBoundingClientRect().height);
            if (!heights.every(height => height === 30)) throw new Error('Toolbar buttons must use consistent sizes');
            card.style.width = originalWidth;
            mode('Markdown');
            await wait('Markdown toolbar', () => document.querySelector('[aria-label="Editor Markdown"]').classList.contains('editor-pane-active'));
            const input = document.querySelector('.monaco-editor textarea.inputarea');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, metaKey: true, bubbles: true, cancelable: true
            }));
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'End', code: 'End', keyCode: 35, which: 35, ctrlKey: true, bubbles: true, cancelable: true
            }));
            await wait('source toolbar enabled', () => !document.querySelector('button[aria-label="Negrito"]').disabled);
            document.querySelector('button[aria-label="Negrito"]').click();
            await wait('source bold synced', () => Array.from(document.querySelectorAll('.tiptap strong')).some(node => node.textContent === 'texto'));
            await wait('Markdown selection highlights bold', () => document.querySelector('button[aria-label="Negrito"]').getAttribute('aria-pressed') === 'true');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'End', code: 'End', keyCode: 35, which: 35, bubbles: true, cancelable: true
            }));
            await wait('Markdown cursor outside bold clears highlight', () => document.querySelector('button[aria-label="Negrito"]').getAttribute('aria-pressed') === 'false');
            for (let step = 0; step < 3; step++) input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, bubbles: true, cancelable: true
            }));
            await wait('Markdown cursor inside bold highlights button', () => document.querySelector('button[aria-label="Negrito"]').getAttribute('aria-pressed') === 'true');
            document.querySelector('button[aria-label="Desfazer"]').click();
            await wait('source undo synced', () => !Array.from(document.querySelectorAll('.tiptap strong')).some(node => node.textContent === 'texto'));
            document.querySelector('button[aria-label="Refazer"]').click();
            await wait('source redo synced', () => Array.from(document.querySelectorAll('.tiptap strong')).some(node => node.textContent === 'texto'));
            document.querySelector('button[aria-label="Titulo 1"]').click();
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'End', code: 'End', keyCode: 35, which: 35, bubbles: true, cancelable: true
            }));
            await wait('heading button stays active at end of Markdown title', () =>
              document.querySelector('button[aria-label="Titulo 1"]').getAttribute('aria-pressed') === 'true');
            document.querySelector('button[aria-label="Desfazer"]').click();
            await wait('heading highlight clears after undo', () =>
              document.querySelector('button[aria-label="Titulo 1"]').getAttribute('aria-pressed') === 'false');
            save().click();
          } else if (event.data.type === 'test-visual-html') {
            await wait('saved state', () => save()?.disabled);
            mode('Texto');
            await wait('HTML warning', () => document.querySelector('.visual-markdown-editor .ant-alert'));
            if (document.querySelector('.tiptap')) throw new Error('HTML must not be rewritten by visual editor');
            mode('Markdown');
            await wait('HTML source', () => document.querySelector('.monaco-editor'));
            if (!save().disabled) throw new Error('Switching HTML modes must not modify source');
            bridge.postMessage({ type: 'visual-test-complete' });
          }
        } catch (error) { bridge.postMessage({ type: 'visual-test-error', message: error.stack || error.message }); }
      });
    </script><script type="module" nonce="visualTest" src="${asset('app.js')}"></script></body></html>`
  try {
    await result
    console.log('SkillVortex: visual formatting, mode switching, YAML, GFM, CRLF and HTML preservation passed')
  } finally {
    clearTimeout(timeout)
    listener.dispose()
    panel.dispose()
  }
}
