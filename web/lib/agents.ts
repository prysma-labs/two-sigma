export const AGENTS = [
  {
    id: "quant",
    name: "MetaDAO investigator",
    blurb: "Proposals, decision markets, and launches",
    available: true,
  },
  {
    id: "onchain",
    name: "Solana auditor",
    blurb: "Programs, wallets, and transaction flows",
    available: true,
  },
  {
    id: "fundamental",
    name: "Equity researcher",
    blurb: "Filings, statements, and earnings",
    available: true,
  },
  {
    id: "hyperliquid",
    name: "Hyperliquid researcher",
    blurb: "Markets, funding, and protocol mechanics",
    available: true,
  },
  {
    id: "market",
    name: "Market structure researcher",
    blurb: "Liquidity, books, funding, and mechanics",
    available: false,
  },
] as const;

export type AgentId = (typeof AGENTS)[number]["id"];

const URL_ENV: Record<AgentId, string> = {
  quant: "AGENT_URL_QUANT",
  onchain: "AGENT_URL_ONCHAIN",
  fundamental: "AGENT_URL_FUNDAMENTAL",
  hyperliquid: "AGENT_URL_HYPERLIQUID",
  market: "AGENT_URL_MARKET",
};

export function isAgentId(value: string): value is AgentId {
  return Object.prototype.hasOwnProperty.call(URL_ENV, value);
}

export function agentById(id: string) {
  return AGENTS.find((agent) => agent.id === id);
}

export function agentBaseUrl(agentId: AgentId, env: NodeJS.ProcessEnv = process.env) {
  const key = URL_ENV[agentId];
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value.replace(/\/$/, "");
}
