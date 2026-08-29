# omp web

English | [简体中文](./README.zh-CN.md)

A web user interface for the [oh-my-pi](https://github.com/can1357/oh-my-pi) coding agent.
This project ships **only the UI and the communication layer** — all agent capability lives in
your local `omp` binary; nothing is reimplemented here.

![stack](https://img.shields.io/badge/vite%20%2B%20react%2019%20%2B%20ts%20%2B%20Tailwind%20v4-7c5cff)

## Features

- **Sidebar + conversation layout** — session list (parsed from `~/.omp/agent/sessions`),
  search, new chat, rename, delete, connection status.
- **Live streaming turns** — text/thinking deltas, tool-call cards with live status, abort,
  follow-up queueing while streaming (`prompt` with `streamingBehavior: "followUp"`).
- **Token consumption display** — per-message `↑input ↓output · cache · $cost · tok/s · model`
  chips, conversation totals and cost in the top bar, and a context-window usage meter
  (from `get_session_stats` / `get_state.contextUsage`).
- **Unified `/` command palette** — one popup for local commands and the session's skills
  (with descriptions, icons, and full-width keyboard-navigable list): plan, goal, handoff,
  compact. No-arg commands run on pick; arg-taking ones insert their token for completion.
  `@` file references stay a separate popup.
- **Plan mode** — mirror of omp's `/plan` (plan before executing). Prompts sent in plan mode
  are wrapped in a read-only planning contract that asks for the final plan in a fenced
  block tagged `plan`; the latest turn then gets a review bar with **Approve & implement**
  (exits plan mode) and copy. The top bar shows a Plan badge while active.
- **Goal mode** — mirror of omp's `/goal` (persistent autonomous objective). A goal banner
  shows the objective, status, and token-budget burn-down from native `goal_updated` events,
  with complete/resume/drop actions; `/goal <objective>` kicks off goal setup the same way
  omp's `/guided-goal` does (the agent creates the record with its `goal` tool). Plan and
  goal mode are mutually exclusive, as upstream.
- **Session handoff** — the native RPC `handoff` command (session menu and
  `/handoff [instructions]`): generates a handoff document, commits it as a compaction
  entry, and reloads the compacted transcript. Refuses mid-response, like the TUI.
- **Project & branch pickers** — project switcher (`/api/projects` → `/api/cwd`, with a
  filesystem browser) plus a git branch picker (`/api/branches`): list local branches,
  check out, or create + check out a new branch, operating in the agent's cwd.
- **Turn-end notifications** — optional browser notification (Notification API) when an
  agent turn finishes while the page is hidden; enabled from settings, which requests
  permission from its own toggle.
- **Install detection** — if the local `omp` binary is missing, a setup guide with
  per-platform install commands and a re-check button takes over the page.
- **Theming** — dark / light / system modes (default: dark) with a black graphite accent
  by default plus five preset accent colors (violet / blue / emerald / rose / amber),
  driven by the `--accent` token and switchable live from the sidebar.
- **Model & thinking pickers** — `get_available_models` → `set_model`, thinking levels →
  `set_thinking_level`; compaction button (`compact`).
- **Extension UI passthrough** — `select` / `confirm` / `input` / `editor` / `open_url`
  requests render as dialogs and answer via `extension_ui_response`.

## Architecture

```
browser ──WS /ws──▶ bridge (server/bridge.mjs) ──stdio JSONL──▶ omp --mode rpc --continue
        ──REST /api──▶ sessions, files, skills, branches, projects/fs/cwd, health, static dist/
```

- **`server/bridge.mjs`** — Node process owning one `omp --mode rpc` child per WebSocket
  connection. Negotiates **protocol v2** on the child's `ready` frame, reassembles
  `rpc_chunk` sequences server-side (strict ordering / interleaving / size validation per
  `docs/rpc.md`), and forwards clean frames both ways. Also serves the built frontend plus
  the REST endpoints backing the UI popovers (file search, skills, git branches via
  `server/git-branches.mjs`, project listing / cwd switch, session list & delete).
- **`src/rpc/`** — wire types mirrored from `rpc-types.ts` + a reconnecting WebSocket RPC
  client with id correlation.
- **`src/state/store.ts`** — frame router: `message_update` partials → live streaming
  bubble, `tool_execution_*` → tool cards, `goal_updated` → goal banner, terminal
  `agent_end` → transcript reconciliation + stats refresh + optional turn-end notification,
  `extension_ui_request` → dialog stack.
- **`src/lib/`** — pure, unit-tested helpers: slash-command parsing + palette
  (`slash.ts`), plan-mode contract (`planMode.ts`), goal prompts (`goalMode.ts`),
  notifications (`notify.ts`), formatting, theme, pins.

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
The branch picker additionally needs `git` on the bridge's PATH. Oversized prompts are
written to `<project>/.omp/scratch/` and referenced as files — add that directory to the
project's `.gitignore` if you commit the repo. The bridge binds `127.0.0.1` and has
**no auth** — it can drive your agent and run git in the agent directory; keep it local.

```sh
pnpm vitest run                            # unit tests (pure helpers + server modules)
node scripts/smoke.mjs                     # handshake: ready → v2 → state/stats/models
WS_URL=ws://127.0.0.1:8788/ws node scripts/smoke.mjs --prompt "hi"  # full streamed turn
node scripts/theme-shots.mjs               # default theme + accent preset screenshots
node scripts/recovery-test.mjs             # install-guide → refresh → chat recovery flow
node scripts/screenshot.mjs                # headless-Edge screenshots, light+dark
```
