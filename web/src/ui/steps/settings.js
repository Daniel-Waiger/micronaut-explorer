function settingsButton(label, onClick, className = 'copy-button') { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.addEventListener('click', onClick); return node; }
export const settingsStep = {
  id: 'settings', title: 'Settings', utility: true,
  render(main, store, options = {}) {
    main.textContent = '';
    const title = document.createElement('h1'); title.className = 'step-heading'; title.textContent = 'Settings';
    const intro = document.createElement('p'); intro.className = 'proposals-empty supporting-description'; intro.textContent = 'Project backups, recovery, and display preferences are kept here.';
    const actions = document.createElement('div'); actions.className = 'overview-secondary-actions';
    actions.append(settingsButton('Download project backup', () => options.onExportProject?.()));
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.addEventListener('change', () => { const selected = file.files?.[0]; file.value = ''; if (selected) Promise.resolve(options.onImportProject?.(selected)); });
    actions.append(settingsButton('Import project backup', () => file.click()), file);
    actions.append(settingsButton('Start a blank study', () => { if (window.confirm('Start a blank study? Your current work remains available in Restore.')) options.onNewBlank?.(); }));
    main.append(title, intro, actions);
  },
};
