# omp web

A web user interface for the [oh-my-pi](https://github.com/can1357/oh-my-pi) coding agent.
This project ships **only the UI and the communication layer** — all agent capability lives in
your local `omp` binary; nothing is reimplemented here.

![stack](https://img.shields.io/badge/vite%20%2B%20react%2019%20%2B%20ts%20%2B%20HeroUI%20v3-7c5cff)

## Features

- **Sidebar + conversation layout** — session list (parsed from `~/.omp/agent/sessions`),
  search, new chat, rename, delete, connection status.
- **Live streaming turns** — text/thinking deltas, tool-call cards with live status, abort,
  follow-up queueing while streaming (`prompt` with `streamingBehavior: "followUp"`).
- **Token consumption display** — per-message `↑input ↓output · cache · $cost · tok/s · model`
  chips, conversation totals and cost in the top bar, and a context-window usage meter
  (from `get_session_stats` / `get_state.contextUsage`).
- **Install detection** — if the local `omp` binary is missing, a setup guide with
  per-platform install commands and a re-check button takes over the page.
- **Theming** — dark / light / system modes (default: dark) with a black graphite accent
  by default plus five preset accent colors (violet / blue / emerald / rose / amber),
  driven by HeroUI's `--accent` token and switchable live from the sidebar.
- **Model & thinking pickers** — `get_available_models` → `set_model`, thinking levels →
  `set_thinking_level`; compaction button (`compact`).
- **Extension UI passthrough** — `select` / `confirm` / `input` / `editor` / `open_url`
  requests render as dialogs and answer via `extension_ui_response`.

## Architecture

```
browser ──WS /ws──▶ bridge (server/bridge.mjs) ──stdio JSONL──▶ omp --mode rpc --continue
        ──REST /api──▶ session listing, health, static dist/
```

- **`server/bridge.mjs`** — Node process owning one `omp --mode rpc` child per WebSocket
  connection. Negotiates **protocol v2** on the child's `ready` frame, reassembles
  `rpc_chunk` sequences server-side (strict ordering / interleaving / size validation per
  `docs/rpc.md`), and forwards clean frames both ways. Also serves the built frontend.
- **`src/rpc/`** — wire types mirrored from `rpc-types.ts` + a reconnecting WebSocket RPC
  client with id correlation.
- **`src/state/store.tsx`** — frame router: `message_update` partials → live streaming
  bubble, `tool_execution_*` → tool cards, terminal `agent_end` → transcript reconciliation
  + stats refresh, `extension_ui_request` → dialog stack.

## Usage

```sh
pnpm install
pnpm dev          # bridge on :8787 + vite dev server on :5173 (proxied)
```

Production (single process serves UI + WS + REST):

```sh
pnpm build
pnpm start        # http://127.0.0.1:8787
```

Requires `omp` on `PATH` (override with `OMP_BIN`, plus `OMP_CWD`, `OMP_ARGS`, `PORT`, `HOST`).
The bridge binds `127.0.0.1` and has **no auth** — it can drive your agent; keep it local.

```sh
node scripts/smoke.mjs                     # handshake: ready → v2 → state/stats/models
WS_URL=ws://127.0.0.1:8788/ws node scripts/smoke.mjs --prompt "hi"  # full streamed turn
node scripts/theme-shots.mjs               # default theme + accent preset screenshots
node scripts/recovery-test.mjs             # install-guide → refresh → chat recovery flow
node scripts/screenshot.mjs                # headless-Edge screenshots, light+dark
```
