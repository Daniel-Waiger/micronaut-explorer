# Product-designer UI redesign

## Intent

Rework Micronaut Planner into a calm, legible Modern SaaS workspace while
preserving its zero-dependency static architecture and its current study-design
behaviour. The supplied design reference calls for Tailwind conventions; this
repository deliberately has no runtime dependencies, so its existing semantic
CSS is the implementation vehicle for the same visual decisions.

## Decisions

- Light, slate-based workspace with indigo as the focused-action and active
  colour. Semantic success, warning, and error treatments remain emerald,
  amber, and rose.
- A stable product shell gives the user a clear orientation: brand and utility
  actions at the top, active assay context below, step navigation at left, and
  a comfortable central work area.
- Existing DOM hooks are preserved where possible so core study behaviour,
  tests, and the self-contained build are unaffected.
- The current emoji navigation is replaced by inline, labelled, thin-stroke SVG
  icons. This provides the Lucide-like visual language requested without adding
  a package to a deliberately dependency-free app.

## Producer-to-consumer checks

| Producer | Consumer | End-to-end proof |
| --- | --- | --- |
| `renderShell()` navigation controls | router and active-step renderer | Switch routes and collapse/expand navigation in the served build. |
| CSS design tokens | every step and panel | Visit Home, Describe, Panel, Overview, and Guide in the built artifact. |
| build inliner | browser artifact | Serve `dist/index.html` over HTTP, not only the module development page. |

## Verification traces

1. Render the default study at a desktop viewport; confirm the active step and
   active assay are immediately visible and main content remains dominant.
2. At a narrow viewport, expand the navigation and inspect header-action
   wrapping; no controls or content may overflow horizontally.
3. Switch from Home to Describe, change a representative text value, then open
   Panel and Overview; state and route behavior must remain unchanged.
4. Toggle navigation collapse and theme; labels/icons remain understandable,
   keyboard focus remains visible, and the header remains operable.
