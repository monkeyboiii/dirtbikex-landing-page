# AGENTS.md — DirtBikeX landing

The repo contract. Everything an agent needs about this repo is under `agents.d/` — shape and
rules in the harness's `playbook/agents-d.md`.

- **10 module docs** in `agents.d/modules/`; `dbx docs list landing` is the index.
- This is a **Cloudflare Worker** (static assets), not Pages: `wrangler deploy`, and
  `dbx deploy worker` is the harness verb that asserts the build↔env pairing before shipping.
- `agents.d/modules/share.md` and `trail-upload.md` are the two most-cited; start there.

Coding discipline is the harness's `AGENTS.md § Coding discipline`, which every session
already loads — this file used to carry a third copy of it.
