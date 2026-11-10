# two-sigma

Four research agents. The browser talks only to the Next.js app in `web/` (Vercel project `two-sigma`, root `web`, https://two-sigma-eight.vercel.app). That app proxies the selected agent with `AGENT_URL_*` and `Authorization: Bearer <AGENT_SHARED_SECRET>`. The browser never sees the VM URL, the secret, Supabase, or an OpenRouter key. Do not deploy until asked.

Each agent is one Pi Durable 1.3 process (`agent/agent.ts`) on its own exe.dev VM, listening on `127.0.0.1:8000`. `AGENT_ID` picks the prompt in `agent/prompts.ts`. The conversation stays in `agent/data/agent.sqlite` on that VM. A restart continues it. Node.js 24+. systemd unit `agent/pi-durable.service` runs from `/opt/research-agent`.

| Id | VM |
| --- | --- |
| `quant` | https://quant-researcher.exe.xyz |
| `onchain` | https://onchain-researcher.exe.xyz |
| `fundamental` | https://fundamental-researcher.exe.xyz |
| `market` | https://market-researcher.exe.xyz |

Model: `deepseek/deepseek-v4.1-flash-1017` via OpenRouter (`OPENROUTER_MODEL`). Prompts have no data feed and no tools. Missing figures must be named, not invented. Tools belong in `agent/extensions/*.ts` as `defineExtension()` and hot-reload. `read` / `write` / `edit` / `bash` are absent until an extension adds them.

The VM HTTP API requires the bearer secret. `web/` proxies `/api/agents/<id>/{events,messages,stop,reset,observe}` to `GET /api/events` (SSE), `POST /api/messages`, `POST /api/stop`, `POST /api/reset`, and `GET /api/observe`. Messages are capped at 8000 characters. Chat input uses `whenBusy: "steer"`. The UI is assistant-ui plus shadcn: an Ask thread and an Observe tab of tool calls.

Supabase project `two-sigma` (`us-west-1`) stores `public.events` only (`startup`, `error`, `tool`). It is not the transcript. RLS is on and there are no policies. `SUPABASE_URL` and `SUPABASE_SECRET_KEY` stay on the VM. Leave the URL unset to skip the log. Do not put an OpenRouter key on Vercel. Prefer `OPENROUTER_BASE_URL` (exe.dev LLM integration) so the key stays off the VM. Direct `OPENROUTER_API_KEY` is for local runs. Copy `web/.env.example` to `web/.env.local` and `agent/agent.env.example` to `agent.env` (mode 600). Never commit `.env.local`, `agent.env`, or `.secrets/`.

```bash
cd web && npm install && npm test && npm run dev
cd agent && npm install && npm start
```

Remote: `git@github.com:prysma-labs/two-sigma.git`. This working tree is uncommitted. `origin/main` (`22c6fc0`) is the previous app: Next.js at the repo root, `@earendil-works/pi-coding-agent` 1.4.0, transcript in Supabase `messages` and `runs`. Live VMs may still be that build until this tree is copied over. The new migration drops those tables.
