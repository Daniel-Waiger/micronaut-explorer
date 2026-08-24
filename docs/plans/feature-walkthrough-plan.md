# Focused feature walkthrough

## Product decision

This is separate from **Explain this step**. Explain remains a richer
step-level explanation; the new header **Walkthrough** is a concise tour of
the meaningful interactive areas on every workspace. Repeated grid rows and
individual fields are explained through their owning feature area rather than
turning a tour into hundreds of stops.

## Interaction contract

- Start from the app shell, then traverse the routes in workflow order plus
  Guide, Feedback, and Settings.
- At each stop, dim and blur the viewport outside the target rectangle; the
  target remains visible and can be read without obstruction.
- Put a compact dialog beside the target (or above/below when space demands)
  with no more than two sentences of copy.
- Next/Back navigate feature stops; Close and Escape restore the launch
  button’s focus. Conditional or missing features are skipped safely.

## Tasks

Follow `feature-walkthrough-task-graph.json`: controller/map first, then
shell/CSS integration, then tests and built-artifact verification. The
existing step-level guided walkthrough must remain untouched.
