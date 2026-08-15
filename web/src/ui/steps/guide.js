// The Guide step: an in-app user guide / help page. Pure static content --
// no store reads, no engine calls -- so it renders identically for everyone
// and can never disagree with the app's actual behavior by depending on
// state. Built with createElement/textContent only (shell.js's rule; the
// content is authored here, but the discipline is uniform across the app).
//
// Placed LAST in main.js's steps array so it never displaces the deliberate
// Study landing page (docs/plans/planner-web-assay-tier.md), while staying
// permanently visible in the step nav for discoverability -- the thing an
// alpha tester reaches for first.
//
// Deliberately describes the workflow and concepts, not a click-by-click
// script: the app is usable outside-in (jump to any step), so a rigid
// numbered tutorial would misrepresent it.

/** A titled section: an <h2> plus whatever nodes the builder appends. */
function section(parent, title) {
  const h = document.createElement('h2');
  h.className = 'guide-heading';
  h.textContent = title;
  parent.appendChild(h);
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
  render(main) {
    main.textContent = '';

    const heading = document.createElement('h1');
    heading.className = 'step-heading';
    heading.textContent = 'Guide';
    main.appendChild(heading);

    para(
      main,
      'Micronaut Planner helps you design a microscopy experiment before you acquire ' +
        'anything: you describe what you are measuring, and it works out the groups and ' +
        'controls you need, flags common pitfalls for your modality, and produces a ' +
        'consistent file-naming convention as a by-product of the finished design. ' +
        'Everything runs in your browser — no upload, no install, no account.'
    );

    section(main, 'The steps');
    para(
      main,
      'Use the steps in the left nav in any order — the app works outside-in, so you can ' +
        'jump straight to whatever you want to fill in. A study can hold several assays; the ' +
        'row of tabs at the top switches between them (and adds or removes them).'
    );
    defList(main, [
      [
        'Study',
        'The top-level view: your research question, the arm vocabulary shared across ' +
          'assays (e.g. CTL vs OPP), and the list of assays. Rename or add assays here.',
      ],
      [
        'Describe',
        'Per assay: pick the readout you are actually measuring (viability, cytoskeleton, ' +
          'ROS, migration, …) and describe the assay in plain language. The readout drives ' +
          'the control recommendations later.',
      ],
      [
        'Design',
        'Per assay: the modality, the fluorophore/marker panel, and the experimental axes ' +
          '(arms, crossing factors, biological and technical replicates). Modality-specific ' +
          'advice appears here.',
      ],
      [
        'Naming',
        'The filename template and the field values it fills. This is where the naming ' +
          'convention is assembled from the design — you rarely type a filename by hand.',
      ],
      [
        'Color panel',
        'A qualitative check for spectral spillover across the markers you entered on Naming — ' +
          'flags fluorophore pairs whose excitation or emission peaks sit too close together. ' +
          'Not a spectral-overlap integral, and the spectral values are Claude-drafted, not yet ' +
          'reviewed. Below it, an optional structured panel editor lets you name each channel’s ' +
          'target and how its fluorophore is attached (direct antibody, indirect, genetically ' +
          'encoded, a direct-binding probe, or a self-labeling tag) — more precise than the ' +
          'markers field, and what tells Overview whether an antibody is actually involved.',
      ],
      [
        'Overview',
        'A read-only summary of the whole study: a visual study map, a conformance check (one ' +
          'pass/fail verdict for the whole study), the recommended controls, a step-by-step ' +
          '“how to run this project” walkthrough, and every planned filename. Nothing is ' +
          'entered here — it reads from the other steps.',
      ],
    ]);

    section(main, 'Getting started');
    bullets(main, [
      'You open onto a real worked example (an oregano wound-healing study) so nothing ' +
        'starts blank. Edit any field and your change always wins over the example.',
      'Start your own: use “New study” in the header for a blank slate, or “Reset to ' +
        'example” to reload the example and undo your edits.',
      'You do not have to answer everything. Fields you skip are simply marked as not set; ' +
        'the app still produces whatever it can from what you have entered.',
    ]);

    section(main, 'Key ideas');
    defList(main, [
      [
        'Assay',
        'One measurement approach within a study — its own readout, panel, specimen, and ' +
          'modality. Real studies often bundle several assays that share only a question and ' +
          'a test article.',
      ],
      [
        'Arm vocabulary',
        'The comparison groups shared across the study (e.g. CTL, OPP). Applying it fills ' +
          'each assay’s arms, except any assay you have already customized.',
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

    section(main, 'What you get out');
    bullets(main, [
      'A consistent set of planned filenames for every condition in the design.',
      'A visual study map (Overview) you can download as an SVG.',
      'An exportable study document (Markdown) and a print / save-as-PDF view.',
      'A file manifest (CSV) — one row per planned filename with its group, factors, and ' +
        'replicates — and a full raw-data dump (JSON) of the study document, both on Overview.',
      'A bench card per assay (Overview) — a compact, print-oriented single-assay summary: ' +
        'channels, controls with their reasons, and two worked filename examples.',
      'A copy-paste prompt for your own LLM (Overview) — the study as JSON plus ground rules ' +
        'that keep the model from inventing a domain fact.',
      'An optional "Ask about this step" panel (Describe) — off by default. Left off, or if ' +
        'no local model is configured, it works exactly like the copy-paste prompt above: you ' +
        'get text to paste into whatever LLM you already use. If you opt in and point it at a ' +
        'local Ollama server, the app calls that server directly over your own network — no ' +
        'API key, nothing sent anywhere else. Either way it can only explain the current step; ' +
        'it never writes an answer into your study for you.',
    ]);

    section(main, 'Saving your work');
    para(
      main,
      'Your work is autosaved in this browser, so a refresh restores it. Local storage is a ' +
        'convenience, not a safe record — it can be cleared by the browser, is not shared ' +
        'between machines, and is lost in private/incognito windows. To keep a copy, use the ' +
        'Download buttons on the Overview step.'
    );

    section(main, 'This is an alpha');
    para(
      main,
      'This is an early preview shared for feedback. It is a planning aid, not a validated ' +
        'instrument model — always confirm real acquisition settings at the microscope. The ' +
        'built-in guidance content is still being reviewed by a microscopy specialist, so ' +
        'treat specific wording as provisional.'
    );
    para(
      main,
      'Found something wrong, or missing? Use “Copy feedback report” in the header — it copies ' +
        'the current step, your browser, and your full study as text, ready to paste into the ' +
        'feedback form or an email. It never sends anything on its own.'
    );
  },
};
