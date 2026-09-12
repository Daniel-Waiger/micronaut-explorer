// Shared clipboard-copy helper. Extracted from ui/steps/naming.js (its
// "Copy full name" button), which had the only implementation of this until
// shell.js's "Copy feedback report" button (Wave 1 of alpha-pilot-
// readiness) needed the exact same fallback behavior -- one implementation,
// not two independently-maintained copies of the same file:// workaround.

/**
 * Copy `text` to the clipboard. navigator.clipboard can be restricted under
 * file:// or by permissions policy even when it exists, so fall back to the
 * classic hidden-textarea + execCommand('copy') trick.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback
    }
  }
  // select() below moves focus onto the textarea (that's what lets
  // execCommand('copy') read it), and removing the focused node afterward
  // drops focus to <body> -- silently stealing focus from whatever the user
  // had focused (e.g. the button they clicked) for every caller of this
  // fallback, not just the feedback handoff modal (lesson 44: fix the class,
  // not one instance). Save and restore it around the fallback.
  const previouslyFocused = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  if (previouslyFocused && previouslyFocused !== document.body && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus();
  }
  return ok;
}
