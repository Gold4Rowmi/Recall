# RECALL

A time-block planner and team command centre for Windows, by ROWMI.

## Develop

No bundler and no npm install: `ui/` is plain ES modules.

```bash
python -m http.server 8123 --directory ui
```

Open `http://localhost:8123/?demo` for an offline workspace with made-up data, or run the real shell:

```bash
cargo tauri dev
```

Tests: `node --test "tests/*.mjs"`

## How it stays fast

- `store.js` keeps every row in memory and persists to IndexedDB. Reads are synchronous; writes are optimistic.
- `sync.js` pushes a per-row outbox, pulls deltas by cursor, and listens to Supabase Realtime.
- Views mount once and stay mounted, so switching tabs only flips `hidden`.
- Analytics run in a Web Worker and never block the UI thread.

## Release

Every push to `main` that touches the app runs the tests, builds a signed installer and publishes a GitHub Release. Installed copies update on next launch. Repo secrets required: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Team rosters and ClickUp scope live in the workspace's `workspace_integrations` row (`provider = 'recall'`), not in this repo.
