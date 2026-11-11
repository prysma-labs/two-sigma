# Stack

Four research chats. The browser talks only to `web/`. That app proxies the selected agent. It never sees the VM URL, the shared secret, Supabase, or an OpenRouter key, and it does not call a model.

- **Next.js** (`web/`, App Router) is the site. Vercel hosts it. Route handlers proxy the agent selected in the sidebar.
- **assistant-ui** renders the Ask thread from the agent's event stream. It does not talk to a model provider.
- **shadcn** (`base-nova`) supplies the components, on **Base UI** and **Tailwind**. The skin is [neobrutalism](https://www.neobrutalism.dev): 2px black borders, a 5px radius, and a hard 4px offset shadow. Ask and Observe use its [Tabs](https://www.neobrutalism.dev/docs/tabs) component.
- **Pi Durable 1.3** (`agent/agent.ts`, `@earendil-works/pi-durable`, `pi-ai`, and `chord`) is the agent process. One copy runs on each **exe.dev** VM. The conversation is a **SQLite** file on that VM, so a restart continues the same chat.
- **OpenRouter** serves the model, `deepseek/deepseek-v4.1-flash-1017`. The key stays on the VM, or off the VM entirely behind an exe.dev LLM integration.
- **Supabase** stores the event log only (`startup`, `error`, `tool`). It is not the transcript.

## Web

Vercel hosts `web/` (project `two-sigma`, root `web`, https://www.twosigma.fun/). Do not deploy until asked. Ask and Observe are `web/components/ui/tabs.tsx`, installed from `https://neobrutalism.dev/r/tabs.json`.

`web/` proxies `/api/agents/<id>/{events,messages,stop,reset,observe}` with `AGENT_URL_*` and `Authorization: Bearer <AGENT_SHARED_SECRET>`.

| Web route | VM route |
| --- | --- |
| `GET .../events` | `GET /api/events` (SSE) |
| `POST .../messages` | `POST /api/messages` |
| `POST .../stop` | `POST /api/stop` |
| `POST .../reset` | `POST /api/reset` |
| `GET .../observe` | `GET /api/observe` |

Messages are capped at 8000 characters. Chat input uses `whenBusy: "steer"`.

## Agents

One Pi Durable 1.3 process per VM (`agent/agent.ts`), listening on `127.0.0.1:8000`. `AGENT_ID` picks the prompt in `agent/prompts.ts`. The conversation stays in `agent/data/agent.sqlite` on that VM. A restart continues it. Node.js 24 or newer. Install `agent/pi-durable.service` at `/opt/research-agent`.

| Id | VM |
| --- | --- |
| `quant` | https://quant-researcher.exe.xyz |
| `onchain` | https://onchain-researcher.exe.xyz |
| `fundamental` | https://fundamental-researcher.exe.xyz |
| `market` | https://market-researcher.exe.xyz |

Prompts have no data feed and no tools. Missing figures must be named, not invented. Tools belong in `agent/extensions/*.ts` as `defineExtension()` and hot-reload. `read`, `write`, `edit`, and `bash` are absent until an extension adds them.

Model: `deepseek/deepseek-v4.1-flash-1017` via OpenRouter (`OPENROUTER_MODEL`). The pinned Pi catalog may not list that id; register it from the `deepseek/deepseek-v4.1-flash` entry before the harness opens.

## Data

Supabase project `two-sigma` (`us-west-1`) stores `public.events` only (`startup`, `error`, `tool`). It is not the transcript. Row level security is on and there are no policies. Leave `SUPABASE_URL` unset to skip the log.

## Secrets

| Name | Where |
| --- | --- |
| `AGENT_SHARED_SECRET` | Vercel server env and each VM `agent.env` |
| `AGENT_URL_*` | Vercel server env only |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Each VM `agent.env` only. Do not put them in `web/` or Vercel |
| `OPENROUTER_API_KEY` | Each VM, for a direct local run |
| `OPENROUTER_BASE_URL` | Optional. Prefer an exe.dev LLM integration so the key stays off the VM |
| `OPENROUTER_MODEL`, `AGENT_ID` | Each VM |

Do not put an OpenRouter key in the Vercel app. Copy `web/.env.example` to `web/.env.local`. Copy `agent/agent.env.example` to `agent/agent.env` on each VM, mode 600. Never commit `.env.local`, `agent.env`, `agent/data`, `agent/workspace`, or `.secrets/`.

## Local

```bash
cd web && npm install && npm test && npm run dev
cd agent && npm install && npm start
```
