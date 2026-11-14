import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";

const origin = "https://api.hyperliquid.xyz/info";
const actions = [
  "perpDexs",
  "markets",
  "spotMarkets",
  "mids",
  "book",
  "candles",
  "fundingHistory",
  "fundingCompare",
] as const;
const dexPattern = /^[A-Za-z0-9_-]{1,32}$/;
const intervals = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
} as const;
const sorts = [
  "dayNtlVlm",
  "change24hPct",
  "fundingAprPct",
  "fundingHrPct",
  "openInterest",
  "oiNotional",
  "markPx",
  "marketCap",
  "pair",
  "coin",
  "hlVsBinancePct",
  "hlVsBybitPct",
  "hlAprPct",
  "binanceAprPct",
  "bybitAprPct",
] as const;
const symbolPattern = /^[A-Za-z0-9_:@#./-]{1,64}$/;
const skill = stripFrontmatter(
  readFileSync(join(import.meta.dirname, "../skills/hyperliquid-reader/SKILL.md"), "utf8"),
);
const instructions = [
  "Use the hyperliquid tool for current read-only market data from Hyperliquid's public info API.",
  "It has no wallet, account access, order placement, cancellation, or transfer capability.",
  "Use perpDexs to discover HIP-3 venues. Pass dex for builder-deployed markets, such as xyz for XYZ or io for EntropyIO.",
  "Use markets for a perp snapshot, spotMarkets for spot, book for depth, candles for OHLCV, fundingHistory for realized funding, and fundingCompare for a primary-DEX cross-venue funding screen.",
  "If the API fails or a field is absent, say what is missing. Do not invent market data.",
].join(" ");

export default create();

function create() {
  if (process.env.AGENT_ID?.trim() !== "hyperliquid") {
    return defineExtension({ name: "hyperliquid" });
  }
  return defineExtension({
    name: "hyperliquid",
    sections: [section("hyperliquid", () => `${instructions}\n\n${skill}`, { tag: false })],
    tools: [
      defineTool({
        name: "hyperliquid",
        description: instructions,
        parameters: Type.Object({
          action: Type.Union(actions.map((action) => Type.Literal(action))),
          dex: Type.Optional(
            Type.String({ description: "HIP-3 perp DEX API name, such as xyz or io. Omit for the primary DEX." }),
          ),
          coin: Type.Optional(
            Type.String({
              description: "Perp symbol or spot pair, such as BTC, xyz:XYZ100, io:OAI, or PURR/USDC.",
            }),
          ),
          sort: Type.Optional(Type.Union(sorts.map((sort) => Type.Literal(sort)))),
          limit: Type.Optional(Type.Number({ description: "Maximum rows. 1-500." })),
          depth: Type.Optional(Type.Number({ description: "Book levels per side. 1-20." })),
          nSigFigs: Type.Optional(
            Type.Union([2, 3, 4, 5].map((value) => Type.Literal(value))),
          ),
          interval: Type.Optional(
            Type.Union(
              Object.keys(intervals).map((interval) =>
                Type.Literal(interval as keyof typeof intervals),
              ),
            ),
          ),
          hours: Type.Optional(Type.Number({ description: "Funding-history lookback in hours." })),
          canonicalOnly: Type.Optional(
            Type.Boolean({ description: "For spotMarkets, omit non-canonical @index pairs." }),
          ),
        }),
        replay: "safe",
        execute: async (args) => {
          try {
            return ok(await call(args));
          } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
          }
        },
      }),
    ],
  });
}

type Args = {
  action?: string;
  dex?: string;
  coin?: string;
  sort?: string;
  limit?: number;
  depth?: number;
  nSigFigs?: number;
  interval?: string;
  hours?: number;
  canonicalOnly?: boolean;
};

async function call(args: Args) {
  const action = args.action ?? "";
  if (!actions.includes(action as (typeof actions)[number])) {
    throw new Error(`action must be one of ${actions.join(", ")}`);
  }
  if (action === "perpDexs") return perpDexs();
  if (action === "markets") return markets(args);
  if (action === "spotMarkets") return spotMarkets(args);
  if (action === "mids") return mids(args);
  if (action === "book") return book(args);
  if (action === "candles") return candles(args);
  if (action === "fundingHistory") return fundingHistory(args);
  return fundingCompare(args);
}

async function perpDexs() {
  const response = await info({ type: "perpDexs" });
  return response.map((dex: Record<string, unknown> | null, index: number) =>
    dex ?? { name: "", fullName: "Hyperliquid", primary: index === 0 },
  );
}

async function markets(args: Args) {
  const [meta, contexts] = await info({ type: "metaAndAssetCtxs", ...dexBody(args.dex) });
  const rows = meta.universe.map((market: Record<string, unknown>, index: number) => {
    const context = contexts[index] ?? {};
    const mark = number(context.markPx);
    const previous = number(context.prevDayPx);
    const funding = number(context.funding);
    const openInterest = number(context.openInterest);
    return {
      coin: market.name,
      markPx: mark,
      midPx: number(context.midPx),
      oraclePx: number(context.oraclePx),
      change24hPct: ratioChange(mark, previous),
      fundingHrPct: funding === null ? null : funding * 100,
      fundingAprPct: funding === null ? null : funding * 100 * 24 * 365,
      openInterest,
      oiNotional: multiply(openInterest, mark),
      dayNtlVlm: number(context.dayNtlVlm),
      premiumPct: multiply(number(context.premium), 100),
      maxLeverage: number(market.maxLeverage),
    };
  });
  return selected(rows, args, "dayNtlVlm", "coin");
}

async function spotMarkets(args: Args) {
  if (args.dex) throw new Error("dex is only valid for perpetual markets");
  const [meta, contexts] = await info({ type: "spotMetaAndAssetCtxs" });
  const tokens = new Map<unknown, Record<string, unknown>>(
    meta.tokens.map((token: Record<string, unknown>) => [token.index, token]),
  );
  const rows = meta.universe.map((market: Record<string, unknown>, index: number) => {
    const context = contexts[index] ?? {};
    const token = tokens.get((market.tokens as unknown[])[0]) ?? {};
    const mark = number(context.markPx);
    const previous = number(context.prevDayPx);
    const supply = number(context.circulatingSupply);
    return {
      pair: market.name,
      base: token.name ?? null,
      markPx: mark,
      midPx: number(context.midPx),
      change24hPct: ratioChange(mark, previous),
      dayNtlVlm: number(context.dayNtlVlm),
      circulatingSupply: supply,
      marketCap: multiply(supply, mark),
      canonical: market.isCanonical === true,
    };
  });
  const filtered = args.canonicalOnly ? rows.filter((row: { canonical: boolean }) => row.canonical) : rows;
  return selected(filtered, args, "dayNtlVlm", "pair");
}

async function mids(args: Args) {
  const response = await info({ type: "allMids", ...dexBody(args.dex) });
  const filter = args.coin?.trim().toUpperCase() ?? "";
  const rows = Object.entries(response)
    .filter(([coin]) => !filter || coin.toUpperCase().includes(filter))
    .map(([coin, mid]) => ({ coin, mid: number(mid) }));
  return rows.slice(0, checkedInteger(args.limit, 20, 1, 500, "limit"));
}

async function book(args: Args) {
  const coin = qualifiedCoin(args);
  const depth = checkedInteger(args.depth, 10, 1, 20, "depth");
  const nSigFigs = args.nSigFigs;
  const response = await info({
    type: "l2Book",
    coin,
    ...(nSigFigs === undefined ? {} : { nSigFigs }),
  });
  return response.levels.flatMap((levels: Record<string, unknown>[], side: number) =>
    levels.slice(0, depth).map((level, index) => ({
      side: side === 0 ? "bid" : "ask",
      level: index + 1,
      px: number(level.px),
      sz: number(level.sz),
      orders: number(level.n),
    })),
  );
}

async function candles(args: Args) {
  const coin = qualifiedCoin(args);
  const interval = (args.interval ?? "1h") as keyof typeof intervals;
  if (!(interval in intervals)) throw new Error(`interval must be one of ${Object.keys(intervals).join(", ")}`);
  const limit = checkedInteger(args.limit, 100, 1, 500, "limit");
  const endTime = Date.now();
  const response = await info({
    type: "candleSnapshot",
    req: { coin, interval, startTime: endTime - intervals[interval] * limit, endTime },
  });
  return response.slice(-limit).map((candle: Record<string, unknown>) => ({
    time: new Date(Number(candle.t)).toISOString(),
    open: number(candle.o),
    high: number(candle.h),
    low: number(candle.l),
    close: number(candle.c),
    volume: number(candle.v),
    trades: number(candle.n),
  }));
}

async function fundingHistory(args: Args) {
  const coin = qualifiedCoin(args);
  const hours = checkedInteger(args.hours, 24, 1, 24 * 366, "hours");
  const limit = checkedInteger(args.limit, 500, 1, 500, "limit");
  const response = await info({
    type: "fundingHistory",
    coin,
    startTime: Date.now() - hours * 3_600_000,
  });
  return response
    .slice(-limit)
    .reverse()
    .map((item: Record<string, unknown>) => {
      const rate = number(item.fundingRate);
      return {
        coin: item.coin,
        fundingRatePct: multiply(rate, 100),
        fundingAprPct: multiply(rate, 100 * 24 * 365),
        premiumPct: multiply(number(item.premium), 100),
        time: new Date(Number(item.time)).toISOString(),
      };
    });
}

async function fundingCompare(args: Args) {
  if (args.dex || args.coin?.includes(":")) {
    throw new Error("fundingCompare is only supported for Hyperliquid's primary perp DEX");
  }
  const response = await info({ type: "predictedFundings" });
  const rows = response.map(([coin, venues]: [string, [string, Record<string, unknown> | null][]]) => {
    const rates = new Map(
      venues.map(([venue, value]) => [
        venue,
        value ? apr(number(value.fundingRate), number(value.fundingIntervalHours)) : null,
      ]),
    );
    const hl = rates.get("HlPerp") ?? null;
    const binance = rates.get("BinPerp") ?? null;
    const bybit = rates.get("BybitPerp") ?? null;
    const next = venues.find(([venue]) => venue === "HlPerp")?.[1]?.nextFundingTime;
    return {
      coin,
      hlAprPct: hl,
      binanceAprPct: binance,
      bybitAprPct: bybit,
      hlVsBinancePct: difference(hl, binance),
      hlVsBybitPct: difference(hl, bybit),
      nextHlFunding:
        typeof next === "number" ? new Date(next).toISOString() : null,
    };
  });
  return selected(rows, args, "hlVsBinancePct", "coin", true);
}

async function info(body: Record<string, unknown>) {
  const response = await fetch(origin, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hyperliquid info HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function selected(
  rows: Record<string, unknown>[],
  args: Args,
  defaultSort: string,
  nameField: string,
  absolute = false,
) {
  const filter = args.coin?.trim().toUpperCase() ?? "";
  const filtered = filter
    ? rows.filter((row) => String(row[nameField] ?? "").toUpperCase().includes(filter))
    : rows;
  const sort = args.sort ?? defaultSort;
  if (!sorts.includes(sort as (typeof sorts)[number])) throw new Error(`unsupported sort: ${sort}`);
  filtered.sort((a, b) => compare(a[sort], b[sort], sort === nameField, absolute));
  return filtered.slice(0, checkedInteger(args.limit, 20, 1, 500, "limit"));
}

function compare(a: unknown, b: unknown, text: boolean, absolute: boolean) {
  if (text) return String(a).localeCompare(String(b));
  const left = typeof a === "number" ? a : Number.NEGATIVE_INFINITY;
  const right = typeof b === "number" ? b : Number.NEGATIVE_INFINITY;
  return (absolute ? Math.abs(right) - Math.abs(left) : right - left);
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratioChange(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0
    ? null
    : (current / previous - 1) * 100;
}

function multiply(left: number | null, right: number | null) {
  return left === null || right === null ? null : left * right;
}

function difference(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right;
}

function apr(rate: number | null, hours: number | null) {
  return rate === null || hours === null || hours <= 0 ? null : rate * 100 * (24 / hours) * 365;
}

function dexBody(value: string | undefined) {
  const dex = checkedDex(value);
  return dex ? { dex } : {};
}

function checkedDex(value: string | undefined) {
  const dex = value?.trim() ?? "";
  if (dex && !dexPattern.test(dex)) throw new Error("dex must be a Hyperliquid perp DEX API name");
  return dex;
}

function qualifiedCoin(args: Args) {
  const coin = checkedSymbol(args.coin);
  const dex = checkedDex(args.dex);
  if (!dex) return coin;
  if (coin.includes("/")) throw new Error("dex is only valid for perpetual markets");
  if (!coin.includes(":")) return `${dex}:${coin}`;
  if (coin.slice(0, coin.indexOf(":")) !== dex) {
    throw new Error(`coin prefix must match dex ${dex}`);
  }
  return coin;
}

function checkedSymbol(value: string | undefined) {
  const symbol = value?.trim() ?? "";
  if (!symbolPattern.test(symbol)) throw new Error("coin must be a Hyperliquid perp symbol or spot pair");
  return symbol;
}

function checkedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return result;
}

function ok(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return {
    output: [
      {
        type: "text" as const,
        text: text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[truncated; narrow the query]` : text,
      },
    ],
  };
}

function fail(text: string) {
  return { isError: true, output: [{ type: "text" as const, text }] };
}

function stripFrontmatter(text: string) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end < 0 ? text : text.slice(end + 5);
}
