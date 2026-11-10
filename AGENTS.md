# Stack

- `agent/` is a Pi Durable 1.3 process. One copy runs on each exe.dev VM. `AGENT_ID` selects the quant, on-chain, fundamental, or market prompt. The conversation stays in `agent/data/agent.sqlite` on that VM.
- `web/` is the Next.js frontend: Assistant UI and shadcn. Vercel hosts this directory. Set the project root to `web`. Do not deploy until asked.
- The browser talks only to `web`. `web` proxies the selected agent with `AGENT_URL_*` and `AGENT_SHARED_SECRET`, sent as `Authorization: Bearer`. The browser never sees those values.
- Supabase stores the event log (`events`: startup, error, tool). It is not the transcript. `SUPABASE_URL` and `SUPABASE_SECRET_KEY` stay on each VM. Do not put them in `web/` or Vercel.
- Do not put an OpenRouter key in the Vercel app. Prefer an exe.dev LLM integration (`OPENROUTER_BASE_URL`) so the key stays off the VM. Direct `OPENROUTER_API_KEY` is for local runs.
- The VM needs Node.js 24 or newer. Install `agent/pi-durable.service` at `/opt/research-agent`. Keep the VM private. A restart continues the stored conversation.
