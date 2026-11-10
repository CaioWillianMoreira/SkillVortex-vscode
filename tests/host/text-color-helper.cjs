module.exports = `
  const applyTextColor = async (text, color) => {
    const editor = document.querySelector('.tiptap');
    editor.focus();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node, found = false;
    while (node = walker.nextNode()) {
      const index = node.textContent.indexOf(text);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index); range.setEnd(node, index + text.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      found = true; break;
    }
    if (!found) throw new Error('Text to color not found: ' + text);
    await wait('text color button', () => document.querySelector('button[aria-label="Cor do texto"]'));
    document.querySelector('button[aria-label="Cor do texto"]').click();
    await wait('color dialog', () => document.querySelector('input[aria-label="Codigo da cor"]'));
    const input = document.querySelector('input[aria-label="Codigo da cor"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait('color input updated', () => input.value === color);
    Array.from(document.querySelectorAll('.ant-modal button')).find(button => button.textContent === 'Aplicar cor').click();
    await wait('colored selected text', () => Array.from(document.querySelectorAll('.tiptap span[style]'))
      .some(span => span.textContent === text && span.style.color));
  };
`
