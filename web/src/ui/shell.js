// App shell: header, left step nav, main content mount, theme toggle, and a
// toast/status area. Vanilla DOM only -- every node is built with
// createElement/textContent, never innerHTML with dynamic or user data.

const THEME_KEY = 'micronaut.theme';

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage is a convenience; a failed write here only means the
    // toggle won't persist across reloads, which isn't worth surfacing.
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function osPrefersLight() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function renderShell(root, store, router, { onReset } = {}) {
  root.textContent = '';

  const header = document.createElement('header');
  header.className = 'shell-header';

  const title = document.createElement('div');
  title.className = 'shell-title';
  title.textContent = 'Micronaut Planner';
  header.appendChild(title);

  const themeToggle = document.createElement('button');
  themeToggle.type = 'button';
  themeToggle.className = 'theme-toggle';
  // Only stamp data-theme when the user has made an EXPLICIT choice before.
  // Stamping it unconditionally (even to 'dark', matching the app's own
  // :root default) would always win over the
  // @media (prefers-color-scheme: light) rule, so a first-time visitor on a
  // light-OS machine would always see dark regardless of their system
  // preference -- the toggle is meant to override the OS default, not
  // replace it before the user has ever touched it.
  const storedTheme = loadTheme();
  if (storedTheme) {
    applyTheme(storedTheme);
  }
  let currentTheme = storedTheme || (osPrefersLight() ? 'light' : 'dark');
  themeToggle.textContent = currentTheme === 'dark' ? 'Light mode' : 'Dark mode';
  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
    saveTheme(currentTheme);
    themeToggle.textContent = currentTheme === 'dark' ? 'Light mode' : 'Dark mode';
  });
  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';

  // Everything is autosaved to localStorage, so a page refresh deliberately
  // RESTORES the previous session rather than clearing it. That is the right
  // default (nobody wants to lose a design to a stray F5) but it leaves no
  // way to start a genuinely new experiment -- hence an explicit control.
  // Confirmed, because it is destructive and unrecoverable.
  if (onReset) {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'theme-toggle reset-button';
    resetBtn.textContent = 'Start over';
    resetBtn.title = 'Discard this experiment and start from an empty one';
    resetBtn.addEventListener('click', () => {
      const ok = window.confirm(
        'Discard the current experiment and start over?\n\nThis clears every answer, factor, and naming field. It cannot be undone.'
      );
      if (ok) onReset();
    });
    headerActions.appendChild(resetBtn);
  }

  headerActions.appendChild(themeToggle);
  header.appendChild(headerActions);

  const body = document.createElement('div');
  body.className = 'shell-body';

  const nav = document.createElement('nav');
  nav.className = 'shell-nav';
  nav.setAttribute('aria-label', 'Steps');

  const main = document.createElement('main');
  main.className = 'shell-main';

  body.appendChild(nav);
  body.appendChild(main);

  const status = document.createElement('div');
  status.className = 'shell-status';
  status.setAttribute('role', 'status');

  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(status);

  function renderNav(activeId) {
    nav.textContent = '';
    for (const step of router.steps) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-step' + (step.id === activeId ? ' active' : '');
      btn.textContent = step.title || step.id;
      btn.addEventListener('click', () => router.navigate(step.id));
      nav.appendChild(btn);
    }
  }

  router.onChange((activeId) => renderNav(activeId));
  renderNav(router.current());

  let toastTimer = null;
  function showToast(message) {
    status.textContent = message;
    status.classList.add('visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => status.classList.remove('visible'), 3000);
  }

  return { main, showToast };
}
