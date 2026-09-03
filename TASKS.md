# Open tasks — Micronaut Planner

Last updated: 2026-09-03

> Near-term worklist. `ROADMAP.md` holds the long-range "why"; authoritative
> scope for any listed item lives in its plan doc under `docs/plans/`.

## The one blocker only Daniel can clear

**`FEEDBACK_EMAIL` in `web/src/ui/feedbackHandoff.js` is blank.** Fill it in with
a non-personal shared inbox — **not** a GitHub `@users.noreply` address, which
discards incoming mail — and the Email action appears in Feedback.

Until then the Email action is not rendered at all. It previously built a
`mailto:` with no recipient, which opened an empty compose window: a button that
looked like it worked and silently dropped every message sent through it. Copy,
Download and the GitHub issue path all work with no setup.

This matters more than it looks. A pilot whose goal is "does the flow make
sense?" needs a return channel, or the silence that comes back is
indistinguishable from success.

## Feedback storage (2026-09-03) — shipped

Feedback opened via GitHub now lands with the `feedback` label pre-applied
(`web/src/ui/feedbackHandoff.js`) — GitHub's new-issue form reads `labels` from
its own query string, so this is a static link change, not a server or
integration. Issues opened this way are one filterable group in the repo: the
"folder" a zero-server app can actually have.

**Requires the `feedback` label to exist in the repo** (a label name in the
link is silently ignored if undefined):

```
gh label create feedback --repo Daniel-Waiger/micronaut-explorer --color d93f0b --description "Opened via the app's Feedback page"
```

`docs/plans` note: `web/src/ui/shell.js`'s own header **Copy feedback report**
action goes through the same GitHub path and inherits the label with no
separate change.

## Pilot-readiness restructure (2026-09-03) — shipped

Three commits, each green. See each commit message for the full reasoning.

### One front door
The app had five explanatory surfaces, three able to start themselves on load,
arbitrated by a priority chain in `main.js`. Which one a visitor met depended on
whether they were new, returning, returning after a day, in a fresh tab, or had
pressed Escape — so no two testers would have been describing the same app.

- The onboarding modal is deleted; Home already offered the same two choices in
  the page, and the modal turned Escape into a silent "explore the example".
- The feature tour no longer starts itself (it ran on a first visit and again
  after 24h away). It stays on the header's **Walkthrough** button.
- A first run starts **blank**. It used to start inside the shipped oregano
  study, and an ownership subsystem — banners, read-only exploration, "make a
  copy" — existed only to walk that back. Opening the example is now an explicit
  choice that hands over ordinary editable work.

### The model path is one-way
~2,500 lines of source and ~1,160 of tests went. Nothing a model produces is
parsed back into the study, so the guardrail is now the architecture rather than
a validator. That also removed four of the review's eight lifecycle states, and
with them every abort controller, request generation, and in-flight race.

Kept: the deterministic exact-text scan, and **Review → Copy prompt for your own
LLM** — which now also names the decisions `conformance` and `decisionTriage`
already know are open, so a model reviews the real gaps.

### Nouns, a registry, one page per measurement
Ten routes became five plus three utilities. Samples & design, Acquisition and
Data plan are sections of one measurement page — composed from the existing step
objects, not rewritten. Measurements became a searchable registry. The research
question has one owner again (the Study map). One status vocabulary reaches the
user: **Draft · Needs a decision · Ready to acquire**.

Old `#/design`, `#/panel`, `#/naming` links still resolve.

## Content authoring (owned by Daniel, not code)

Lives in the knowledge pack (`web/kb/`); see the K-1…K-7 list and the parked
review of `web/kb/advisor.json` wording in [ROADMAP.md](ROADMAP.md).
`web/kb/spectra.json` remains the highest-priority review target — it is
Claude-drafted, still flagged unreviewed in-app, and grew substantially.

## Known and deliberately not fixed

- The browser's automatic `/favicon.ico` request 404s when served from a plain
  static server. Cosmetic, console-only, pre-existing.
- `core/onboarding.js`'s `completed` key is now vestigial (the modal it gated is
  gone). The module still serves `experience`, so it stays.
