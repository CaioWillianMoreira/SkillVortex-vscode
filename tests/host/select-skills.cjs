module.exports = `
  const selectSkills = new MutationObserver(() => {
    const choice = Array.from(document.querySelectorAll('.area-chooser button'))
      .find(button => button.textContent === 'Abrir SkillVortex');
    if (choice) { selectSkills.disconnect(); choice.click(); }
  });
  selectSkills.observe(document.getElementById('root'), { childList: true, subtree: true });
`
