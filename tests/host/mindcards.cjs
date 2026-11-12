const assert = require('node:assert/strict')
const { mkdtemp, readFile, appendFile, rm } = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const vscode = require('vscode')

module.exports = async function testMindCards(extension) {
  const load = name => require(join(extension.extensionPath, `dist/${name}.js`))
  const { createVault, readVault } = load('vault')
  const { createMindCardsExamples, restoreMindCardsSnapshot, readMindCards, readMindNote, saveMindFolder, saveMindNote, setMindNoteArchived, deleteMindNote } = load('mindcards')
  const temporary = await mkdtemp(join(tmpdir(), 'mindcards-host-'))
  const root = join(temporary, 'vault')
  let panel, listener, timer
  let savedNote
  let conflictDetected = false
  try {
    await createVault(root)
    const baseFolder = { id: randomUUID(), name: 'Geral', color: '#1677ff' }
    let base
    const originalSkills = await readVault(root)
    panel = vscode.window.createWebviewPanel('mindCardsTest', 'MindCards test', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
    })
    const { webview } = panel
    const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview', name))
    const result = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out testing MindCards')), 60000)
      listener = webview.onDidReceiveMessage(async message => {
        try {
          if (message.type === 'ready') {
            await webview.postMessage({
              type: 'state', root, ...originalSkills, editingSkillId: null, content: '',
              features: { mindCards: true, productBuilder: true }
            })
            await webview.postMessage({ type: 'mindcards-test-start' })
          } else if (message.type === 'loadMindCards') {
            await webview.postMessage({ type: 'mindCards', root, state: await readMindCards(root) })
          } else if (message.type === 'createMindCardsExamples') {
            const state = await createMindCardsExamples(root)
            assert.equal(state.notes.length, 4)
            assert.equal(state.folders.length, 4)
            await webview.postMessage({ type: 'mindCards', root, state })
          } else if (message.type === 'mindcards-test-reset-examples') {
            await restoreMindCardsSnapshot(root, null)
            await saveMindFolder(root, baseFolder, null)
            base = await saveMindNote(root, {
              title: 'Regra base', folderId: baseFolder.id, tags: ['base'], links: [],
              content: '---\n\nContexto da regra\n\n---\n\nRegra de referencia.\n\n' +
                Array.from({ length: 60 }, (_, index) => `Paragrafo de leitura ${index + 1}.`).join('\n\n') +
                '\n\nUltima linha da nota completa.'
            })
            await webview.postMessage({ type: 'mindCards', root, state: await readMindCards(root) })
          } else if (message.type === 'archiveMindNote') {
            await setMindNoteArchived(root, message.id, message.revision, message.archived)
            await webview.postMessage({ type: 'mindCards', root, state: await readMindCards(root) })
          } else if (message.type === 'deleteMindNote') {
            assert.equal(message.id, base.note.id)
            await deleteMindNote(root, message.id, message.revision)
            await assert.rejects(readFile(join(root, base.note.filePath)), { code: 'ENOENT' })
            await webview.postMessage({ type: 'mindCards', root, state: await readMindCards(root), deleted: true })
          } else if (message.type === 'saveMindFolder') {
            await saveMindFolder(root, message.folder, message.revision)
            await webview.postMessage({ type: 'mindCards', root, state: await readMindCards(root) })
          } else if (message.type === 'openMindNote') {
            await webview.postMessage({ type: 'mindNote', root, document: await readMindNote(root, message.id) })
          } else if (message.type === 'saveMindNote') {
            if (message.id) {
              await assert.rejects(saveMindNote(root, message.value, message.id, message.revision), /alterado fora/)
              conflictDetected = true
              await webview.postMessage({ type: 'error', message: 'O MindCards foi alterado fora desta tela. Rascunho preservado.' })
            } else {
              savedNote = await saveMindNote(root, message.value)
              assert.equal(savedNote.note.title, 'Limite de desconto')
              assert.deepEqual(savedNote.note.links, [base.note.id])
              assert.match(savedNote.content, /\*\*<span style="color: #ff8800">Desconto<\/span>\*\*/)
              assert.match(savedNote.content, /<span style="color: #ff8800">/)
              await webview.postMessage({ type: 'mindCards', root, state: await readMindCards(root), document: savedNote, saved: true })
            }
          } else if (message.type === 'mindcards-test-external-edit') {
            await appendFile(join(root, savedNote.note.filePath), '\nEdicao externa preservada.')
            await webview.postMessage({ type: 'mindcards-test-external-edited' })
          } else if (message.type === 'mindcards-test-done') {
            assert.equal(conflictDetected, true)
            assert.equal(message.onlyVisual, true)
            assert.equal(message.backlink, true)
            assert.equal(message.mobileOverflow, false)
            assert.deepEqual(await readVault(root), originalSkills)
            assert.match(await readFile(join(root, savedNote.note.filePath), 'utf8'), /Edicao externa preservada/)
            resolve()
          } else if (message.type === 'mindcards-test-error') reject(new Error(message.message))
        } catch (error) { reject(error) }
      })
    })
    webview.html = `<!doctype html><html><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-mindcardsTest'; worker-src ${webview.cspSource} blob:; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;">
      <link rel="stylesheet" href="${asset('app.css')}"></head><body><div id="root"></div>
      <script nonce="mindcardsTest">
        const bridge = acquireVsCodeApi();
        globalThis.acquireVsCodeApi = () => bridge;
        const wait = async (label, predicate) => {
          const started = Date.now();
          while (!predicate()) {
            if (Date.now() - started > 12000) throw new Error('Timed out: ' + label);
            await new Promise(resolve => setTimeout(resolve, 40));
          }
        };
        const button = text => Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent.trim() === text && !item.disabled);
        ${require('./text-color-helper.cjs')}
        const setInput = (label, value) => {
          const input = document.querySelector('input[aria-label="' + label + '"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const paste = text => {
          const editor = document.querySelector('.tiptap');
          editor.focus();
          const data = new DataTransfer();
          data.setData('text/plain', text);
          editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
        };
        window.addEventListener('message', async event => {
          if (event.data.type === 'mindcards-test-external-edited') {
            try {
              paste('Rascunho local');
              await wait('dirty note', () => button('Salvar nota'));
              button('Salvar nota').click();
              await wait('external conflict', () => document.querySelector('.ant-alert-error')?.textContent.includes('alterado fora'));
              if (!document.querySelector('.tiptap').textContent.includes('Rascunho local')) throw new Error('Draft lost after conflict');
              bridge.postMessage({ type: 'mindcards-test-done', onlyVisual: true, backlink: true,
                mobileOverflow: document.documentElement.scrollWidth > innerWidth });
            } catch (error) { bridge.postMessage({ type: 'mindcards-test-error', message: error.message }); }
            return;
          }
          if (event.data.type !== 'mindcards-test-start') return;
          try {
            await wait('initial chooser', () => button('Abrir MindCards') && button('Abrir SkillVortex'));
            button('Abrir MindCards').click();
            await wait('MindCards loaded', () => document.querySelector('[aria-label="Nova pasta"]'));
            if (getComputedStyle(button('Criar backup')).color !== 'rgb(56, 158, 13)' ||
                getComputedStyle(button('Abrir biblioteca')).color !== 'rgb(179, 127, 235)' ||
                getComputedStyle(document.querySelector('[aria-label="Nova pasta"]')).color !== 'rgb(115, 209, 61)') {
              throw new Error('MindCards actions must use semantic colors while retaining its blue identity');
            }
            if (getComputedStyle(document.body).backgroundColor !== 'rgb(10, 10, 10)' ||
                getComputedStyle(document.querySelector('.mind-sidebar')).backgroundColor !== 'rgb(20, 20, 20)' ||
                getComputedStyle(button('Atualizar')).color !== 'rgb(105, 177, 255)') {
              throw new Error('MindCards must retain neutral dark backgrounds and blue buttons');
            }
            await wait('examples button', () => button('Carregar exemplos'));
            button('Carregar exemplos').click();
            await wait('examples confirmation', () => document.querySelector('.ant-modal .ant-btn-primary'));
            document.querySelector('.ant-modal .ant-btn-primary').click();
            await wait('four example cards', () => document.querySelectorAll('.mind-note-card').length === 4);
            if (getComputedStyle(document.querySelector('.mind-note-card')).backgroundColor !== 'rgb(23, 23, 23)') {
              throw new Error('MindCards cards must retain the standard neutral dark background');
            }
            await wait('examples action hidden', () => !Array.from(document.querySelectorAll('.mind-main button'))
              .some(item => item.textContent.trim() === 'Carregar exemplos'));
            for (const name of ['Acessibilidade', 'HTML e CSS', 'SEO', 'Testes']) {
              if (!document.querySelector('.mind-sidebar').textContent.includes(name)) throw new Error('Missing example folder ' + name);
            }
            const folderButtons = Array.from(document.querySelectorAll('.mind-folder-button'));
            const dimensions = folderButtons.map(item => item.getBoundingClientRect());
            if (dimensions.some(rect => Math.abs(rect.width - dimensions[0].width) > 1 || rect.height !== 46)) {
              throw new Error('Folder buttons must have uniform width and 46px height');
            }
            const folderName = document.querySelector('.mind-folder-name');
            const textMeasure = document.createElement('canvas').getContext('2d');
            textMeasure.font = getComputedStyle(folderName).font;
            if (getComputedStyle(folderName).whiteSpace !== 'nowrap' ||
                textMeasure.measureText('Recomendacoes tecnicas').width > folderName.clientWidth) {
              throw new Error('Standard folder name must fit on one horizontal line');
            }
            bridge.postMessage({ type: 'mindcards-test-reset-examples' });
            await wait('reset example test data', () => document.querySelectorAll('.mind-note-card').length === 1);
            document.querySelector('[aria-label="Excluir nota Regra base"]').click();
            const deleteModal = () => Array.from(document.querySelectorAll('.ant-modal-wrap:not([style*="display: none"])'))
              .find(item => item.textContent.includes('Regra base') && item.querySelector('.ant-btn-dangerous'));
            await wait('delete confirmation identifies note', deleteModal);
            Array.from(deleteModal().querySelectorAll('button')).find(item => item.textContent.trim() === 'Cancelar').click();
            await wait('delete cancelled', () => !deleteModal());
            if (document.querySelectorAll('.mind-note-card').length !== 1) throw new Error('Cancel deleted a card');
            document.querySelector('[aria-label="Excluir nota Regra base"]').click();
            await wait('confirm card deletion', deleteModal);
            deleteModal().querySelector('.ant-btn-dangerous').click();
            await wait('card deleted from list', () => document.querySelectorAll('.mind-note-card').length === 0);
            bridge.postMessage({ type: 'mindcards-test-reset-examples' });
            await wait('reset after deletion', () => document.querySelectorAll('.mind-note-card').length === 1);
            document.querySelector('.mind-note-card .card-top-row [aria-label="Arquivar"]').click();
            await wait('archived note hidden', () => document.querySelectorAll('.mind-note-card').length === 0);
            button('Arquivados').click();
            await wait('archived note screen', () => document.querySelector('.card-top-row [aria-label="Restaurar"]') && document.querySelector('.mind-note-title')?.textContent === 'Regra base');
            button('Abrir nota').click();
            await wait('archived note remains readable', () => document.querySelector('.tiptap')?.textContent.includes('Ultima linha da nota completa.'));
            button('Voltar').click();
            await wait('archived cards again', () => document.querySelector('.card-top-row [aria-label="Restaurar"]'));
            document.querySelector('.card-top-row [aria-label="Restaurar"]').click();
            await wait('restored note leaves archive', () => document.querySelectorAll('.mind-note-card').length === 0);
            button('Voltar para notas').click();
            await wait('restored active note', () => document.querySelectorAll('.mind-note-card').length === 1);
            for (const query of ['gErAl', 'Regra base', 'base']) {
              setInput('Buscar notas', query);
              await wait('search matches ' + query, () => document.querySelectorAll('.mind-note-card').length === 1);
              if (!document.querySelector('.mind-note-title').textContent.includes('Regra base')) {
                throw new Error('Search must match note title, tags and folder name');
              }
            }
            setInput('Buscar notas', 'pasta inexistente');
            await wait('unmatched folder search', () => document.querySelectorAll('.mind-note-card').length === 0);
            setInput('Buscar notas', '');
            await wait('cleared folder search', () => document.querySelectorAll('.mind-note-card').length === 1);
            document.querySelector('[aria-label="Nova pasta"]').click();
            await wait('folder form', () => document.querySelector('input[aria-label="Nome da pasta"]'));
            if (getComputedStyle(document.querySelector('.ant-modal-content')).backgroundColor !== 'rgb(31, 31, 31)') {
              throw new Error('MindCards folder modal must retain the standard neutral dark background');
            }
            setInput('Nome da pasta', 'Financeiro');
            await wait('folder save', () => button('Salvar pasta'));
            button('Salvar pasta').click();
            await wait('folder persisted', () => !document.querySelector('.ant-modal-wrap:not([style*="display: none"])') && document.querySelector('.mind-sidebar').textContent.includes('Financeiro'));
            const finance = Array.from(document.querySelectorAll('.mind-folder-button')).find(item => item.textContent.includes('Financeiro'));
            if (getComputedStyle(finance.querySelector('span[style]')).color !== 'rgb(82, 196, 26)') throw new Error('Folder color missing');
            finance.click();
            button('Nova nota').click();
            await wait('visual note editor', () => document.querySelector('.tiptap'));
            if (document.querySelector('.monaco-editor') || document.querySelector('.editor-pane-heading')) throw new Error('Note must only show visual Text editor');
            setInput('Titulo da nota', 'Limite de desconto');
            paste('Desconto permitido ate 10%.');
            await wait('note text', () => document.querySelector('.tiptap').textContent.includes('Desconto'));
            const editor = document.querySelector('.tiptap');
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
              if (!node.textContent.includes('Desconto')) continue;
              const range = document.createRange();
              range.setStart(node, 0); range.setEnd(node, 8);
              const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
              document.dispatchEvent(new Event('selectionchange')); break;
            }
            await wait('bold button', () => document.querySelector('button[aria-label="Negrito"]'));
            document.querySelector('button[aria-label="Negrito"]').click();
            await wait('bold text', () => document.querySelector('.tiptap strong')?.textContent === 'Desconto');
            await wait('blue active editor formatting', () =>
              document.querySelector('button[aria-label="Negrito"]').getAttribute('aria-pressed') === 'true' &&
              getComputedStyle(document.querySelector('button[aria-label="Negrito"]')).borderColor === 'rgb(105, 177, 255)');
            await applyTextColor('Desconto', '#ff8800');
            button('Leitura').click();
            await wait('read only draft', () => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'false');
            if (document.querySelector('[role="toolbar"]') || button('Salvar nota') ||
                !document.querySelector('.tiptap strong') ||
                document.querySelector('.tiptap span[style]')?.style.color !== 'rgb(255, 136, 0)') {
              throw new Error('Reading must preserve formatted draft without editing tools');
            }
            button('Voltar a editar').click();
            await wait('editable draft restored', () => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'true');
            const relatedInput = document.querySelector('input[aria-label="Notas relacionadas"]');
            relatedInput.focus();
            relatedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
            await wait('related option', () => Array.from(document.querySelectorAll('.ant-select-item-option-content')).some(item => item.textContent === 'Regra base'));
            Array.from(document.querySelectorAll('.ant-select-item-option-content')).find(item => item.textContent === 'Regra base').click();
            editor.click();
            await wait('save note', () => button('Salvar nota'));
            if (getComputedStyle(button('Salvar nota')).color !== 'rgb(56, 158, 13)' ||
                getComputedStyle(button('Voltar')).color !== 'rgb(105, 177, 255)') {
              throw new Error('Save must be green and back must be light blue');
            }
            button('Salvar nota').click();
            await wait('saved note', () => !button('Salvar nota') && document.querySelector('.mind-note-editor')?.textContent.includes('Todas as alteracoes salvas'));
            const related = Array.from(document.querySelectorAll('.mind-connections button')).find(item => item.textContent === 'Regra base');
            related.click();
            await wait('base note', () => document.querySelector('input[aria-label="Titulo da nota"]').value === 'Regra base');
            await wait('body separators are not YAML', () => document.querySelector('.tiptap')?.textContent.includes('Contexto da regra'));
            button('Leitura').click();
            await wait('base note read mode', () => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'false');
            const readEditor = document.querySelector('.tiptap');
            if (readEditor.scrollHeight > readEditor.clientHeight + 1 ||
                readEditor.clientHeight < 1000 ||
                !readEditor.textContent.includes('Ultima linha da nota completa.') ||
                getComputedStyle(readEditor).overflowY !== 'visible' ||
                getComputedStyle(document.querySelector('.mind-sidebar')).display !== 'none') {
              throw new Error('Reading must expand the full document without internal scrolling');
            }
            if (!document.querySelector('.mind-note-editor').textContent.includes('Todas as alteracoes salvas')) {
              throw new Error('Toggling reading must not mark the document dirty');
            }
            button('Voltar a editar').click();
            await wait('base note edit restored', () => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'true');
            await wait('backlink', () => Array.from(document.querySelectorAll('.mind-connections button')).some(item => item.textContent === 'Limite de desconto'));
            button('Voltar a nota original').click();
            await wait('return to original note', () => document.querySelector('input[aria-label="Titulo da nota"]').value === 'Limite de desconto');
            if (button('Voltar a nota original')) throw new Error('Return action must clear after returning to original note');
            button('Leitura').click();
            await wait('original note reading mode', () => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'false');
            document.querySelector('.mind-connections button').click();
            await wait('navigate to base again', () => document.querySelector('input[aria-label="Titulo da nota"]').value === 'Regra base');
            Array.from(document.querySelectorAll('.mind-connections button')).find(item => item.textContent === 'Limite de desconto').click();
            await wait('navigate via backlink', () => document.querySelector('input[aria-label="Titulo da nota"]').value === 'Limite de desconto');
            Array.from(document.querySelectorAll('.mind-connections button')).find(item => item.textContent === 'Regra base').click();
            await wait('third linked navigation', () => document.querySelector('input[aria-label="Titulo da nota"]').value === 'Regra base');
            button('Voltar a nota original').click();
            await wait('return directly to original with reading mode', () =>
              document.querySelector('input[aria-label="Titulo da nota"]').value === 'Limite de desconto' &&
              document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'false');
            button('Voltar').click();
            document.querySelector('.workspace-navigation button[aria-pressed][class*="action-library"]').click();
            await wait('skills dashboard preserved', () => document.querySelector('input[aria-label="Buscar skills"]'));
            if (getComputedStyle(document.querySelector('.brand span')).color !== 'rgb(255, 77, 79)' ||
                getComputedStyle(document.body).backgroundColor !== 'rgb(10, 10, 10)') {
              throw new Error('Switching back must preserve SkillVortex original theme');
            }
            button('MindCards').click();
            await wait('notes loaded again', () => Array.from(document.querySelectorAll('.mind-note-title')).some(item => item.textContent === 'Limite de desconto'));
            Array.from(document.querySelectorAll('.mind-note-title')).find(item => item.textContent === 'Limite de desconto').click();
            await wait('reopened note', () => document.querySelector('.tiptap strong')?.textContent === 'Desconto');
            await wait('reopened color persisted', () => document.querySelector('.tiptap span[style]')?.style.color === 'rgb(255, 136, 0)');
            bridge.postMessage({ type: 'mindcards-test-external-edit' });
          } catch (error) { bridge.postMessage({ type: 'mindcards-test-error', message: error.message }); }
        });
      </script><script type="module" nonce="mindcardsTest" src="${asset('app.js')}"></script></body></html>`
    await result
    console.log('MindCards: chooser, folders, visual-only editing, links, backlinks, persistence, area switching and external conflict passed')
  } finally {
    clearTimeout(timer)
    listener?.dispose()
    panel?.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
}
