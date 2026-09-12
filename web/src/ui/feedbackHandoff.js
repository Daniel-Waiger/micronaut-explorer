import { copyToClipboard } from './clipboard.js';
import { downloadTextFile } from '../core/persist.js';
import { openInNewTab } from './newTab.js';

// GitHub's "new issue" form reads `labels` from its own query string and
// pre-applies it. This is the whole mechanism: it turns "issues opened from
// the app" into a filterable, linkable group inside the repo -- effectively a
// feedback folder -- with no server, no token, and no new dependency. Because
// the sign-in redirect (githubFeedbackUrl below) carries this whole path as
// its OWN query value, the label has to be encoded into the path string here
// rather than appended after building the login URL, or GitHub would receive
// `return_to=/…/issues/new` with the label silently dropped.
const GITHUB_ISSUE_PATH = '/Daniel-Waiger/micronaut-explorer/issues/new?labels=feedback';

// The address feedback email is addressed to. Deliberately blank until a real
// non-personal inbox exists: a `mailto:` with no recipient opens an empty
// compose window, which reads as a working button and silently loses every
// message sent through it. While this is blank the Email action is not
// rendered at all -- see feedbackEmailAvailable() and ui/steps/feedback.js.
// Fill this in (a shared/team address, NOT a GitHub `@users.noreply` one,
// which discards incoming mail) to turn the action back on.
export const FEEDBACK_EMAIL = '';

export function githubFeedbackUrl() {
  return `https://github.com/login?return_to=${encodeURIComponent(GITHUB_ISSUE_PATH)}`;
}

export function feedbackEmailAvailable(address = FEEDBACK_EMAIL) {
  return typeof address === 'string' && address.trim() !== '';
}

// The address is a parameter (defaulting to the module constant) purely so the
// configured and unconfigured branches are both reachable from a test without
// a build-time injection mechanism. Production call sites pass nothing.
export function emailFeedbackUrl(address = FEEDBACK_EMAIL) {
  if (!feedbackEmailAvailable(address)) return null;
  // `@` is legal and expected in a mailto recipient; encodeURIComponent escapes
  // it to %40, which most clients tolerate but none require. Restore it so the
  // address reads correctly in the URL and in any client that shows it raw.
  const recipient = encodeURIComponent(address.trim()).replace(/%40/g, '@');
  return `mailto:${recipient}?subject=${encodeURIComponent('Micronaut Planner feedback')}`;
}

// Each channel's copy describes what happens when the clipboard write
// SUCCEEDS. `proceedLabel`/`destination` channels (email, github) also carry
// `copyFailedDetail`: the text shown when the copy is denied but the
// destination and a manual download are still reachable (R5-02, V2-NEW-02).
// The `download` channel is handled separately below -- its outcome depends
// only on whether the download itself succeeded, never on the copy.
const CHANNELS = {
  copy: {
    title: 'Feedback package copied',
    detail: 'Paste it into the message, form, or issue where you want to share feedback. Nothing has been sent automatically.',
  },
  download: {
    copiedTitle: 'Feedback package downloaded and copied',
    copiedDetail: 'Attach the downloaded micronaut-feedback.txt file, or paste the copied package into the place you are sharing feedback. Nothing has been sent automatically.',
    title: 'Feedback package downloaded',
    detail: 'Attach the downloaded micronaut-feedback.txt file where you are sharing feedback. Nothing has been sent automatically.',
  },
  email: {
    title: 'Feedback package copied',
    detail: 'Open your email app, start a message to the team, and paste the copied package into the message body. The app does not place your feedback or study in the email link.',
    proceedLabel: 'Open email app',
    destination: emailFeedbackUrl,
    copyFailedDetail: 'The package could not be copied automatically — download it below and attach it to the message, or paste it after you download.',
  },
  github: {
    title: 'Feedback package copied',
    detail: 'Sign in to GitHub if needed, then paste the copied package into the new issue. The GitHub link contains no feedback, browser details, or study data.',
    proceedLabel: 'Open GitHub issue',
    destination: githubFeedbackUrl,
    copyFailedDetail: 'The package could not be copied automatically — download it below and attach it to the issue, or paste it after you download.',
  },
};

function removeModal(backdrop, dialog, previouslyFocused, onKeydown) {
  window.removeEventListener('keydown', onKeydown);
  backdrop.remove();
  dialog.remove();
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
}

// Resolve what the modal should say/offer for one (channel, copied) pair.
// Kept separate from the DOM-building code below so the outcome logic --
// the part R5-02/V2-NEW-02/V5-NEW-01/R2-11 are actually about -- can be
// read (and tested) without wading through element construction.
function resolveOutcome(channel, copied) {
  const config = CHANNELS[channel] || CHANNELS.copy;
  if (channel === 'download') {
    return {
      title: copied ? config.copiedTitle : config.title,
      detail: copied ? config.copiedDetail : config.detail,
      showProceed: false,
      showDownloadFallback: false,
    };
  }
  if (copied) {
    return { title: config.title, detail: config.detail, showProceed: Boolean(config.proceedLabel), showDownloadFallback: false };
  }
  if (config.proceedLabel) {
    // Copy failed, but the destination (GitHub/email) and a manual download
    // of the same package are still reachable -- never a dead end (R5-02).
    return { title: 'Could not copy the feedback package', detail: config.copyFailedDetail, showProceed: true, showDownloadFallback: true };
  }
  // The plain 'copy' channel (e.g. the header's "Copy feedback report") has
  // no destination of its own, but it must still offer the SAME in-modal
  // download fallback the other channels get -- never point the user at
  // "Download feedback package" as if it were a control they can reach from
  // here, when the only place that button actually exists is the #/feedback
  // page (R5-02/R2-11: no dead end, no advice naming an action the user
  // cannot take from where they are).
  return {
    title: 'Could not copy the feedback package',
    detail: 'Your browser did not allow the package to be copied. Download it below, then attach or paste that file where you are sharing feedback.',
    showProceed: false,
    showDownloadFallback: true,
  };
}

export function showFeedbackHandoffModal({ channel, copied, onOpen, onDownload, previouslyFocused: opener } = {}) {
  const config = CHANNELS[channel] || CHANNELS.copy;
  const outcome = resolveOutcome(channel, copied);
  // Callers that go through handoffFeedback() pass the element focused
  // BEFORE the copy attempt (captured there ahead of its first await) --
  // that is the only reliable "opener" to restore to (D2-P1: by the time
  // this function runs, clipboard.js's execCommand fallback may already have
  // moved focus to a throwaway <textarea> and back off it to <body>). Fall
  // back to document.activeElement only for a caller that did not pass one.
  const previouslyFocused = opener !== undefined ? opener : document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'feedback-handoff-backdrop';
  const dialog = document.createElement('section');
  dialog.className = 'feedback-handoff-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'feedback-handoff-title');
  dialog.setAttribute('aria-describedby', 'feedback-handoff-description');
  const title = document.createElement('h2');
  title.id = 'feedback-handoff-title';
  title.className = 'step-heading';
  title.textContent = outcome.title;
  const description = document.createElement('p');
  description.id = 'feedback-handoff-description';
  description.className = 'feedback-handoff-description';
  description.textContent = outcome.detail;
  const actions = document.createElement('div');
  actions.className = 'feedback-handoff-actions';
  // Tab-trap target list, in DOM order, built as controls are added below --
  // no querySelectorAll needed, and it can never drift from what is actually
  // rendered (lesson 20: verify the mechanism against what is really there).
  const focusable = [];
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'shell-utility-action';
  close.textContent = outcome.showProceed ? 'Not now' : 'Done';
  let onKeydown = () => {};
  const closeModal = () => removeModal(backdrop, dialog, previouslyFocused, onKeydown);
  close.addEventListener('click', closeModal);
  actions.appendChild(close);
  focusable.push(close);
  if (outcome.showProceed && config.proceedLabel) {
    const proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.className = 'copy-button';
    proceed.textContent = config.proceedLabel;
    proceed.addEventListener('click', () => {
      const destination = config.destination?.();
      closeModal();
      if (destination) (onOpen || openInNewTab)(destination);
    });
    actions.appendChild(proceed);
    focusable.push(proceed);
  }
  if (outcome.showDownloadFallback && typeof onDownload === 'function') {
    const downloadFallback = document.createElement('button');
    downloadFallback.type = 'button';
    downloadFallback.className = 'shell-utility-action';
    downloadFallback.textContent = 'Download feedback package';
    downloadFallback.addEventListener('click', () => {
      onDownload();
      // Confirm the success in place (V5-NEW-01): once the download actually
      // lands, leaving the stale "Could not copy" title/body up is a
      // dead-looking modal even though the fallback just worked.
      title.textContent = 'Feedback package downloaded';
      description.textContent = 'Feedback package downloaded — attach micronaut-feedback.txt where you are sharing feedback. Nothing has been sent automatically.';
    });
    actions.appendChild(downloadFallback);
    focusable.push(downloadFallback);
  }
  onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab' || focusable.length === 0) return;
    const activeIndex = focusable.indexOf(document.activeElement);
    if (event.shiftKey) {
      if (activeIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      }
    } else if (activeIndex === -1 || activeIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0].focus();
    }
  };
  backdrop.addEventListener('click', () => {
    closeModal();
  });
  dialog.addEventListener('click', (event) => event.stopPropagation());
  window.addEventListener('keydown', onKeydown);
  dialog.append(title, description, actions);
  document.body.append(backdrop, dialog);
  close.focus();
}

export async function handoffFeedback({ report, channel = 'copy', download, onOpen, opener } = {}) {
  // Must be resolved synchronously, before the first `await` below: this is
  // the element the user actually clicked (e.g. "Copy feedback report" or
  // "Open GitHub issue"). copyToClipboard's execCommand fallback appends a
  // hidden <textarea>, focuses it via select(), and removes it -- which
  // drops focus to <body> -- so by the time this function's own await
  // resolves, document.activeElement may no longer be the opener (D2-P1).
  // Reading it now is what makes restoring focus reliable regardless of
  // what the clipboard fallback does internally. Some callers (shell.js's
  // Utilities menu) close a menu that contains the clicked button before
  // calling us, which itself blurs the (about to be hidden) button first --
  // those callers pass `opener` explicitly, captured before they closed
  // anything, rather than relying on this fallback capture.
  const previouslyFocused = opener !== undefined ? opener : document.activeElement;
  const reportText = report || '';
  if (channel === 'download' && typeof download === 'function') download();
  const copied = await copyToClipboard(reportText);
  // Every non-download channel can fall back to downloading the same package
  // text the "Download feedback package" button on the page would produce
  // (R5-02/V2-NEW-02/V5-NEW-01): the modal offers it only when the copy
  // failed and a destination exists to pair it with.
  const onDownload = channel === 'download'
    ? undefined
    : () => downloadTextFile(reportText, 'micronaut-feedback.txt', 'text/plain;charset=utf-8');
  showFeedbackHandoffModal({ channel, copied, onOpen, onDownload, previouslyFocused });
  return copied;
}
