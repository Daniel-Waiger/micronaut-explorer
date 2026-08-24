# Feedback and Settings navigation plan

## Goal

Replace the header Utilities menu with clear, persistent Feedback and Settings
navigation at the bottom of the left rail. Feedback remains local-first and
never sends study data unless a future endpoint is explicitly configured.

## Delivery order

1. Establish separate, non-workflow routes and utility navigation.
2. Add the reviewed feedback package and account-free sharing fallbacks.
3. Move existing utility lifecycle controls into Settings and run end-to-end
   browser verification against the built artifact.

## Safety and privacy invariants

- Feedback route history records routes and timing only, not typed field values.
- Full study JSON is opt-in in the feedback package.
- The unconfigured Send feedback action performs no network request.
- Existing backup/import/recovery/reset actions retain their confirmation and
  error handling contracts.
