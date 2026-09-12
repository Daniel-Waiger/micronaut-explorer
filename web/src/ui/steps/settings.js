import { APP_VERSION } from '../../core/version.js';

// Milliseconds an "armed" (first-click) clear-storage button waits for the
// confirming second click before disarming itself back to its normal label.
// A generous window, not a strict double-click: the whole point of arming
// rather than a single window.confirm() is to make the destructive click a
// deliberate SECOND decision, not a race against a dialog timer.
const CLEAR_STORAGE_ARM_MS = 6000;

function settingsButton(label, onClick, className = 'copy-button') { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.addEventListener('click', onClick); return node; }

/**
 * A two-click "are you sure" button, for an action too destructive for the
 * plain window.confirm() used elsewhere in this app (New study / Restore
 * both explicitly say "your current work remains available in Restore" --
 * clearing storage is the one action that is NOT true for, since it deletes
 * the restore ring itself). Reset to example used to belong in that same
 * list -- back when opening the example replaced whatever study was on
 * screen, its confirm dialog carried the identical promise. Now that opening
 * the example opens the separate practice tab (?demo=1, core/storageScope.js)
 * instead, it never touches the study open here at all, so there is nothing
 * for it to promise about this tab's work and it no longer belongs in this
 * comparison. There is no confirm-modal framework in this codebase to reach
 * for instead, and this needs no new dependency: the button's own label and
 * class carry the "armed" state, and a timer disarms it if the second click
 * never comes.
 */
function armedButton(label, armedLabel, onConfirm) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'copy-button settings-danger-button';
  node.textContent = label;
  let armed = false;
  let disarmTimer = null;
  function disarm() {
    armed = false;
    node.classList.remove('is-armed');
    node.textContent = label;
    if (disarmTimer) { window.clearTimeout(disarmTimer); disarmTimer = null; }
  }
  node.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      node.classList.add('is-armed');
      node.textContent = armedLabel;
      disarmTimer = window.setTimeout(disarm, CLEAR_STORAGE_ARM_MS);
      return;
    }
    disarm();
    onConfirm();
  });
  return node;
}

export const settingsStep = {
  id: 'settings', title: 'Settings', utility: true,
  render(main, store, options = {}) {
    main.textContent = '';
    const title = document.createElement('h1'); title.className = 'step-heading'; title.textContent = 'Settings';
    const intro = document.createElement('p'); intro.className = 'proposals-empty supporting-description'; intro.textContent = 'Project backups and storage management are kept here. Restore (previous saved versions) and the color theme are in the header/nav Utilities menu.';
    const actions = document.createElement('div'); actions.className = 'overview-secondary-actions';
    actions.append(settingsButton('Project backup (.micronaut.json, importable)', () => options.onExportProject?.()));
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.addEventListener('change', () => { const selected = file.files?.[0]; file.value = ''; if (selected) Promise.resolve(options.onImportProject?.(selected)); });
    actions.append(settingsButton('Import project backup', () => file.click()), file);
    actions.append(settingsButton('Start a blank study', () => { if (window.confirm('Start a blank study? Your current work remains available in Restore.')) options.onNewBlank?.(); }));
    if (options.onClearAllStorage) {
      actions.append(armedButton(
        'Clear all stored data',
        'Click again to permanently clear all stored data',
        () => options.onClearAllStorage()
      ));
    }
    const storageNote = document.createElement('p');
    storageNote.className = 'proposals-empty supporting-description';
    storageNote.textContent = 'Clearing stored data removes every locally saved version (Restore), walkthrough progress and onboarding answers for this tab, and frees up storage space if it is full or corrupted. Theme is kept. It does not affect the study currently open — download a project backup first if you want to keep it.';
    const version = document.createElement('p');
    version.className = 'proposals-empty supporting-description';
    version.textContent = `Version ${APP_VERSION}`;
    main.append(title, intro, actions, storageNote, version);
  },
};
