const assert = require('node:assert/strict')
const { join } = require('node:path')
const vscode = require('vscode')

module.exports = async function testCardColors(extension) {
  const { SKILL_CARD_COLORS, SKILL_CARD_COLOR_LABELS, categoryColor, skillCardTextColor } =
    require(join(extension.extensionPath, 'dist/skill-colors.js'))
  const rgb = color => `rgb(${[1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)).join(', ')})`
  const panel = vscode.window.createWebviewPanel('cardColorsTest', 'Card colors test', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'dist/webview')]
  })
  const webview = panel.webview
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview/app.js'))
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'dist/webview/app.css'))
  const nonce = 'cardColorsTestNonce'
  let skill
  let colorIndex = 0
  let projectLinked = false
  let otherProjectLinked = false
  let collections = []
  let stage = 'create'
  let externalReviewRequested = false
  const state = (editingSkillId = null, saved = false) => ({
    type: 'state', root: '/test-vault',
    catalog: { version: 1, categories: ['Geral'], collections, skills: skill ? [skill] : [] },
    projects: {
      version: 1, activeProject: 'color-project',
      projects: [{
        id: 'color-project', name: 'Color project', sourcePath: '/test-project',
        skillIds: projectLinked ? [skill.id] : []
      }, {
        id: 'other-project', name: 'Other project', sourcePath: '/other-project',
        skillIds: otherProjectLinked ? [skill.id] : []
      }]
    },
    editingSkillId, content: editingSkillId ? '# Nova Skill\n\n' : '', saved,
    hasProjectMarkdown: true
  })

  let timeout
  let listener
  const result = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out testing card colors in the webview')), 60000)
    listener = webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ready') {
          assert.ok(await webview.postMessage(state()))
          assert.ok(await webview.postMessage({ type: 'color-test-create' }))
        } else if (message.type === 'first-use-examples-visible') {
          assert.equal(message.visible, true)
        } else if (message.type === 'manager-chrome') {
          assert.equal(message.heading, 'Gerenciador de Skills')
          assert.equal(message.backupColor, 'rgb(56, 158, 13)')
          assert.equal(message.helpClosed, true)
          assert.equal(message.genericAgentLabel, false)
          assert.equal(message.repeatedCollectionButtons, false)
          assert.ok(message.fontSize >= 15)
          assert.equal(message.searchIconWidth, 20)
          assert.equal(message.searchIconHeight, 20)
          assert.equal(message.searchPlaceholder, 'Buscar skills, tags, agentes...')
          assert.ok(message.filterWidths.every(width => width >= 220))
          assert.ok(message.menuIconGap >= 12)
          assert.equal(message.libraryColor, 'rgb(179, 127, 235)')
          assert.equal(message.libraryIcon, true)
          assert.equal(message.syncVisibleWithoutWarning, true)
        } else if (message.type === 'reviewExternalChanges') {
          assert.equal(stage, 'create')
          externalReviewRequested = true
        } else if (message.type === 'createSkill') {
          if (stage === 'example-empty-add') {
            assert.deepEqual(message, { type: 'createSkill', collectionId: collections[3].id, cardColor: null })
            resolve()
            return
          }
          assert.equal(stage, 'create')
          assert.equal(externalReviewRequested, true)
          assert.deepEqual(message, { type: 'createSkill' })
          skill = {
            id: 'color-test', name: 'Nova Skill', category: 'Geral', description: 'Descricao de teste',
            filePath: 'skills/nova-skill.md', agents: ['GitHub Copilot'], status: 'allowed', tags: ['teste']
          }
          stage = 'select'
          assert.ok(await webview.postMessage(state(skill.id)))
          assert.ok(await webview.postMessage({ type: 'color-test-select' }))
        } else if (message.type === 'color-test-options') {
          assert.equal(stage, 'select')
          assert.equal(message.groupLabel, 'Cor do card')
          assert.equal(message.role, 'combobox')
          assert.equal(message.radioCount, 0)
          assert.equal(message.selectedIndex, 0)
          assert.equal(message.hasCreateColorSelector, false)
          assert.deepEqual(message.labels, [
            'Automatica (categoria)', ...SKILL_CARD_COLORS.map(color => SKILL_CARD_COLOR_LABELS[color])
          ])
          assert.deepEqual(message.swatches, SKILL_CARD_COLORS.map(rgb))
        } else if (message.type === 'saveSkill') {
          assert.equal(message.id, skill.id)
          if (stage === 'select' || stage === 'select-next') {
            assert.equal(message.cardColor, SKILL_CARD_COLORS[colorIndex])
            skill = { ...skill, cardColor: message.cardColor }
            stage = 'manual-saved'
          } else {
            assert.equal(stage, 'reset')
            assert.equal(message.cardColor, null)
            const { cardColor: _cardColor, ...automaticSkill } = skill
            skill = automaticSkill
            stage = 'automatic-saved'
          }
          assert.ok(await webview.postMessage(state(skill.id, true)))
          assert.ok(await webview.postMessage({
            type: 'color-test-after-save',
            expectedLabel: stage === 'manual-saved'
              ? SKILL_CARD_COLOR_LABELS[SKILL_CARD_COLORS[colorIndex]] : 'Automatica (categoria)',
            expectedColor: stage === 'manual-saved' ? rgb(SKILL_CARD_COLORS[colorIndex]) : null
          }))
        } else if (message.type === 'backToDashboard') {
          if (stage === 'manual-saved') {
            stage = 'manual-dashboard'
            assert.ok(await webview.postMessage(state()))
            assert.ok(await webview.postMessage({ type: 'color-test-dashboard-manual' }))
          } else {
            assert.equal(stage, 'automatic-saved')
            stage = 'automatic-dashboard'
            assert.ok(await webview.postMessage(state()))
            assert.ok(await webview.postMessage({ type: 'color-test-dashboard-automatic' }))
          }
        } else if (message.type === 'color-test-manual-card') {
          assert.equal(stage, 'manual-dashboard')
          assert.equal(message.borderColor, rgb(SKILL_CARD_COLORS[colorIndex]))
          assert.equal(message.categoryColor, rgb(SKILL_CARD_COLORS[colorIndex]))
          assert.equal(message.categoryTextColor, rgb(skillCardTextColor(SKILL_CARD_COLORS[colorIndex])))
          assert.notEqual(message.backgroundImage, 'none')
          assert.deepEqual(message.actions, ['Usar no chat', 'Editar', 'Excluir'])
          assert.deepEqual(message.disabledActions, [true, false, false])
          assert.equal(message.actionIconCount, 3)
          assert.deepEqual(message.actionColors.slice(1), [
            'rgb(105, 177, 255)', 'rgb(255, 120, 117)'
          ])
          assert.equal(message.projectReadOnly, true)
          assert.equal(message.allActionButtonsHaveIcons, true)
          assert.equal(message.generalButtonsHaveBorders, true)
          assert.equal(message.cardActionsHaveNoBorders, true)
          assert.equal(message.secondaryButtonsAreRed, true, JSON.stringify(message.secondaryButtonColors))
          assert.equal(message.importMarkdownColor, 'rgb(105, 177, 255)')
          assert.equal(message.newSkillColor, 'rgb(115, 209, 61)')
          assert.ok(message.cardLayouts.every(layout => layout.oneRow && layout.contained),
            JSON.stringify(message.cardLayouts))
          assert.ok(message.gridLayouts.every(layout => layout.columns === 3 && layout.reservedSpace),
            JSON.stringify(message.gridLayouts))
          assert.equal(message.hasProjectSwitch, true)
          assert.equal(message.hasCreateProject, false)
        } else if (message.type === 'openSkill') {
          assert.equal(stage, 'manual-dashboard')
          assert.equal(message.id, skill.id)
          const previousLabel = SKILL_CARD_COLOR_LABELS[SKILL_CARD_COLORS[colorIndex]]
          const hasNextColor = colorIndex < SKILL_CARD_COLORS.length - 1
          if (hasNextColor) colorIndex++
          stage = hasNextColor ? 'select-next' : 'reset'
          assert.ok(await webview.postMessage(state(skill.id)))
          assert.ok(await webview.postMessage({
            type: hasNextColor ? 'color-test-next' : 'color-test-reset',
            previousLabel,
            nextLabel: hasNextColor ? SKILL_CARD_COLOR_LABELS[SKILL_CARD_COLORS[colorIndex]] : undefined
          }))
        } else if (message.type === 'color-test-automatic-card') {
          assert.equal(stage, 'automatic-dashboard')
          assert.equal(colorIndex, SKILL_CARD_COLORS.length - 1)
          assert.equal(message.borderColor, rgb(categoryColor('Geral')))
          assert.equal(message.categoryColor, rgb(categoryColor('Geral')))
          assert.equal(message.backgroundImage, 'none')
          assert.deepEqual(message.disabledActions, [true, false, false])
          assert.equal(message.backgroundColor, 'rgb(27, 27, 27)')
          assert.equal(message.linked, false)
          stage = 'linking'
          assert.ok(await webview.postMessage({ type: 'color-test-toggle-project' }))
        } else if (message.type === 'toggleProjectSkill') {
          assert.equal(message.id, skill.id)
          if (stage === 'agent-filter') {
            assert.equal(message.agent, undefined)
            assert.deepEqual(message.agents, ['Antigravity'])
            stage = 'collection-create'
            assert.ok(await webview.postMessage({ type: 'collection-test-create' }))
            return
          }
          assert.ok(stage === 'linking' || stage === 'unlinking')
          projectLinked = stage === 'linking'
          stage = projectLinked ? 'linked' : 'unlinked'
          assert.ok(await webview.postMessage(state()))
          assert.ok(await webview.postMessage({
            type: 'color-test-project-state',
            linked: projectLinked,
            expectedBackground: projectLinked ? 'rgb(37, 37, 37)' : 'rgb(27, 27, 27)'
          }))
        } else if (message.type === 'color-test-project-card') {
          assert.equal(message.linked, projectLinked)
          assert.equal(message.backgroundColor, projectLinked ? 'rgb(37, 37, 37)' : 'rgb(27, 27, 27)')
          assert.equal(message.borderColor, rgb(categoryColor('Geral')))
          assert.equal(message.categoryColor, rgb(categoryColor('Geral')))
          assert.equal(message.backgroundImage, 'none')
          assert.deepEqual(message.disabledActions, projectLinked
            ? [false, true, true]
            : otherProjectLinked ? [true, true, true] : [true, false, false])
          if (projectLinked) {
            stage = 'unlinking'
            assert.ok(await webview.postMessage({ type: 'color-test-toggle-project' }))
          } else if (stage === 'unlinked') {
            otherProjectLinked = true
            stage = 'other-project'
            assert.ok(await webview.postMessage(state()))
            assert.ok(await webview.postMessage({
              type: 'color-test-project-state',
              linked: false,
              expectedBackground: 'rgb(27, 27, 27)',
              expectedDisabledActions: [true, true, true]
            }))
          } else {
            assert.equal(stage, 'other-project')
            skill.agents = ['GitHub Copilot', 'Antigravity']
            otherProjectLinked = false
            const shared = state()
            shared.projects.projects[0].skillIds = [skill.id]
            shared.projects.projects[0].agentBindings = [{ skillId: skill.id, agent: 'Antigravity' }]
            shared.publishedMarkdown = [skill.id, 'Antigravity:' + skill.id]
            stage = 'agent-filter'
            assert.ok(await webview.postMessage(shared))
            assert.ok(await webview.postMessage({ type: 'agent-test-filter' }))
          }
        } else if (message.type === 'agent-test-cards') {
          assert.equal(message.shared, true)
          assert.equal(message.examplesVisible, false)
          assert.deepEqual(message.cards, [
            { agent: 'GitHub Copilot', active: false }
          ])
        } else if (message.type === 'agent-test-filtered') {
          assert.equal(message.examplesVisible, false)
          assert.equal(message.count, 1)
          assert.equal(message.active, true)
          assert.equal(message.agent, 'Antigravity')
          assert.deepEqual(message.views, ['GitHub Copilot', 'Antigravity'])
        } else if (message.type === 'saveCollection') {
          assert.equal(stage, 'collection-create')
          assert.equal(message.name, 'Quality')
          assert.deepEqual(message.skillIds, [skill.id])
          assert.equal(message.category, 'Geral')
          assert.ok(message.description)
          assert.ok(message.tags.length)
          assert.deepEqual(message.disabledSkillIds, [])
          collections = [{ ...message, id: 'quality' }]
          stage = 'collection-filter'
          assert.ok(await webview.postMessage(state(null, true)))
          assert.ok(await webview.postMessage({ type: 'collection-test-filter' }))
        } else if (message.type === 'toggleCollection') {
          assert.equal(stage, 'collection-filter')
          assert.deepEqual(message, { type: 'toggleCollection', id: 'quality', enabled: true, agents: ['Antigravity'] })
          const { createCardExamples } = require(join(extension.extensionPath, 'dist/documented-examples.js'))
          const categories = ['Geral', 'Arquitetura', 'Git', 'DevOps', 'SEO']
          const examples = createCardExamples(categories)
          assert.deepEqual(examples.cards.map(card => card.skillIds.length), [2, 3, 1, 1])
          // Keep the 0-to-4-member fixture for scroll and empty-card layout coverage.
          const ids = examples.skills.map(item => item.skill.id)
          examples.cards.forEach((card, index) => {
            card.skillIds = [ids.slice(0, 1), ids.slice(1, 5), ids.slice(5, 7), []][index]
          })
          examples.cards[3].name = 'Meu proximo conjunto'
          collections = examples.cards
          stage = 'example-empty-add'
          const exampleState = state()
          exampleState.catalog = { version: 1, categories, collections, skills: examples.skills.map(item => item.skill) }
          exampleState.projects.projects.forEach(project => { project.skillIds = [] })
          assert.ok(await webview.postMessage(exampleState))
          assert.ok(await webview.postMessage({ type: 'example-test-cards' }))
        } else if (message.type === 'example-test-shape') {
          assert.deepEqual(message.counts, [1, 4, 2, 0])
          assert.equal(message.examplesVisible, false)
          assert.equal(message.emptyDisabled, true)
          assert.ok(message.cardHeights.every(height => height >= 400))
          assert.ok(Math.max(...message.cardHeights) - Math.min(...message.cardHeights) <= 1)
          assert.ok(message.cardPaddings.every(padding => padding === '12px'))
          assert.deepEqual(message.horizontalSpacing, {
            grid: '20px', heading: '8px', file: '8px', row: '4px',
            project: '4px', actions: '4px', button: '2px', tag: '4px'
          })
          assert.equal(message.addColor, 'rgb(250, 219, 20)')
          assert.deepEqual(message.skillListScroll.map(item => item.scrollable), [false, false, false, true])
          assert.ok(message.skillListScroll.every(item => item.height === 104 && item.overflowY === 'scroll'))
          assert.ok(message.skillListScroll.every(item => item.railVisible))
          assert.equal(message.gridRowGap, message.horizontalSpacing.grid)
          assert.deepEqual(message.internalSpacing, { tags: '8px', description: '8px', file: '4px', footer: '4px' })
          assert.ok(Math.max(...message.skillBlockHeights) - Math.min(...message.skillBlockHeights) <= 1)
          assert.equal(message.lastSkillReachable, true)
        } else if (message.type === 'color-test-error') {
          reject(new Error(message.message))
        }
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
      ${require('./select-skills.cjs')}
      const firstColorLabel = ${JSON.stringify(SKILL_CARD_COLOR_LABELS[SKILL_CARD_COLORS[0]])};
      const automaticLabel = 'Automatica (categoria)';
      const button = text => Array.from(document.querySelectorAll('button'))
        .find(item => item.textContent.trim() === text && !item.disabled);
      function createItem(label) {
        const create = button('Novo');
        if (!create) return false;
        create.click();
        waitFor('creation menu ' + label, () => {
          const item = Array.from(document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"]'))
            .find(item => (item.querySelector('.menu-description > span')?.textContent ?? item.textContent).trim() === label);
          if (!item) return false;
          item.click();
          return true;
        });
        return true;
      }
      const colorSelect = () => document.getElementById('skill-card-color');
      const colorSelection = () => colorSelect()?.closest('.ant-select')?.querySelector('.ant-select-selection-item');
      const colorOptions = () => Array.from(document.querySelectorAll('#skill-card-color_list [role="option"]'));
      const optionLabel = item => item.querySelector('.ant-select-item-option-content')?.textContent.trim();
      function openColorSelect() {
        const input = colorSelect();
        const selector = input?.closest('.ant-select')?.querySelector('.ant-select-selector');
        if (!selector) return false;
        if (input.getAttribute('aria-expanded') !== 'true') {
          selector.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, button:0}));
        }
        return true;
      }
      function waitFor(description, action) {
        const started = Date.now();
        const timer = setInterval(() => {
          try {
            if (action()) clearInterval(timer);
            else if (Date.now() - started > 8000) {
              clearInterval(timer);
              bridge.postMessage({type:'color-test-error', message:'Timed out waiting for ' + description});
            }
          } catch (error) {
            clearInterval(timer);
            bridge.postMessage({type:'color-test-error', message:String(error)});
          }
        }, 50);
      }
      function saveSelection(label) {
        waitFor('color option ' + label, () => {
          if (colorSelect()?.getAttribute('aria-expanded') !== 'true') return false;
          const option = colorOptions().find(item => optionLabel(item) === label);
          if (!option) return false;
          option.click();
          waitFor('enabled save button', () => {
            const save = button('Salvar');
            if (!save || colorSelection()?.textContent.trim() !== label) return false;
            save.click();
            return true;
          });
          return true;
        });
      }
      function cardAppearance() {
        const card = document.querySelector('.skill-card');
        const category = card?.querySelector('.skill-card-heading + .ant-tag');
        if (!card || !category) return null;
        const grid = document.querySelector('.skills-grid');
        const gridStyle = grid.style.cssText;
        const gridLayouts = [720, 1080, 1600].map(width => {
          grid.style.width = width + 'px';
          const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
          const expected = (grid.getBoundingClientRect().width - 40) / 3;
          return { width, columns, reservedSpace: Math.abs(card.getBoundingClientRect().width - expected) < 1 };
        });
        grid.style.cssText = gridStyle;
        const cardLayouts = [240, 360, 520].map(width => {
          grid.style.width = width + 'px';
          grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
          const bounds = card.getBoundingClientRect();
          const buttons = Array.from(card.querySelectorAll('.skill-card-actions button'));
          const positions = buttons.map(button => button.getBoundingClientRect());
          return {
            width,
            oneRow: positions.every(position => Math.abs(position.top - positions[0].top) < 1),
            contained: positions.every((position, index) => position.left >= bounds.left &&
              position.right <= bounds.right && buttons[index].scrollWidth <= buttons[index].clientWidth)
          };
        });
        grid.style.cssText = gridStyle;
        const actionButtons = Array.from(document.querySelectorAll('main button.action-button'));
        return {
          cardLayouts,
          gridLayouts,
          allActionButtonsHaveIcons: actionButtons.every(button => button.querySelector('svg[aria-hidden="true"]')),
          generalButtonsHaveBorders: actionButtons.filter(button => !button.closest('.skill-card-actions') && !button.disabled)
            .every(button => parseFloat(getComputedStyle(button).borderTopWidth) > 0),
          cardActionsHaveNoBorders: Array.from(card.querySelectorAll('.skill-card-actions button'))
            .every(button => parseFloat(getComputedStyle(button).borderTopWidth) === 0),
          secondaryButtonsAreRed: actionButtons.filter(button => !button.closest('.skill-card-actions') &&
              !button.matches('.action-save, .action-backup, .action-restore, .action-library, .import-markdown-button, .new-skill-button') && !button.disabled)
            .every(button => getComputedStyle(button).color === 'rgb(255, 120, 117)'),
          secondaryButtonColors: actionButtons.filter(button => !button.closest('.skill-card-actions') &&
              !button.matches('.action-save, .action-backup, .action-restore, .action-library, .import-markdown-button, .new-skill-button') && !button.disabled)
            .map(button => ({label: button.textContent, color: getComputedStyle(button).color})),
          importMarkdownColor: getComputedStyle(document.querySelector('.import-markdown-button')).color,
          newSkillColor: getComputedStyle(document.querySelector('.new-skill-button')).color,
          borderColor: getComputedStyle(card).borderTopColor,
          backgroundColor: getComputedStyle(card).backgroundColor,
          backgroundImage: getComputedStyle(card).backgroundImage,
          linked: card.classList.contains('skill-card-linked'),
          categoryColor: getComputedStyle(category).backgroundColor,
          categoryTextColor: getComputedStyle(category).color,
          actions: Array.from(card.querySelectorAll('.skill-card-actions button'))
            .map(item => item.textContent.trim()),
          disabledActions: Array.from(card.querySelectorAll('.skill-card-actions button'))
            .map(item => item.disabled),
          actionIconCount: card.querySelectorAll('.skill-card-actions button svg[aria-hidden="true"]').length,
          actionColors: Array.from(card.querySelectorAll('.skill-card-actions button'))
            .map(item => getComputedStyle(item).color),
          projectReadOnly: document.querySelector('input[aria-label="Projeto ativo"]')?.readOnly === true,
          hasCreateProject: Boolean(document.querySelector('input[placeholder="Novo Projeto"]')) ||
            Array.from(document.querySelectorAll('button')).some(item => item.textContent.trim() === 'Criar projeto'),
          hasProjectSwitch: Boolean(card.querySelector('[role="switch"]'))
        };
      }
      window.addEventListener('message', event => {
        if (event.data.type === 'example-test-cards') {
          waitFor('four example cards with exact member counts', () => {
            const cards = Array.from(document.querySelectorAll('.skill-card'));
            if (cards.length !== 4 || !cards[3].textContent.includes('Meu proximo conjunto')) return false;
            const add = cards[3].querySelector('.action-add');
            if (!add || add.disabled || getComputedStyle(add).color !== 'rgb(250, 219, 20)') return false;
            const counts = cards.map(card => card.querySelectorAll('.skill-file button[title="Editar Markdown desta skill"]').length);
            const list = cards[1].querySelector('.card-skill-list');
            const rows = Array.from(list.children);
            const skillListScroll = [1, 2, 3, 4].map(count => {
              rows.forEach((row, index) => { row.style.display = index < count ? '' : 'none'; });
              return { height: list.clientHeight, scrollable: list.scrollHeight > list.clientHeight,
                overflowY: getComputedStyle(list).overflowY,
                railVisible: getComputedStyle(list).backgroundImage.includes('linear-gradient') &&
                  getComputedStyle(list, '::-webkit-scrollbar').width === '8px' };
            });
            rows.forEach(row => { row.style.display = ''; });
            list.scrollTop = list.scrollHeight;
            const lastSkillReachable = rows[3].getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1;
            bridge.postMessage({ type: 'example-test-shape', counts,
              skillListScroll, lastSkillReachable,
              skillBlockHeights: cards.slice(0, 3).map(card => card.querySelector('.skill-file').getBoundingClientRect().height),
              examplesVisible: Boolean(button('Carregar exemplos')),
              cardHeights: cards.map(card => card.offsetHeight),
              cardPaddings: cards.map(card => getComputedStyle(card.querySelector('.ant-card-body')).padding),
              gridRowGap: getComputedStyle(document.querySelector('.skills-grid')).rowGap,
              internalSpacing: {
                tags: getComputedStyle(cards[1].querySelector('.skill-tags')).marginTop,
                description: getComputedStyle(cards[1].querySelector('.skill-description')).marginTop,
                file: getComputedStyle(cards[1].querySelector('.skill-file')).rowGap,
                footer: getComputedStyle(cards[1].querySelector('.skill-card-footer')).rowGap
              },
              horizontalSpacing: {
                grid: getComputedStyle(document.querySelector('.skills-grid')).columnGap,
                heading: getComputedStyle(cards[1].querySelector('.skill-card-heading')).columnGap,
                file: getComputedStyle(cards[1].querySelector('.skill-file')).paddingLeft,
                row: getComputedStyle(rows[0]).columnGap,
                project: getComputedStyle(cards[1].querySelector('.skill-card-project')).columnGap,
                actions: getComputedStyle(cards[1].querySelector('.skill-card-actions')).columnGap,
                button: getComputedStyle(add).paddingLeft,
                tag: getComputedStyle(cards[1].querySelector('.ant-tag')).paddingLeft
              },
              addColor: getComputedStyle(add).color,
              emptyDisabled: cards[3].querySelector('[role="switch"]').disabled });
            add.click();
            return true;
          });
        } else if (event.data.type === 'collection-test-create') {
          waitFor('new collection button', () => {
            const create = button('Novo');
            if (!create) return false;
            createItem('Novo card');
            waitFor('collection editor', () => {
              const name = document.querySelector('[aria-label="Nome da colecao"]');
              const members = document.querySelector('[aria-label="Skills da colecao"]');
              if (!name || !members) return false;
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Quality');
              name.dispatchEvent(new Event('input', { bubbles: true }));
              members.closest('.ant-select').querySelector('.ant-select-selector')
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              waitFor('collection member option', () => {
                const option = Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'))
                  .find(item => item.textContent.trim() === 'Nova Skill');
                if (!option) return false;
                option.click();
                waitFor('save collection', () => {
                  const save = button('Salvar');
                  if (!save || !members.closest('.ant-select').querySelector('.ant-select-selection-item')) return false;
                  const selector = document.querySelector('[aria-label="Selecao de skills do card"]');
                  const checkbox = selector?.querySelector('input[type="checkbox"]');
                  if (!checkbox || !checkbox.checked || !selector.textContent.includes('Nova Skill')) {
                    throw new Error('Card editor must show newly added skills selected in the sidebar');
                  }
                  const layout = document.querySelector('.card-editor-layout');
                  const form = layout.querySelector('.card-form');
                  const modal = layout.closest('.ant-modal');
                  const body = modal.querySelector('.ant-modal-body');
                  if (selector.parentElement !== layout || form.parentElement !== layout) {
                    throw new Error('Card fields and skill sidebar must occupy separate layout columns');
                  }
                  if (layout.scrollWidth > body.clientWidth + 1 ||
                      modal.querySelector('.ant-modal-content').getBoundingClientRect().bottom > innerHeight + 1) {
                    throw new Error('Card modal must fit the viewport without horizontal overflow');
                  }
                  body.scrollTop = body.scrollHeight;
                  if (selector.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1 ||
                      members.closest('.ant-select').getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1) {
                    throw new Error('Card modal must allow scrolling to the last field and skill selection');
                  }
                  save.click();
                  return true;
                });
                return true;
              });
              return true;
            });
            return true;
          });
        } else if (event.data.type === 'collection-test-filter') {
          waitFor('collection filter', () => {
            const filter = document.querySelector('[aria-label="Filtrar por colecao"]');
            if (!filter) return false;
            filter.closest('.ant-select').querySelector('.ant-select-selector')
              .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            waitFor('collection option', () => {
              const option = Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'))
                .find(item => item.textContent.trim() === 'Quality (1)');
              if (!option) return false;
              option.click();
              waitFor('activate collection', () => {
                const activate = document.querySelector('.skill-card [role="switch"]');
                if (!activate || document.querySelectorAll('.skill-card').length !== 1) return false;
                activate.click();
                return true;
              });
              return true;
            });
            return true;
          });
        } else if (event.data.type === 'agent-test-filter') {
          waitFor('one shared skill card', () => {
            const cards = Array.from(document.querySelectorAll('.skill-card'));
            if (cards.length !== 1) return false;
            bridge.postMessage({ type: 'agent-test-cards', cards: cards.map(card => ({
              agent: card.querySelector('.agent-label').textContent.trim(),
              active: card.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true'
            })), shared: cards.every(card => card.querySelector('[aria-label="Compatibilidade da skill"]')),
              examplesVisible: Boolean(button('Carregar exemplos')) });
            const views = [];
            const originalTitle = cards[0].querySelector('h5').textContent;
            function selectView(label, next) {
              const filter = document.querySelector('[aria-label="Visualizar por agente"]');
              filter.closest('.ant-select').querySelector('.ant-select-selector')
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              waitFor('agent view option ' + label, () => {
                const option = Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'))
                  .find(item => item.textContent.trim() === label);
                if (!option) return false;
                option.click();
                waitFor('shared card in view ' + label, () => {
                  const selected = filter.closest('.ant-select').querySelector('.ant-select-selection-item');
                  const visible = Array.from(document.querySelectorAll('.skill-card'));
                  if (selected?.textContent.trim() !== label || visible.length !== 1) return false;
                  const expectedActive = label === 'Antigravity' ? 'true' : 'false';
                  const labels = Array.from(visible[0].querySelectorAll('.agent-label')).map(tag => tag.textContent.trim());
                  if (visible[0].querySelector('h5').textContent !== originalTitle ||
                      visible[0].querySelector('[role="switch"]').getAttribute('aria-checked') !== expectedActive ||
                      labels.length !== 1 || labels[0] !== label) {
                    throw new Error('Agent view must display and control only the selected destination');
                  }
                  views.push(label);
                  next(visible[0]);
                  return true;
                });
                return true;
              });
            }
            selectView('GitHub Copilot', () => selectView('Antigravity', card => {
              const toggle = card.querySelector('[role="switch"]');
              bridge.postMessage({
                type: 'agent-test-filtered', count: 1, views,
                examplesVisible: Boolean(button('Carregar exemplos')),
                agent: card.querySelector('.agent-label').textContent.trim(),
                active: toggle.getAttribute('aria-checked') === 'true'
              });
              toggle.click();
            }));
            return true;
          });
        } else if (event.data.type === 'color-test-create') {
          waitFor('new skill button', () => {
            const create = button('Novo');
            if (!create) return false;
            bridge.postMessage({ type: 'first-use-examples-visible', visible: Boolean(button('Carregar exemplos')) });
            const help = document.querySelector('[aria-label="Sobre o gerenciador"]');
            help.focus();
            waitFor('manager help tooltip', () => {
              const tooltip = document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)');
              if (!tooltip || !tooltip.textContent.includes('O switch controla')) return false;
              help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              help.blur();
              waitFor('closed help tooltip', () => {
                if (document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)')) return false;
                button('Biblioteca').click();
                waitFor('vault menu', () => {
                  const backup = document.querySelector('.vault-menu-backup');
                  if (!backup) return false;
                  bridge.postMessage({
                    type: 'manager-chrome',
                    heading: document.querySelector('.library-heading h2').textContent.trim(),
                    backupColor: getComputedStyle(backup).color,
                    libraryColor: getComputedStyle(button('Biblioteca')).color,
                    libraryIcon: Boolean(button('Biblioteca').querySelector('.ant-btn-icon svg')),
                    syncVisibleWithoutWarning: Boolean(button('Sincronizar')) && !document.querySelector('.ant-alert-warning'),
                    genericAgentLabel: Array.from(document.querySelectorAll('.skill-file .ant-tag'))
                      .some(tag => tag.textContent.trim() === 'Agent Skills'),
                    helpClosed: !document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)'),
                    repeatedCollectionButtons: Boolean(button('Editar colecao') || button('Ativar colecao') || button('Desativar colecao')),
                    menuIconGap: parseFloat(getComputedStyle(backup.closest('[role="menuitem"]')).columnGap),
                    fontSize: parseFloat(getComputedStyle(document.querySelector('input[aria-label="Buscar skills"]')).fontSize),
                    searchIconWidth: document.querySelector('.search-input .ant-input-prefix svg').getBoundingClientRect().width,
                    searchIconHeight: document.querySelector('.search-input .ant-input-prefix svg').getBoundingClientRect().height,
                    searchPlaceholder: document.querySelector('input[aria-label="Buscar skills"]').placeholder,
                    filterWidths: Array.from(document.querySelectorAll('.filter-select')).map(item => item.getBoundingClientRect().width)
                  });
                  button('Biblioteca').click();
                  button('Sincronizar').click();
                  window.dispatchEvent(new MessageEvent('message', { data: {
                    type: 'externalChanges', externalChanges: [{ skillId: 'external', name: 'External', libraryChanged: true, publications: 1 }]
                  } }));
                  waitFor('external changes warning and review action', () => {
                    const review = button('Revisar alteracoes');
                    if (!review || !document.querySelector('.ant-alert-warning')?.textContent.includes('Alteracoes externas')) return false;
                    review.click();
                    window.dispatchEvent(new MessageEvent('message', { data: { type: 'externalChanges', externalChanges: [] } }));
                    createItem('Nova Skill');
                    return true;
                  });
                  return true;
                });
                return true;
              });
              return true;
            });
            return true;
          });
        } else if (event.data.type === 'color-test-select') {
          waitFor('color selector', () => {
            const input = colorSelect();
            if (!input || colorSelection()?.textContent.trim() !== automaticLabel || !openColorSelect()) return false;
            waitFor('color choices', () => {
              const options = colorOptions();
              if (input.getAttribute('aria-expanded') !== 'true' || options.length !== 11) return false;
              bridge.postMessage({
                type:'color-test-options',
                groupLabel: document.querySelector('label[for="skill-card-color"]')?.textContent.trim(),
                role: input.getAttribute('role'),
                radioCount: input.closest('.ant-col').querySelectorAll('input[type="radio"]').length,
                selectedIndex: options.findIndex(item => item.getAttribute('aria-selected') === 'true'),
                hasCreateColorSelector: Boolean(document.getElementById('new-skill-card-color')),
                labels: options.map(optionLabel),
                swatches: options.slice(1).map(item => {
                  const swatch = item.querySelector('.skill-color-swatch[aria-hidden="true"]');
                  return swatch ? getComputedStyle(swatch).backgroundColor : null;
                })
              });
              saveSelection(firstColorLabel);
              return true;
            });
            return true;
          });
        } else if (event.data.type === 'color-test-after-save') {
          waitFor('saved editor state', () => {
            const selected = colorSelection();
            const back = button('Voltar ao Dashboard');
            const enabledSave = button('Salvar');
            if (!selected || selected.textContent.trim() !== event.data.expectedLabel || !back || enabledSave) return false;
            const saveButtons = Array.from(document.querySelectorAll('button')).filter(item => item.textContent.trim() === 'Salvar');
            if (saveButtons.length !== 1 || saveButtons[0].closest('.editor-top-actions') !== back.closest('.editor-top-actions')) {
              throw new Error('Editor must have one Save button next to Back');
            }
            if (!saveButtons[0].closest('.editor-heading') || back.closest('.topbar')) {
              throw new Error('Save and Back must be on the Editing heading row');
            }
            const heading = document.querySelector('.editor-heading h3').getBoundingClientRect();
            if (Math.abs(saveButtons[0].getBoundingClientRect().top - heading.top) > 10) {
              throw new Error('Editor actions are not aligned with the Editing title');
            }
            if (document.getElementById('skill-agents').closest('.ant-select').getBoundingClientRect().width < 220) {
              throw new Error('Agent compatibility selector is too narrow to read');
            }
            if (getComputedStyle(back).color !== 'rgb(105, 177, 255)') return false;
            const swatch = selected.querySelector('.skill-color-swatch');
            if (event.data.expectedColor &&
                (!swatch || getComputedStyle(swatch).backgroundColor !== event.data.expectedColor)) return false;
            if (!event.data.expectedColor && swatch) return false;
            back.click();
            return true;
          });
        } else if (event.data.type === 'color-test-dashboard-manual') {
          waitFor('colored card', () => {
            const appearance = cardAppearance();
            const edit = button('Editar');
            if (!appearance || !edit || !appearance.secondaryButtonsAreRed ||
                appearance.importMarkdownColor !== 'rgb(105, 177, 255)' ||
                appearance.newSkillColor !== 'rgb(115, 209, 61)') return false;
            bridge.postMessage({type:'color-test-manual-card', ...appearance});
            edit.click();
            return true;
          });
        } else if (event.data.type === 'color-test-next' || event.data.type === 'color-test-reset') {
          waitFor('restored color selection', () => {
            const selected = colorSelection();
            if (!selected || selected.textContent.trim() !== event.data.previousLabel || !openColorSelect()) return false;
            saveSelection(event.data.nextLabel ?? automaticLabel);
            return true;
          });
        } else if (event.data.type === 'color-test-dashboard-automatic') {
          waitFor('automatic card', () => {
            const appearance = cardAppearance();
            if (!appearance) return false;
            bridge.postMessage({type:'color-test-automatic-card', ...appearance});
            return true;
          });
        } else if (event.data.type === 'color-test-toggle-project') {
          waitFor('project switch', () => {
            const toggle = document.querySelector('.skill-card [role="switch"]');
            if (!toggle || toggle.disabled) return false;
            toggle.click();
            return true;
          });
        } else if (event.data.type === 'color-test-project-state') {
          waitFor('project card highlighting', () => {
            const appearance = cardAppearance();
            if (!appearance || appearance.linked !== event.data.linked ||
                appearance.backgroundColor !== event.data.expectedBackground ||
                (event.data.expectedDisabledActions &&
                  JSON.stringify(appearance.disabledActions) !== JSON.stringify(event.data.expectedDisabledActions))) return false;
            bridge.postMessage({type:'color-test-project-card', ...appearance});
            return true;
          });
        }
      });
    </script><script type="module" nonce="${nonce}" src="${script}"></script>
    </body></html>`

  try {
    await result
  } finally {
    clearTimeout(timeout)
    listener.dispose()
    panel.dispose()
  }
}
