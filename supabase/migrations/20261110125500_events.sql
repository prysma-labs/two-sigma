drop table if exists public.messages;
drop table if exists public.runs;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  constraint events_agent_id_known check (
    agent_id in ('quant', 'onchain', 'fundamental', 'market')
  ),
  constraint events_kind_known check (kind in ('startup', 'error', 'tool'))
);

create index events_agent_at_idx
  on public.events (agent_id, at desc);

create unique index events_tool_id_idx
  on public.events (agent_id, (payload->>'id'))
  where kind = 'tool' and payload->>'id' is not null;

alter table public.events enable row level security;

revoke all on table public.events from anon, authenticated;
