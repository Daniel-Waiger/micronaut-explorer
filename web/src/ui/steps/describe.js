import { parseFreeText } from '../../engine/freetext.js';
import { loadQuestions, nextQuestions, recordAnswer, skipQuestion } from '../../engine/interview.js';

const INTERVIEW_LIMIT = 8;

/**
 * Render a value for display in a proposal row -- markers proposals carry
 * a joined canonical string, everything else is a plain scalar.
 */
function displayValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

export function createDescribeStep(kb) {
  const { questions: questionBank, issues: questionIssues } = loadQuestions(kb.questions);
  if (questionIssues.length > 0) {
    // The question bank is committed, curated data -- if it somehow ships
    // broken, fail loudly to the console rather than silently asking fewer
    // questions than intended. Never throws: the interview simply runs with
    // whatever subset of questions DID load.
    console.error('Question bank issues:', questionIssues);
  }

  return {
    id: 'describe',
    title: 'Describe',
    render(main, store, { showToast } = {}) {
      main.textContent = '';

      const heading = document.createElement('h1');
      heading.className = 'step-heading';
      heading.textContent = 'Describe what you did';
      main.appendChild(heading);

      const textarea = document.createElement('textarea');
      textarea.className = 'describe-textarea';
      textarea.placeholder =
        'Paste or type a paragraph describing this experiment -- e.g. "Confocal of mouse cortex at 63x, stained with DAPI and Alexa 488, n=3, comparing WT vs KO."';
      textarea.value = store.getPath('narrative.text') || '';
      main.appendChild(textarea);

      const readButton = document.createElement('button');
      readButton.type = 'button';
      readButton.className = 'read-button';
      readButton.textContent = 'Read it';
      main.appendChild(readButton);

      const proposalsHeading = document.createElement('div');
      proposalsHeading.className = 'proposals-heading';
      proposalsHeading.textContent = 'Proposals';
      main.appendChild(proposalsHeading);

      const proposalsList = document.createElement('div');
      proposalsList.className = 'proposals-list';
      main.appendChild(proposalsList);

      const interviewHeading = document.createElement('div');
      interviewHeading.className = 'interview-heading';
      interviewHeading.textContent = 'Questions';
      main.appendChild(interviewHeading);

      const interviewList = document.createElement('div');
      interviewList.className = 'interview-list';
      main.appendChild(interviewList);

      // Proposals are held here (not written to the store) until the user
      // explicitly Accepts one -- a proposal is a suggestion, never applied
      // automatically. This repo has already shipped a silent-auto-apply
      // defect once (the T10 describer-override work); the fix here is
      // structural, not a reminder.
      let pendingProposals = [];

      function renderProposals() {
        proposalsList.textContent = '';
        if (pendingProposals.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'proposals-empty';
          empty.textContent = textarea.value
            ? 'Click "Read it" to scan the paragraph above.'
            : 'Nothing to scan yet.';
          proposalsList.appendChild(empty);
          return;
        }
        for (const proposal of pendingProposals) {
          const row = document.createElement('div');
          row.className = 'proposal-row';

          const text = document.createElement('div');
          text.className = 'proposal-text';
          const valueSpan = document.createElement('strong');
          valueSpan.textContent = displayValue(proposal.value);
          text.appendChild(valueSpan);
          const evidenceSpan = document.createElement('span');
          evidenceSpan.className = 'proposal-evidence';
          // A markers proposal can carry several distinct hits (e.g.
          // ATTO647N + ATTO647) folded into one joined `value` -- show
          // every match's evidence, not just the first, so the user can see
          // what actually justified each part of the proposed value.
          const evidenceText = Array.isArray(proposal.matches)
            ? proposal.matches.map((m) => `"${m.evidence}"`).join(', ')
            : `"${proposal.evidence}"`;
          evidenceSpan.textContent = ` -- from ${evidenceText}`;
          text.appendChild(evidenceSpan);
          row.appendChild(text);

          const actions = document.createElement('div');
          actions.className = 'proposal-actions';

          const acceptBtn = document.createElement('button');
          acceptBtn.type = 'button';
          acceptBtn.className = 'proposal-accept';
          acceptBtn.textContent = 'Accept';
          acceptBtn.addEventListener('click', () => {
            const applied = store.setPath(proposal.path, proposal.value, proposal.tag);
            pendingProposals = pendingProposals.filter((p) => p !== proposal);
            renderProposals();
            renderInterview();
            // setPath's return value is the ONLY signal that a write was
            // refused (a stronger value already occupies that slot) -- a
            // refused Accept must not look identical to a successful one.
            if (!applied && showToast) {
              showToast(
                `Couldn't apply "${displayValue(proposal.value)}" -- a stronger value is already set there.`
              );
            }
          });
          actions.appendChild(acceptBtn);

          const dismissBtn = document.createElement('button');
          dismissBtn.type = 'button';
          dismissBtn.className = 'proposal-dismiss';
          dismissBtn.textContent = 'Dismiss';
          dismissBtn.addEventListener('click', () => {
            pendingProposals = pendingProposals.filter((p) => p !== proposal);
            renderProposals();
          });
          actions.appendChild(dismissBtn);

          row.appendChild(actions);
          proposalsList.appendChild(row);
        }
      }

      function renderInterview() {
        interviewList.textContent = '';
        const askable = nextQuestions(questionBank, store.get(), INTERVIEW_LIMIT);
        if (askable.length === 0) {
          const done = document.createElement('p');
          done.className = 'interview-empty';
          done.textContent = 'No more questions right now.';
          interviewList.appendChild(done);
          return;
        }

        for (const question of askable) {
          const row = document.createElement('div');
          row.className = 'question-row';

          const prompt = document.createElement('div');
          prompt.className = 'question-prompt';
          prompt.textContent = question.prompt;
          row.appendChild(prompt);

          const why = document.createElement('div');
          why.className = 'question-why';
          why.textContent = question.why;
          row.appendChild(why);

          let control;
          if (question.type === 'choice' || question.type === 'multi') {
            control = document.createElement('select');
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '-- choose --';
            control.appendChild(blank);
            for (const option of question.options || []) {
              const opt = document.createElement('option');
              opt.value = option;
              opt.textContent = option;
              control.appendChild(opt);
            }
          } else {
            control = document.createElement('input');
            control.type = question.type === 'number' ? 'number' : 'text';
          }
          control.className = 'question-control';
          if (question.suggestedDefault !== undefined) {
            control.value = question.suggestedDefault;
          }
          row.appendChild(control);

          const actions = document.createElement('div');
          actions.className = 'question-actions';

          const answerBtn = document.createElement('button');
          answerBtn.type = 'button';
          answerBtn.className = 'question-answer';
          answerBtn.textContent = 'Answer';
          answerBtn.addEventListener('click', () => {
            const raw = control.value;
            if (!raw) return;
            const value = question.type === 'number' ? Number(raw) : raw;
            const descriptor = recordAnswer(store.get(), question, value);
            store.setPath(descriptor.path, descriptor.value, descriptor.tag);
            renderInterview();
          });
          actions.appendChild(answerBtn);

          const skipBtn = document.createElement('button');
          skipBtn.type = 'button';
          skipBtn.className = 'question-skip';
          skipBtn.textContent = 'Skip';
          skipBtn.addEventListener('click', () => {
            skipQuestion(store.get(), question.id);
            store.patch({}); // no-op patch: triggers notify/autosave for the skip mutation above
            renderInterview();
          });
          actions.appendChild(skipBtn);

          row.appendChild(actions);
          interviewList.appendChild(row);
        }
      }

      textarea.addEventListener('input', () => {
        store.setPath('narrative.text', textarea.value, 'user');
      });

      readButton.addEventListener('click', () => {
        const result = parseFreeText(textarea.value, kb.index);
        pendingProposals = result.proposals;
        renderProposals();
        if (showToast) {
          showToast(
            pendingProposals.length > 0
              ? `Found ${pendingProposals.length} proposal(s) to review.`
              : 'Nothing recognizable found in that text.'
          );
        }
      });

      renderProposals();
      renderInterview();
    },
  };
}
