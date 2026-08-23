// The Guide step: an in-app user guide / searchable wiki. Pure static
// content plus a client-side text filter -- no store reads, no engine
// calls -- so it renders identically for everyone and can never disagree
// with the app's actual behavior by depending on state. Built with
// createElement/textContent only (shell.js's rule; the content is authored
// here, but the discipline is uniform across the app).
//
// Placed LAST in main.js's steps array so it stays permanently reachable in
// the step nav for discoverability, even though Home (zen-planner Phase 1)
// is now the deliberate landing page and the more prominent entry point to
// the walkthrough this page also offers.
//
// "Wiki with snapshots" (zen-planner Phase 5) shipped as SEARCHABLE text,
// deliberately WITHOUT embedded raster screenshots -- two real reasons, not
// a shortcut: (1) this app is architecturally zero-dependency with no image-
// asset pipeline (see app.css's own header comment on the Home step's
// thumbnails using emoji glyphs for the identical reason), and (2) a
// screenshot of a UI that is still actively changing goes stale immediately
// and silently -- exactly the content-rot risk this codebase's own
// curatedBy/curatedAt discipline (engine/spectra.js) exists to avoid for
// spectral data. If real screenshots are wanted later, they need a
// deliberate capture-and-refresh process, not a one-time embed here.
//
// Deliberately describes the workflow and concepts, not a numbered tutorial:
// the app is usable outside-in. The optional guided example is a separate
// seven-step aid; Guide remains reference material, not an eighth step.

/**
 * A titled, searchable section: an <h2> plus whatever nodes `build(container)`
 * appends. Returns `{ container, title }` so the search filter below can
 * test the section's own rendered text rather than a hand-maintained
 * duplicate keyword list that could drift from the actual content.
 */
function section(parent, title, build) {
  const container = document.createElement('div');
  container.className = 'guide-section';
  const h = document.createElement('h2');
  h.className = 'guide-heading';
  h.textContent = title;
  container.appendChild(h);
  build(container);
  parent.appendChild(container);
  return { container, title };
}

function para(parent, text) {
  const p = document.createElement('p');
  p.className = 'guide-para';
  p.textContent = text;
  parent.appendChild(p);
}

/** A definition-style list: each item is [term, description]. */
function defList(parent, items) {
  const dl = document.createElement('dl');
  dl.className = 'guide-deflist';
  for (const [term, desc] of items) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    dl.appendChild(dt);
    const dd = document.createElement('dd');
    dd.textContent = desc;
    dl.appendChild(dd);
  }
  parent.appendChild(dl);
}

function bullets(parent, items) {
  const ul = document.createElement('ul');
  ul.className = 'guide-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
  parent.appendChild(ul);
}

function guideGuidedStatus(guidedStatus, getGuidedStatus) {
  const status = typeof getGuidedStatus === 'function' ? getGuidedStatus() : guidedStatus;
  return status && typeof status.status === 'string' ? status.status : 'not-started';
}

export const guideStep = {
  id: 'guide',
  title: 'Guide',
  render(main, store, {
    guidedStatus,
    getGuidedStatus,
    onStartGuided,
    onResumeGuided,
    onExplainGuided,
  } = {}) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Guide';
    main.appendChild(heading);

    const isExample = store.get().meta?.origin === 'example';
    const guideStatus = guideGuidedStatus(guidedStatus, getGuidedStatus);
    const guideAction = isExample && guideStatus === 'paused'
      ? { label: 'Resume example walkthrough', callback: onResumeGuided }
      : isExample && guideStatus === 'not-started'
        ? { label: 'Start example walkthrough', callback: onStartGuided }
        : { label: 'Explain the workflow', callback: onExplainGuided };
    const guideButton = document.createElement('button');
    guideButton.type = 'button';
    guideButton.className = 'copy-button guide-tour-button';
    guideButton.textContent = guideAction.label;
    guideButton.title = isExample
      ? 'Open the optional seven-step example walkthrough without changing this study.'
      : 'Open a contextual explanation without changing your study or walkthrough progress.';
    guideButton.addEventListener('click', () => {
      if (typeof guideAction.callback === 'function') guideAction.callback('guide');
    });
    main.appendChild(guideButton);

    para(
      main,
      'Micronaut Planner helps you design a microscopy experiment before you acquire ' +
        'anything: you describe what you are measuring, and it works out the groups and ' +
        'controls you need, flags common pitfalls for your modality, and produces a ' +
      'consistent file-naming convention as a by-product of the finished design. ' +
        'Everything runs in your browser — no upload, no install, no account. The optional guided example covers Home through Overview; this Guide is reference material, not another guided step.'
    );

    // --- Search (zen-planner Phase 5's "searchable wiki") -----------------
    // Filters whole SECTIONS by a case-insensitive substring match over each
    // section's own already-rendered text -- one real search over the
    // content that is actually on screen, not a second, hand-authored
    // keyword index that could silently drift from it.
    const searchRow = document.createElement('div');
    searchRow.className = 'guide-search-row';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'field-input guide-search-input';
    searchInput.placeholder = 'Search the guide (e.g. "controls", "provenance", "schedule")';
    searchInput.setAttribute('aria-label', 'Search the guide');
    searchRow.appendChild(searchInput);
    main.appendChild(searchRow);

    const searchEmpty = document.createElement('p');
    searchEmpty.className = 'proposals-empty';
    searchEmpty.textContent = 'No sections match that search.';
    searchEmpty.hidden = true;
    main.appendChild(searchEmpty);

    const sections = [];
    function trackSection(entry) {
      sections.push(entry);
      return entry;
    }

    function applySearch() {
      const query = searchInput.value.trim().toLowerCase();
      let anyVisible = false;
      for (const { container } of sections) {
        const matches = query === '' || container.textContent.toLowerCase().includes(query);
        container.hidden = !matches;
        if (matches) anyVisible = true;
      }
      searchEmpty.hidden = anyVisible;
    }
    searchInput.addEventListener('input', applySearch);

    // --- Content ------------------------------------------------------

    trackSection(
      section(main, 'The steps', (c) => {
        para(
          c,
          'For a guided example, start at Home — it can open, resume, or restart the optional ' +
            'seven-step walkthrough. This list is a quick reference for what each ' +
            'step in the left nav means. Use the steps in any order — the app works outside-in — ' +
            'and note a study can hold several assays, switched with the tab row at the top.'
        );
        defList(c, [
          ['Home', 'Landing page: optional guided example, description, or worked example.'],
          ['Project', 'Per assay: readout, organism/cell line, sample type, preparation.'],
          ['Study', 'Study-wide question, shared group vocabulary, and assay list.'],
          ['Design', 'Per assay: control/treatment groups, crossing factors, replicate counts.'],
          [
            'Microscopy',
            'Per assay: instrument, modality, magnification, markers, spectral-overlap check, ' +
              'and an optional panel editor.',
          ],
          ['Naming', 'Filename template and fields, plus the bench-schedule (.ics) export.'],
          ['Overview', 'Read-only summary: study map, conformance check, controls, filenames.'],
        ]);
      })
    );

    trackSection(
      section(main, 'Getting started', (c) => {
        bullets(c, [
          'You open onto a real worked example (an oregano wound-healing study) so nothing ' +
            'starts blank. Edit any field and your change always wins over the example.',
          'Start your own: use “New study” in the header for a blank slate, or “Reset to ' +
            'example” to reload the example and undo your edits.',
          'You do not have to answer everything. Fields you skip are simply marked as not set; ' +
            'the app still produces whatever it can from what you have entered.',
        ]);
      })
    );

    trackSection(
      section(main, 'Key ideas', (c) => {
        defList(c, [
          [
            'Assay',
            'One measurement approach within a study — its own readout, panel, specimen, and ' +
              'modality. Real studies often bundle several assays that share only a question and ' +
              'a test article.',
          ],
          [
            'Group vocabulary',
            'The comparison groups shared across the study (e.g. control, treatment). Applying it ' +
              'fills each assay’s groups, except any assay you have already customized.',
          ],
          [
            'Readout',
            'What you are measuring. Choosing a recognized readout unlocks readout-specific ' +
              'control recommendations; an unrecognized answer is respected, not overridden.',
          ],
          [
            'Controls',
            'The app proposes panel-derived and readout-specific controls with a reason for ' +
              'each — rules propose, you dispose. An empty controls list is never shown as ' +
              'silence, so “no controls needed” is never assumed for you.',
          ],
          [
            'Provenance',
            'Every field is tagged by where it came from (your input, an example default, a ' +
              'derived value). A weaker source never overwrites something you set.',
          ],
          [
            'LLM is optional',
            'The planner is deterministic first and fully usable with no model at all. Any ' +
              'language-model help is opt-in and never invents a domain fact on its own.',
          ],
        ]);
      })
    );

    trackSection(
      section(main, 'What you get out', (c) => {
        bullets(c, [
          'A consistent set of planned filenames for every condition in the design.',
          'A visual study map (Overview) you can download as an SVG.',
          'An exportable study document (Markdown) and a print / save-as-PDF view.',
          'A file manifest (CSV) — one row per planned filename with its group, factors, and ' +
            'replicates — and a full raw-data dump (JSON) of the study document, both on Overview.',
          'A bench card per assay (Overview) — a compact, print-oriented single-assay summary: ' +
            'channels, controls with their reasons, and two worked filename examples.',
          'A bench schedule (.ics, Naming) built from your own timing answers — imports into ' +
            'Google Calendar, Outlook, or Apple Calendar with no login.',
          'A copy-paste prompt for your own LLM (Overview) — the study as JSON plus ground rules ' +
            'that keep the model from inventing a domain fact.',
          'Project review first finds exact supported text in your description. You can optionally ' +
            'use a local Ollama model or copy and paste a model reply in place; every interpretation ' +
            'shows quoted evidence from your description, and nothing becomes a structured field until ' +
            'you explicitly accept it.',
        ]);
      })
    );

    trackSection(
      section(main, 'Saving your work', (c) => {
        para(
          c,
          'Your work is autosaved in this browser, so a refresh restores it. Local storage is a ' +
            'convenience, not a safe record — it can be cleared by the browser, is not shared ' +
            'between machines, and is lost in private/incognito windows. To keep a copy, use the ' +
            'Download buttons on the Overview step.'
        );
      })
    );

    trackSection(
      section(main, 'This is an alpha', (c) => {
        para(
          c,
          'This is an early preview shared for feedback. It is a planning aid, not a validated ' +
            'instrument model — always confirm real acquisition settings at the microscope. The ' +
            'built-in guidance content is still being reviewed by a microscopy specialist, so ' +
            'treat specific wording as provisional.'
        );
        para(
          c,
          'Found something wrong, or missing? Use “Copy feedback report” in the header — it copies ' +
            'the current step, your browser, and your full study as text, ready to paste into an ' +
            'email or a GitHub issue. “GitHub issue” next to it opens a prefilled issue with the ' +
            'same report already in the body. Neither ever sends anything on its own.'
        );
      })
    );
  },
};
