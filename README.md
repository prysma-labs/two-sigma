# Research chat

Four research agents. Each one is a Pi Durable process on its own exe.dev VM and keeps its own conversation in SQLite. The Next.js app proxies the agent selected in the sidebar. The browser never sees the VM URL or the shared secret.

## Live services

The four VMs are public on port 8000:

- https://quant-researcher.exe.xyz
- https://onchain-researcher.exe.xyz
- https://fundamental-researcher.exe.xyz
- https://market-researcher.exe.xyz

Supabase project `two-sigma` is in Prysma Labs (`us-west-1`). It stores the event log only. Row level security is on and there are no policies, so the public Data API cannot read or write `events`.

The website is deployed at https://two-sigma-eight.vercel.app (Prysma Labs project `two-sigma`). Vercel Authentication is on. Do not commit `.env.local` or `.secrets/`. The Vercel project root is `web`.

Model for all four agents: `deepseek/deepseek-v4.1-flash-1017`.

## Secrets

| Name | Where |
| --- | --- |
| `AGENT_SHARED_SECRET` | Vercel server env and each VM `agent.env` |
| `AGENT_URL_*` | Vercel server env only |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Each VM `agent.env` only |
| `OPENROUTER_API_KEY` | Each VM `agent.env` only |
| `AGENT_ID`, `OPENROUTER_MODEL` | Each VM `agent.env` |

Copy `web/.env.example` to `web/.env.local`. Copy `agent/agent.env.example` to `agent/agent.env` on each VM, mode 600. Never commit those files. None of these use a `NEXT_PUBLIC_` name.

## Local

```bash
cd web
npm install
npm test
npm run dev
```

```bash
cd agent
npm install
npm start
```

## VMs

Listen on `127.0.0.1:8000`. exe.dev proxies that port at `https://<name>.exe.xyz`. Make the share public so Vercel can call it, and keep `AGENT_SHARED_SECRET` on the request:

```bash
ssh exe.dev share port <vm> 8000
ssh exe.dev share set-public <vm>
```

Copy `agent/` to `/opt/research-agent`, write `/opt/research-agent/agent.env` as mode 600, then install `agent/pi-durable.service`. The VM needs Node.js 24 or newer. A restart continues the SQLite conversation. This repo does not restart the live VMs.

VM names: `quant-researcher`, `onchain-researcher`, `fundamental-researcher`, `market-researcher`.

## Vercel

Put the web server variables in the project environment and set the project root to `web`. The browser opens one event stream for the selected agent.
