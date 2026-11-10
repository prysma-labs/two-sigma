---
name: pi-durable
description: Work on this repo's Pi Durable 1.3 agent process in agent/. Use when editing the harness, extensions, models, storage, sessions, compaction, the agent HTTP API, the exe.dev VM service, or when the user mentions Pi, Pi Durable, pi-durable, Harness, or @earendil-works/pi-durable. Product behavior is defined at https://pi.dev/docs/latest; the process API is the pinned @earendil-works/pi-durable package.
---

# Pi Durable

`agent/` is a long-running Pi Durable 1.3 process. It is not the Pi terminal CLI.

Product concepts (agent loop, sessions, context, tools, trust) are at [https://pi.dev/docs/latest](https://pi.dev/docs/latest). Implementation calls go through `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, and `@earendil-works/chord`, all pinned to `1.3.0`. The package is experimental: before calling a method, read that symbol in `agent/node_modules/@earendil-works/pi-durable`. Types and the package README win over memory. Do not port CLI or `@earendil-works/pi-coding-agent` APIs into this process (`createAgentSession`, `pi.registerTool`, `~/.pi/agent/sessions`, `/login`, `--mode rpc`).

## Read first

| Change | Read |
| --- | --- |
| How a run, turn, steer, or compaction behaves | [How Pi works](https://pi.dev/docs/latest/how-pi-works), [Sessions](https://pi.dev/docs/latest/sessions) |
| Tools, extensions, or unattended runs | [Security](https://pi.dev/docs/latest/security) |
| A harness method, entry kind, or document | Package README section for that feature, then the matching `.d.ts` |
| This deployment | Root `AGENTS.md` and `agent/agent.ts` |

Page map: [reference.md](reference.md).

## This process

`agent/agent.ts` opens one SQLite harness, one root conversation, and a small HTTP server.

- Storage: `agent/data/agent.sqlite` via `openNodeSqliteStorage`. One process owns the file. There is no cross-process lock.
- Working directory: `agent/workspace`, passed as `cwd` into `NodeExecutionEnv`. Tool paths resolve from there. The directory is not a sandbox.
- Model: `OPENROUTER_MODEL`, default `deepseek/deepseek-v4.1-flash-1017`. `configure({ model })` runs when the stored `pi.agent` model differs. `AGENT_ID` selects the quant, on-chain, fundamental, or market prompt.
- Credentials: `OPENROUTER_API_KEY` for a direct local run. On the VM, set `OPENROUTER_BASE_URL` to the exe.dev LLM integration and keep the real key off the VM and out of `web/`. A base URL uses `OPENROUTER_API_KEY` or the placeholder `exe-llm-integration`.
- Auth on each request: `Authorization: Bearer <AGENT_SHARED_SECRET>`. Missing identity is 401.
- Event log: startup, errors, and finished tool calls go to Supabase `events`. The conversation stays in SQLite. Leave `SUPABASE_URL` unset to skip the log.
- Restart: `agent/pi-durable.service` (`Restart=always`) from `/opt/research-agent`. The VM needs Node.js 24+. `harness.resume()` continues a run the last process left unfinished. `SIGTERM` closes the harness before exit.
- Extensions: every `agent/extensions/*.ts` file is imported and `registry.install`ed, and reloaded when the file changes. The default export must be a `defineExtension()` result. Installing the same name replaces the extension; a call already running keeps the code it started with.

`web/` never talks to OpenRouter. It proxies `/api/agents/<id>/messages`, `/events`, `/stop`, `/reset`, and `/observe` to that VM's `AGENT_URL_*` with `AGENT_SHARED_SECRET`. Do not add an OpenRouter key, model call, or a second agent protocol to `web/`.

Do not commit `agent/agent.env`, `agent/data`, or `agent/workspace`.

## Agent loop

A submitted input is committed before it is shown. A **turn** is one model response plus its tool calls. A **run** is the turns from that input until the answer. The model sees entries after the newest reset, with compaction summaries standing in for older entries. Original entries stay in storage.

Busy conversation, `whenBusy`:

- `steer` joins the current run after the current tool round. This process sends chat input this way.
- follow-up (the harness default) starts the next run after the answer.
- `reject` throws while busy.

`root.abort(context)` stops the run and withdraws queued inputs. `requestId` is idempotent across retries and restarts. A storage error fails the harness; reopen it and resubmit the same `requestId` rather than inventing a second write path.

Built-in documents the UI already reads: `pi.agent`, `pi.live`, `pi.inbox`. Entry kinds this process renders: `chat.input`, `pi.user`, `pi.assistant`, `pi.tool-result`, `pi.compaction`, `pi.reset`. Custom kinds must not start with `pi.`.

## HTTP

Keep these routes. They are what `web/` calls.

| Method and path | Behavior |
| --- | --- |
| `GET /api/state` | JSON summary: `busy`, `model`, `items`. Items are only those after the newest reset |
| `GET /api/events` | SSE of that summary. Server pushes on view updates and pings every 25s |
| `POST /api/messages` | `{ text, requestId?, wait? }`. `202` with submission id unless `wait` |
| `POST /api/stop` | `root.abort` |
| `POST /api/reset` | Abort the run, then `root.reset` so the conversation starts empty |

`wait: true` waits for the submission, then reads the assistant entry at `settled.answer`. A write of only `kind` and `data` is not a model input; chat input here is `type: "input"` plus an `entry`.

## Changing behavior

Add tools, prompt sections, and hooks as extensions under `agent/extensions/`, not by forking harness internals.

```typescript
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

export default defineExtension({
  name: "example",
  sections: [section("example", () => "Stable instructions. Do not embed the current time.")],
  tools: [
    defineTool({
      name: "example",
      description: "What the model uses this for",
      parameters: Type.Object({}),
      execute: async () => ({ output: [{ type: "text", text: "ok" }] }),
    }),
  ],
});
```

- Prompt sections are part of the provider cache. A section that changes every request defeats that cache.
- This process does not install `CodingTools`. `read`, `write`, `edit`, and `bash` exist only after an extension registers them. They run as the process user. Read [Security](https://pi.dev/docs/latest/security) before adding them. Declare `replay: "safe"` only when a rerun after a crash is idempotent.
- `beforeTool` may block or rewrite a call. A throwing hook is skipped; a throwing `beforeTool` blocks the call.
- Per-conversation choices (`model`, `tools`, `instructions`, `cwd`) go through `configure()` and persist in `pi.agent`. Host `settings` are not stored.
- Conversation-scoped app state is a `defineDoc()`, edited inside `commit()`, not a module-level variable.
- Nothing is durable until its commit lands. Do not show or return uncommitted model or tool output.

## Checks

- The model stays `openrouter` / `meta/muse-spark-1.3-contributor` in `agent/agent.ts`, not in an env file.
- Direct runs still require `OPENROUTER_API_KEY` when `OPENROUTER_BASE_URL` is unset.
- Unauthorized callers still get 401. The browser still reaches the agent only through `web/`.
- A restart still calls `harness.resume()` and still serves the same SQLite file.
