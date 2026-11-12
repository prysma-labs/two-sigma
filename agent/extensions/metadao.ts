import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

const origin = "https://market-api.metadao.fi";
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const actions = ["tickers", "market", "supply", "launches", "health"] as const;
const views = ["full", "total", "circulating"] as const;

const instructions = [
  "Use the metadao tool for the public Futarchy market API at https://market-api.metadao.fi. It is read-only.",
  "tickers returns a spot price, 24-hour volume, and liquidity for each DAO. Those prices come from spot pool reserves, not from conditional pass/fail markets or a proposal TWAP.",
  "market returns daily FutarchyAMM and Meteora activity. It requires startDate and endDate as YYYY-MM-DD, inclusive, spanning at most 366 days. Pass tokens as comma-separated mints unless the range is three days or fewer.",
  "supply requires a mint. full returns the breakdown, total returns total supply, and circulating excludes the team performance package while including AMM and Meteora liquidity.",
  "launches returns open launchpad raises. health returns served-database freshness.",
  "If the API fails or a field is absent, say what is missing and stop. Do not invent prices, supply, volume, or launches.",
].join(" ");

export default create();

function create() {
  if (process.env.AGENT_ID?.trim() !== "quant") return defineExtension({ name: "metadao" });
  return defineExtension({
    name: "metadao",
    sections: [section("metadao", () => instructions, { tag: false })],
    tools: [
      defineTool({
        name: "metadao",
        description: instructions,
        parameters: Type.Object({
          action: Type.Union([
            Type.Literal("tickers"),
            Type.Literal("market"),
            Type.Literal("supply"),
            Type.Literal("launches"),
            Type.Literal("health"),
          ]),
          mint: Type.Optional(Type.String({ description: "SPL mint. Required for supply." })),
          view: Type.Optional(
            Type.Union([Type.Literal("full"), Type.Literal("total"), Type.Literal("circulating")]),
          ),
          startDate: Type.Optional(Type.String({ description: "UTC day YYYY-MM-DD. Required for market." })),
          endDate: Type.Optional(Type.String({ description: "UTC day YYYY-MM-DD. Required for market." })),
          tokens: Type.Optional(Type.String({ description: "Comma-separated mints, at most 100. Optional filter for market." })),
        }),
        replay: "safe",
        execute: async (args) => {
          try {
            return await call(args);
          } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
          }
        },
      }),
    ],
  });
}

async function call(args: {
  action?: string;
  mint?: string;
  view?: string;
  startDate?: string;
  endDate?: string;
  tokens?: string;
}) {
  const action = args.action ?? "";
  if (!actions.includes(action as (typeof actions)[number])) {
    return fail(`action must be one of ${actions.join(", ")}`);
  }
  const path = route(action, args);
  if (typeof path !== "string") return path;
  const response = await fetch(`${origin}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  const text = body.length > 120_000 ? `${body.slice(0, 120_000)}\n\n[truncated; narrow the dates or tokens]` : body;
  return {
    isError: !response.ok,
    output: [{ type: "text" as const, text: `HTTP ${response.status} ${path}\n${text}` }],
  };
}

function route(
  action: string,
  args: { mint?: string; view?: string; startDate?: string; endDate?: string; tokens?: string },
) {
  if (action === "tickers") return "/api/tickers";
  if (action === "launches") return "/api/launches/live";
  if (action === "health") return "/api/health";
  if (action === "supply") {
    const mint = checkedMint(args.mint);
    if (typeof mint !== "string") return mint;
    const view = args.view ?? "full";
    if (!views.includes(view as (typeof views)[number])) return fail("view must be full, total, or circulating");
    return view === "full" ? `/api/supply/${mint}` : `/api/supply/${mint}/${view}`;
  }
  const start = day(args.startDate);
  const end = day(args.endDate);
  if (!start || !end) return fail("market requires startDate and endDate as YYYY-MM-DD");
  if (start > end) return fail("startDate must be on or before endDate");
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (span > 366) return fail("market range must be 366 days or fewer");
  const tokens = checkedTokens(args.tokens);
  if (!Array.isArray(tokens)) return tokens;
  if (tokens.length === 0 && span > 3) {
    return fail("pass tokens, or keep a market range to three days when requesting every token");
  }
  const query = new URLSearchParams({ startDate: args.startDate!, endDate: args.endDate! });
  if (tokens.length > 0) query.set("tokens", tokens.join(","));
  return `/api/market-data?${query}`;
}

function checkedMint(value: string | undefined) {
  const mint = value?.trim() ?? "";
  if (!mintPattern.test(mint)) return fail("mint must be a Solana address");
  return mint;
}

function checkedTokens(value: string | undefined) {
  const tokens = (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length > 100) return fail("tokens accepts at most 100 mints");
  for (const token of tokens) {
    if (!mintPattern.test(token)) return fail(`tokens contains an invalid mint: ${token}`);
  }
  return tokens;
}

function day(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, date] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    return null;
  }
  return parsed;
}

function fail(text: string) {
  return { isError: true, output: [{ type: "text" as const, text }] };
}
