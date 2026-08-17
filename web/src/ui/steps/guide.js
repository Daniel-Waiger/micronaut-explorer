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
// Deliberately describes the workflow and concepts, not a click-by-click
// script: the app is usable outside-in (jump to any step), so a rigid
// numbered tutorial would misrepresent it. ui/walkthrough.js's interactive
// tour (reachable from the button below, and from Home) is the click-by-
// click version, over the REAL running app rather than a description of it.

import { startWalkthrough } from '../walkthrough.js';

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

export const guideStep = {
  id: 'guide',
  title: 'Guide',
  render(main, store, { router } = {}) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Guide';
    main.appendChild(heading);

    const tourBtn = document.createElement('button');
    tourBtn.type = 'button';
    tourBtn.className = 'copy-button guide-tour-button';
    tourBtn.textContent = 'Start the tour';
    tourBtn.title = 'A short guided tour over the real app -- click-by-click, not just a description.';
    tourBtn.addEventListener('click', () => startWalkthrough({ router }));
    main.appendChild(tourBtn);

    para(
      main,
      'Micronaut Planner helps you design a microscopy experiment before you acquire ' +
        'anything: you describe what you are measuring, and it works out the groups and ' +
        'controls you need, flags common pitfalls for your modality, and produces a ' +
        'consistent file-naming convention as a by-product of the finished design. ' +
        'Everything runs in your browser — no upload, no install, no account.'
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
          'Use the steps in the left nav in any order — the app works outside-in, so you can ' +
            'jump straight to whatever you want to fill in. A study can hold several assays; the ' +
            'row of tabs at the top switches between them (and adds or removes them).'
        );
        defList(c, [
          [
            'Home',
            'The landing page: three doors in — start from a description, start from the worked ' +
              'example, or take the guided tour. Also where "Take the walkthrough" lives if you ' +
              'skipped it the first time.',
          ],
          [
            'Project',
            'Per assay: the question first — pick the readout you are actually measuring ' +
              '(viability, cytoskeleton, ROS, migration, …), your organism/cell line, sample type, ' +
              'and preparation, before any microscope decision. Optional AI help (off by default) ' +
              'lives in a collapsed "Get AI help" section here.',
          ],
          [
            'Study',
            'The study-wide view: your research question, the group vocabulary shared across ' +
              'assays (e.g. control vs. treatment), and the list of assays. Rename or add assays here.',
          ],
          [
            'Design',
            'Per assay: your control and treatment groups as individual named boxes, any crossing ' +
              'factors, and biological/technical replicate counts.',
          ],
          [
            'Microscopy',
            'Per assay: instrument, modality, magnification, and markers, asked as a grid of short ' +
              'boxes — fill one in and click its ✓ to confirm; leave it blank to skip. Below that, ' +
              'a qualitative spectral-spillover check across the markers you entered, with detection ' +
              'filter bands overlaid automatically. An optional structured panel editor lets you name ' +
              'each channel’s target and how its fluorophore is attached (direct antibody, indirect, ' +
              'genetically encoded, a direct-binding probe, or a self-labeling tag) — more precise ' +
              'than the markers field, and what tells Overview whether an antibody is actually involved.',
          ],
          [
            'Naming',
            'The filename template and the field values it fills — assembled from the design, so you ' +
              'rarely type a filename by hand. Further down, a Schedule section: roughly how long each ' +
              'bench/microscope task takes for you, and a one-click download of a bench schedule ' +
              '(.ics) that imports into Google Calendar, Outlook, or Apple Calendar with no login.',
          ],
          [
            'Overview',
            'A read-only summary of the whole study: a visual study map, a conformance check (one ' +
              'pass/fail verdict for the whole study), the recommended controls, a step-by-step ' +
              '“how to run this project” ladder, and every planned filename. Nothing is entered ' +
              'here — it reads from the other steps.',
          ],
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
          'An optional "Ask about this step" panel (Project) — off by default. Left off, or if ' +
            'no local model is configured, it works exactly like the copy-paste prompt above: you ' +
            'get text to paste into whatever LLM you already use. If you opt in and point it at a ' +
            'local Ollama server, the app calls that server directly over your own network — no ' +
            'API key, nothing sent anywhere else. Either way it can only explain the current step; ' +
            'it never writes an answer into your study for you.',
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
