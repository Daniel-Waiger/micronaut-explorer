# Returning walkthrough and issue routing

## Product decisions

- A feature walkthrough returns automatically only after **24 hours away**. A per-tab session marker suppresses reloads, while a visibility interval handles a tab left open then revisited after the same threshold.
- Existing onboarding and a resumed guided walkthrough have priority, so two modal systems never compete. The header launcher is always available.
- Acquisition disclosures are temporarily opened only when the walkthrough needs them. A disclosure that was already open remains open; one opened by the tour is restored on advance, close, or route change.
- The configured GitHub remote is private, so anonymous browsers receive GitHub's 404. The Issues action now starts at GitHub sign-in and returns to the prefilled issue form; email, copy, and download remain account-free.

## Execution order

Run `RW-1` for isolated visit-state behavior, `RW-2` for wiring and temporary disclosure ownership, then `RW-3` for tests and shipped-artifact/live checks.