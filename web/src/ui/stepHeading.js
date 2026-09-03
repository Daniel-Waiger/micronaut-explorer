// The one place a workspace's title bar is built.
//
// Samples & design, Acquisition and Data plan each used to be their own route
// with their own <h1> and their own "Planning X for: {measurement}" line. They
// are now sections of one measurement page (ui/steps/measurement.js), which
// states the measurement once at the top -- so when a step renders `embedded`
// it emits an <h2> and drops the scope line rather than repeating the
// measurement's name three times down a single scroll.
//
// Each step still renders standalone when given its own container, which is
// what keeps ui/steps/measurement.js a composition rather than a rewrite.

export function appendStepHeading(main, { title, scopeText = '', embedded = false, id = '' } = {}) {
  const heading = document.createElement(embedded ? 'h2' : 'h1');
  heading.className = embedded ? 'measurement-section-heading' : 'step-heading';
  heading.textContent = title;
  if (id) heading.id = id;
  main.appendChild(heading);

  // The scope line answers "which measurement am I editing?" -- a question the
  // composed page has already answered in its own header.
  if (!embedded && scopeText) {
    const scope = document.createElement('p');
    scope.className = 'proposals-empty supporting-description';
    scope.textContent = scopeText;
    main.appendChild(scope);
  }
  return heading;
}
