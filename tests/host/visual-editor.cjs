const assert = require('node:assert/strict')
const { join } = require('node:path')
const vscode = require('vscode')

module.exports = async function testVisualEditor(extension) {
  const { skillMarkdownMetadata, withSkillMetadata } = require(join(extension.extensionPath, 'dist/skill-metadata.js'))
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
      filePath: 'skills/visual-test.md', agents: ['GitHub Copilot'], status: 'allowed', tags: ['teste'],
      publicationPath: '.github/skills/code-review/SKILL.md'
    }] },
    projects: { version: 1, activeProject: null, projects: [] },
    editingSkillId: 'visual-test', content
  }
  let listener
  let timeout
  let stage = 'metadata-edit'
  const result = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out testing visual Markdown editor')), 60000)
    listener = webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ready') {
          assert.ok(await webview.postMessage(state))
          assert.ok(await webview.postMessage({ type: 'test-editable-metadata' }))
        } else if (message.type === 'metadata-fields-complete') {
          assert.equal(stage, 'metadata-saved')
          stage = 'metadata-missing'
          assert.ok(await webview.postMessage({ ...state, content: '# Sem metadados\n', saved: true }))
          assert.ok(await webview.postMessage({ type: 'test-missing-metadata' }))
        } else if (message.type === 'missing-metadata-complete') {
          assert.equal(stage, 'metadata-created')
          console.log('SkillVortex: editable YAML fields, metadata creation and stable publication paths passed')
          stage = 'search'
          assert.ok(await webview.postMessage({ ...state, saved: true }))
          assert.ok(await webview.postMessage({ type: 'test-editor-search' }))
        } else if (message.type === 'editor-search-complete') {
          assert.equal(stage, 'search')
          assert.equal(message.dirty, false, 'Searching must not modify the document')
          stage = 'protection'
          assert.ok(await webview.postMessage({ type: 'test-metadata-protection' }))
        } else if (message.type === 'visual-roundtrip') {
          assert.equal(message.dirty, false, 'Switching modes must not modify the source')
        } else if (message.type === 'saveSkill') {
          if (stage === 'metadata-edit' || stage === 'metadata-missing') {
            const editing = stage === 'metadata-edit'
            assert.equal(message.executionName, editing ? 'review' : 'code-review')
            assert.equal(message.description, editing ? 'Descricao editada.' : 'Descricao')
            assert.equal(message.publicationPath, '.github/skills/code-review/SKILL.md')
            const updated = withSkillMetadata(message.content, message.executionName, message.description)
            assert.deepEqual(skillMarkdownMetadata(updated), {
              name: message.executionName, description: message.description
            })
            assert.ok(updated.endsWith(editing ? content.slice(metadata.length) : '# Sem metadados\n'))
            if (editing) {
              assert.match(updated, /custom: \[\s*a,\s*b\s*\]/)
              assert.match(updated, /# Preservar comentario/)
            }
            stage = editing ? 'metadata-saved' : 'metadata-created'
            assert.ok(await webview.postMessage({ ...state, content: updated, saved: true }))
            assert.ok(await webview.postMessage({
              type: editing ? 'test-metadata-saved' : 'test-missing-metadata-saved'
            }))
            return
          }
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
      const setInput = (input, value) => {
        if (!input) throw new Error('Search input unavailable');
        input.focus();
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const key = (target, name, modifiers = {}) => target.dispatchEvent(new KeyboardEvent('keydown', {
        key: name, code: name.length === 1 ? 'Key' + name.toUpperCase() : name,
        keyCode: { f: 70, Enter: 13, Escape: 27 }[name],
        which: { f: 70, Enter: 13, Escape: 27 }[name],
        bubbles: true, cancelable: true, ...modifiers
      }));
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
          if (event.data.type === 'test-editable-metadata') {
            await wait('editable execution fields from YAML', () =>
              document.getElementById('skill-execution-name')?.value === 'visual-test' &&
              document.getElementById('skill-description')?.value === 'teste');
            const name = document.getElementById('skill-execution-name');
            const description = document.getElementById('skill-description');
            if (name.readOnly || name.disabled || description.readOnly || description.disabled) {
              throw new Error('Both YAML execution fields must be editable');
            }
            setInput(name, 'review');
            setInput(description, 'Descricao editada.');
            await wait('metadata edit enables saving', () => !save().disabled);
            save().click();
          } else if (event.data.type === 'test-metadata-saved' || event.data.type === 'test-missing-metadata-saved') {
            const editing = event.data.type === 'test-metadata-saved';
            await wait('saved metadata fields', () => save()?.disabled &&
              document.getElementById('skill-execution-name')?.value === (editing ? 'review' : 'code-review') &&
              document.getElementById('skill-description')?.value === (editing ? 'Descricao editada.' : 'Descricao'));
            if (document.getElementById('skill-publication-path').value !== '.github/skills/code-review/SKILL.md') {
              throw new Error('Editing YAML fields must not change the publication folder');
            }
            bridge.postMessage({ type: editing ? 'metadata-fields-complete' : 'missing-metadata-complete' });
          } else if (event.data.type === 'test-missing-metadata') {
            await wait('missing YAML enables save with a suggested name', () =>
              document.getElementById('skill-execution-name')?.value === 'code-review' &&
              document.getElementById('skill-description')?.value === 'Descricao' && !save().disabled);
            save().click();
          } else if (event.data.type === 'test-editor-search') {
            mode('Texto');
            await wait('text editor for search', () => document.querySelector('.tiptap'));
            const text = document.querySelector('.tiptap');
            text.focus();
            key(text, 'f', { ctrlKey: true });
            await wait('Ctrl+F text search', () => document.querySelector('input[aria-label="Buscar no editor Texto"]'));
            if (!save().disabled) throw new Error('Opening text search changed the source');
            const search = document.querySelector('input[aria-label="Buscar no editor Texto"]');
            setInput(search, 'preserv');
            await wait('two highlighted text matches', () =>
              document.querySelector('.editor-find-count')?.textContent === '1 de 2' &&
              document.querySelectorAll('.tiptap .editor-find-match').length === 2);
            if (!save().disabled) throw new Error('Text highlights changed the source');
            key(search, 'Enter');
            await wait('next text match', () => document.querySelector('.editor-find-count').textContent === '2 de 2');
            key(search, 'Enter', { shiftKey: true });
            await wait('previous text match', () => document.querySelector('.editor-find-count').textContent === '1 de 2');
            document.querySelector('[aria-label="Ocorrencia anterior"]').click();
            await wait('previous wraps', () => document.querySelector('.editor-find-count').textContent === '2 de 2');
            document.querySelector('[aria-label="Proxima ocorrencia"]').click();
            await wait('next wraps', () => document.querySelector('.editor-find-count').textContent === '1 de 2');
            if (!save().disabled) throw new Error('Text navigation changed the source');
            setInput(search, 'custom:');
            await wait('YAML excluded from text search', () =>
              document.querySelector('.editor-find-count').textContent === 'Nenhum resultado' &&
              !document.querySelector('.tiptap .editor-find-match') &&
              document.querySelector('[aria-label="Proxima ocorrencia"]').disabled);
            key(search, 'Escape');
            await wait('text search closes', () => !document.querySelector('.editor-find-bar'));
            if (!save().disabled) throw new Error('Closing text search changed the source');
            key(text, 'f', { metaKey: true });
            await wait('Cmd+F text search', () => document.querySelector('.editor-find-bar'));
            key(document.querySelector('input[aria-label="Buscar no editor Texto"]'), 'Escape');
            mode('Markdown');
            await wait('Markdown editor for search', () => document.querySelector('.monaco-editor textarea.inputarea'));
            const markdown = document.querySelector('.monaco-editor textarea.inputarea');
            markdown.focus();
            key(markdown, 'f', { metaKey: true });
            await wait('Cmd+F native find widget', () => document.querySelector('.monaco-editor .find-widget.visible'));
            if (!save().disabled) throw new Error('Opening native search changed the source');
            const nativeInput = () => document.querySelector('.find-widget .find-part textarea, .find-widget .find-part input');
            setInput(nativeInput(), 'preserv');
            await wait('native find counts body matches', () =>
              /of 2$/.test(document.querySelector('.find-widget .matchesCount')?.textContent));
            if (!save().disabled) throw new Error('Native search query changed the source');
            nativeInput().focus();
            key(nativeInput(), 'Escape');
            await wait('native search closes', () => !document.querySelector('.find-widget.visible'));
            markdown.focus();
            key(markdown, 'f', { ctrlKey: true });
            await wait('Ctrl+F native find widget', () => document.querySelector('.find-widget.visible'));
            setInput(nativeInput(), 'custom:');
            await wait('YAML excluded from Markdown search', () =>
              document.querySelector('.find-widget .matchesCount')?.textContent === 'No results');
            nativeInput().focus();
            key(nativeInput(), 'Escape');
            await wait('native search closed again', () => !document.querySelector('.find-widget.visible'));
            bridge.postMessage({ type: 'editor-search-complete', dirty: !save().disabled });
          } else if (event.data.type === 'test-metadata-protection') {
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
    console.log('SkillVortex: editable YAML metadata, missing metadata, Ctrl/Cmd+F, visual formatting and body preservation passed')
  } finally {
    clearTimeout(timeout)
    listener.dispose()
    panel.dispose()
  }
}
