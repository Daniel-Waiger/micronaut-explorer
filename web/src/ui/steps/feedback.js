import { buildFeedbackReport } from '../../core/feedbackReport.js';
import { downloadTextFile } from '../../core/persist.js';
import { githubFeedbackUrl, handoffFeedback } from '../feedbackHandoff.js';

function feedbackButton(label, onClick) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = 'copy-button'; node.textContent = label; node.addEventListener('click', onClick);
  return node;
}

export const githubLoginUrl = githubFeedbackUrl;

export const feedbackStep = {
  id: 'feedback', title: 'Feedback', utility: true,
  render(main, store, options = {}) {
    main.textContent = '';
    const title = document.createElement('h1'); title.className = 'step-heading'; title.textContent = 'Feedback';
    const intro = document.createElement('p'); intro.className = 'proposals-empty supporting-description'; intro.textContent = 'Tell us what happened. Nothing leaves this browser unless you choose one of the sharing actions below.';
    const form = document.createElement('textarea'); form.className = 'describe-textarea'; form.placeholder = 'What were you trying to do, and where did you get stuck?'; form.rows = 7;
    const context = document.createElement('details'); context.className = 'reveal';
    const summary = document.createElement('summary'); summary.className = 'reveal-summary'; summary.textContent = 'Included technical context';
    const body = document.createElement('p'); body.className = 'proposals-empty supporting-description'; body.textContent = `Current page: ${options.router?.current?.() || 'unknown'}. A feedback package also includes browser details and your study only when you choose an export action.`;
    context.append(summary, body);
    const actions = document.createElement('div'); actions.className = 'overview-secondary-actions';
    const report = () => `${form.value.trim() ? `${form.value.trim()}\n\n` : ''}${buildFeedbackReport({ currentStepId: options.router?.current?.(), kbIssueCount: options.kbIssueCount, userAgent: navigator.userAgent, experiment: store.get() })}`;
    actions.append(
      feedbackButton('Copy feedback package', () => handoffFeedback({ report: report(), channel: 'copy' })),
      feedbackButton('Download feedback package', () => {
        const packageText = report();
        return handoffFeedback({
          report: packageText, channel: 'download',
          download: () => downloadTextFile(packageText, 'micronaut-feedback.txt', 'text/plain;charset=utf-8'),
        });
      }),
      feedbackButton('Email feedback', () => handoffFeedback({ report: report(), channel: 'email' })),
      feedbackButton('Open GitHub issue', () => handoffFeedback({ report: report(), channel: 'github' }))
    );
    main.append(title, intro, form, context, actions);
  },
};
