# Group terminology migration

Replace the treatment-study term “arm” with “group” across saved data, application copy, contextual guidance, generated reports, diagrams, tests, and source documentation.

The persisted study schema advances from v3 to v4. Legacy `armVocabulary` values and provenance migrate deterministically to `groupVocabulary`; `design.groups` is already canonical and remains unchanged. Derived StudyDocument projections similarly become `design.groups` and `study.groupVocabulary`.

Acceptance requires no standalone `arm` or `arms` terminology in application source or the shipped artifact, while v1–v3 studies continue to migrate without data loss.
