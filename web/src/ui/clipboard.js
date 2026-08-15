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
  return ok;
}
