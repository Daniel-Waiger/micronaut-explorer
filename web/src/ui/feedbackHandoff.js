import { copyToClipboard } from './clipboard.js';

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

const CHANNELS = {
  copy: {
    title: 'Feedback package copied',
    detail: 'Paste it into the message, form, or issue where you want to share feedback. Nothing has been sent automatically.',
  },
  download: {
    title: 'Feedback package downloaded and copied',
    detail: 'Attach the downloaded micronaut-feedback.txt file, or paste the copied package into the place you are sharing feedback. Nothing has been sent automatically.',
  },
  email: {
    title: 'Feedback package copied',
    detail: 'Open your email app, start a message to the team, and paste the copied package into the message body. The app does not place your feedback or study in the email link.',
    proceedLabel: 'Open email app',
    destination: emailFeedbackUrl,
  },
  github: {
    title: 'Feedback package copied',
    detail: 'Sign in to GitHub if needed, then paste the copied package into the new issue. The GitHub link contains no feedback, browser details, or study data.',
    proceedLabel: 'Open GitHub issue',
    destination: githubFeedbackUrl,
  },
};

function removeModal(backdrop, dialog, previouslyFocused, onKeydown) {
  window.removeEventListener('keydown', onKeydown);
  backdrop.remove();
  dialog.remove();
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
}

export function showFeedbackHandoffModal({ channel, copied, onOpen } = {}) {
  const config = CHANNELS[channel] || CHANNELS.copy;
  const previouslyFocused = document.activeElement;
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
  title.textContent = copied ? config.title : 'Could not copy the feedback package';
  const description = document.createElement('p');
  description.id = 'feedback-handoff-description';
  description.className = 'feedback-handoff-description';
  description.textContent = copied
    ? config.detail
    : 'Your browser did not allow the package to be copied. Use Download feedback package instead, then attach or paste that file where you are sharing feedback.';
  const actions = document.createElement('div');
  actions.className = 'feedback-handoff-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'shell-utility-action';
  close.textContent = copied && config.proceedLabel ? 'Not now' : 'Done';
  let onKeydown = () => {};
  const closeModal = () => removeModal(backdrop, dialog, previouslyFocused, onKeydown);
  close.addEventListener('click', closeModal);
  actions.appendChild(close);
  if (copied && config.proceedLabel) {
    const proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.className = 'copy-button';
    proceed.textContent = config.proceedLabel;
    proceed.addEventListener('click', () => {
      const destination = config.destination?.();
      closeModal();
      if (destination) (onOpen || ((url) => window.open(url, '_blank', 'noopener')))(destination);
    });
    actions.appendChild(proceed);
  }
  onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeModal();
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

export async function handoffFeedback({ report, channel = 'copy', download, onOpen } = {}) {
  if (channel === 'download' && typeof download === 'function') download();
  const copied = await copyToClipboard(report || '');
  showFeedbackHandoffModal({ channel, copied, onOpen });
  return copied;
}
