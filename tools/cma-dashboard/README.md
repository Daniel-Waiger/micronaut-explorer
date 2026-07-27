# CMA Model Activity Monitor

Live status board for CMA (multi-agent) runs on this repo. `index.html` is the
single source of truth — it works two ways from the same file:

- **Local / live**, during a run: `python -m http.server 8777` from this
  directory, open `http://localhost:8777`. The page polls `./status.json`
  every 1.5s (pulsing dot, "updated Ns ago").
- **Published**, for viewing from any machine without a server running: `git`
  carries `index.html` cross-platform; when no `status.json` is reachable the
  page falls back to an embedded snapshot baked into the file at publish
  time. Publish it as a Claude artifact and pass the SAME artifact `url` on
  every republish so it stays one stable link, not a new one each time.

## Files

- `index.html` — the page. Tracked. Edit this to change the design.
- `update.py` — CLI mutator for `status.json`. Tracked.
- `status.seed.json` — tracked starter/example state. `update.py` bootstraps
  a missing `status.json` from this on a fresh clone.
- `status.json` — the live run state. **Gitignored** — it churns every task,
  so committing it would spam history. Copy `status.seed.json` to
  `status.json` to start a fresh local run, or just run `update.py` once
  (it bootstraps automatically).

## Driving a run

```bash
python update.py --run "Run — safe renaming" --orch "Claude Fable 5" \
  --model "Claude Sonnet" --status running --phase "Batch 1" \
  --current A4 "Windows path & collision edges" \
  --task-add A4=Batch 1=Windows path & collision edges=running:Claude Sonnet \
  --log "Dispatched A4"

python update.py --task A4=done:"Sonnet · VERIFIED PASS" \
  --stat "Test suite=239 passed:ok" \
  --log "A4 verified pass"

python update.py --defect-add A11=service.py:323="Ledger exclusion is case-sensitive" \
  --log "A8 verifier FAIL: case-variant ledger bypass, history loss proven"

python update.py --defect-clear A11 --log "A11 fixed and verified"
```

`--task` updates an existing task by id; `--task-add` appends a new one
(no-op if the id already exists, so it's safe to call every run). Status
vocabulary: `pending` `running` `verifying` `done` `resolved` `failed`
`paused` `idle` — `resolved` means *failed, then fixed*; never relabel a
repaired failure as `done`, that erases the run's real defect history.

## Publishing the snapshot

Before publishing as an artifact, refresh the embedded `EMBEDDED` object near
the top of `<script>` in `index.html` from the current `status.json`, so
viewers without a live server see accurate state, not a stale one.

See `docs/cma-lessons.md` for the wider CMA scheme this dashboard tracks.
