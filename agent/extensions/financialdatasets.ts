import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const origin = "https://api.financialdatasets.ai";
const paths = [
  "/prices",
  "/prices/snapshot",
  "/financial-metrics",
  "/financial-metrics/snapshot",
  "/financials",
  "/financials/income-statements",
  "/financials/balance-sheets",
  "/financials/cash-flow-statements",
  "/financials/segments",
  "/financials/income-statements/segments",
  "/financials/balance-sheets/segments",
  "/financials/cash-flow-statements/segments",
  "/company/facts",
  "/filings",
  "/earnings",
  "/news",
  "/insider-trades",
  "/insider-ownership",
  "/beneficial-ownership",
  "/activist-ownership",
  "/institutional-holdings",
  "/index-funds",
  "/macro/interest-rates",
  "/macro/interest-rates/snapshot",
  "/macro/yield-curve",
  "/macro/yield-curve/snapshot",
  "/macro/inflation",
  "/macro/inflation/snapshot",
  "/macro/labor",
  "/macro/labor/snapshot",
  "/macro/gdp",
  "/macro/gdp/snapshot",
  "/macro/gpu-prices",
  "/macro/gpu-prices/snapshot",
  "/ipos",
  "/kpi/metrics",
  "/kpi/guidance",
  "/kpi/non-gaap",
] as const;

const periods = ["annual", "quarterly", "ttm"] as const;
const intervals = ["day", "week", "month", "year"] as const;
const instructions = [
  "Use the financialdatasets tool for US public-company filings, financial statements, earnings, ownership, prices, and macro series from https://api.financialdatasets.ai.",
  "Each call is a GET paid with USDC on Base over x402. There is no API key. A call priced above $1 is refused before it is signed. x402 covers the last 365 days.",
  "Pass one path and only the query fields that endpoint needs. Prices use ticker, interval, start_date, and end_date. Statements use ticker, period, and limit. Macro interest rates use bank.",
  "If the call fails or a figure is absent, say what is missing and stop. Do not invent filings, statements, prices, holders, or macro prints.",
].join(" ");

type Query = {
  ticker?: string;
  period?: string;
  limit?: string;
  start_date?: string;
  end_date?: string;
  interval?: string;
  cik?: string;
  bank?: string;
  filing_type?: string;
  report_period?: string;
  market?: string;
  isin?: string;
  filer_cik?: string;
};

export default create();

function create() {
  if (process.env.AGENT_ID?.trim() !== "fundamental") return defineExtension({ name: "financialdatasets" });
  let keyNote = "X402_PRIVATE_KEY is not set. Calls will fail until a Base wallet key is set on this process.";
  try {
    if (walletKey()) keyNote = "X402_PRIVATE_KEY is set.";
  } catch (error) {
    keyNote = error instanceof Error ? error.message : String(error);
  }
  return defineExtension({
    name: "financialdatasets",
    sections: [
      section("financialdatasets", () => [instructions, keyNote].join(" "), { tag: false }),
    ],
    tools: [
      defineTool({
        name: "financialdatasets",
        description: instructions,
        parameters: Type.Object({
          path: Type.Union(paths.map((path) => Type.Literal(path))),
          ticker: Type.Optional(Type.String({ description: "US ticker, such as AAPL. Dots are allowed." })),
          period: Type.Optional(Type.Union(periods.map((period) => Type.Literal(period)))),
          limit: Type.Optional(Type.String({ description: "Positive integer, at most 20." })),
          start_date: Type.Optional(Type.String({ description: "YYYY-MM-DD within the last 365 days." })),
          end_date: Type.Optional(Type.String({ description: "YYYY-MM-DD within the last 365 days." })),
          interval: Type.Optional(Type.Union(intervals.map((interval) => Type.Literal(interval)))),
          cik: Type.Optional(Type.String({ description: "SEC CIK, digits only." })),
          bank: Type.Optional(Type.String({ description: "Central bank code, such as FED, ECB, or BOJ." })),
          filing_type: Type.Optional(Type.String({ description: "Filing form, such as 10-K, 10-Q, or 8-K." })),
          report_period: Type.Optional(Type.String({ description: "YYYY-MM-DD within the last 365 days." })),
          market: Type.Optional(Type.String({ description: "Two-letter market code." })),
          isin: Type.Optional(Type.String()),
          filer_cik: Type.Optional(Type.String({ description: "13F filer CIK, digits only." })),
        }),
        execute: async (args) => {
          try {
            return await call(args);
          } catch (error) {
            return fail(redact(error instanceof Error ? error.message : String(error)));
          }
        },
      }),
    ],
  });
}

async function call(args: Query & { path?: string }) {
  const path = args.path ?? "";
  if (!paths.includes(path as (typeof paths)[number])) return fail(`path must be one of ${paths.join(", ")}`);
  const query = checkedQuery(args);
  if (!Array.isArray(query)) return query;
  const target = query.length ? `${origin}${path}?${new URLSearchParams(query)}` : `${origin}${path}`;
  const response = await paidFetch()(target, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  const text = body.length > 120_000 ? `${body.slice(0, 120_000)}\n\n[truncated; narrow the query]` : body;
  const receipt = response.ok ? paymentReceipt(response.headers.get("payment-response")) : "";
  return {
    isError: !response.ok,
    output: [{ type: "text" as const, text: `HTTP ${response.status} ${path}${receipt}\n${text}` }],
  };
}

function checkedQuery(args: Query) {
  const pairs: [string, string][] = [];
  const ticker = optional(args.ticker, /^[A-Za-z0-9.]{1,12}$/);
  if (ticker === null) return fail("ticker must be 1-12 letters, digits, or dots");
  if (ticker) pairs.push(["ticker", ticker.toUpperCase()]);
  const period = optional(args.period, /^(annual|quarterly|ttm)$/);
  if (period === null) return fail("period must be annual, quarterly, or ttm");
  if (period) pairs.push(["period", period]);
  const limit = optional(args.limit, /^[1-9]\d*$/);
  if (limit === null || (limit && Number(limit) > 20)) return fail("limit must be an integer from 1 to 20");
  if (limit) pairs.push(["limit", limit]);
  const start = dated(args.start_date, "start_date");
  if (typeof start !== "string" && start) return start;
  if (typeof start === "string" && start) pairs.push(["start_date", start]);
  const end = dated(args.end_date, "end_date");
  if (typeof end !== "string" && end) return end;
  if (typeof end === "string" && end) pairs.push(["end_date", end]);
  if (typeof start === "string" && start && typeof end === "string" && end && start > end) {
    return fail("start_date must be on or before end_date");
  }
  const interval = optional(args.interval, /^(day|week|month|year)$/);
  if (interval === null) return fail("interval must be day, week, month, or year");
  if (interval) pairs.push(["interval", interval]);
  const cik = optional(args.cik, /^\d{1,10}$/);
  if (cik === null) return fail("cik must be 1-10 digits");
  if (cik) pairs.push(["cik", cik]);
  const bank = optional(args.bank, /^[A-Za-z]{2,8}$/);
  if (bank === null) return fail("bank must be 2-8 letters");
  if (bank) pairs.push(["bank", bank.toUpperCase()]);
  const filingType = optional(args.filing_type, /^[A-Za-z0-9-]{1,12}$/);
  if (filingType === null) return fail("filing_type must be 1-12 letters, digits, or hyphens");
  if (filingType) pairs.push(["filing_type", filingType.toUpperCase()]);
  const reportPeriod = dated(args.report_period, "report_period");
  if (typeof reportPeriod !== "string" && reportPeriod) return reportPeriod;
  if (typeof reportPeriod === "string" && reportPeriod) pairs.push(["report_period", reportPeriod]);
  const market = optional(args.market, /^[A-Za-z]{2}$/);
  if (market === null) return fail("market must be two letters");
  if (market) pairs.push(["market", market.toUpperCase()]);
  const isin = optional(args.isin, /^[A-Za-z]{2}[A-Za-z0-9]{10}$/);
  if (isin === null) return fail("isin must be 12 letters or digits");
  if (isin) pairs.push(["isin", isin.toUpperCase()]);
  const filer = optional(args.filer_cik, /^\d{1,10}$/);
  if (filer === null) return fail("filer_cik must be 1-10 digits");
  if (filer) pairs.push(["filer_cik", filer]);
  return pairs;
}

function optional(value: string | undefined, pattern: RegExp) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  if (!pattern.test(text)) return null;
  return text;
}

function dated(value: string | undefined, name: string) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  const parsed = day(text);
  if (!parsed) return fail(`${name} must be YYYY-MM-DD`);
  const today = new Date();
  const utc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const age = Math.round((utc - parsed.getTime()) / 86_400_000);
  if (age < 0 || age > 366) return fail(`${name} must fall within the last 365 days`);
  return text;
}

function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, date] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) {
    return null;
  }
  return parsed;
}

let payer: ReturnType<typeof wrapFetchWithPayment> | undefined;

function paidFetch() {
  if (!payer) {
    const key = walletKey();
    if (!key) throw new Error("X402_PRIVATE_KEY is not set. Each call pays USDC on Base, and this process has no wallet.");
    const account = privateKeyToAccount(key);
    const client = new x402Client().setSpendControls({ maxAmountPerPayment: "$1" }).register("eip155:8453", new ExactEvmScheme(account));
    payer = wrapFetchWithPayment(fetch, client);
  }
  return payer;
}

function walletKey(): `0x${string}` | undefined {
  const raw = process.env.X402_PRIVATE_KEY?.trim() ?? "";
  if (!raw) return undefined;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("X402_PRIVATE_KEY must be a 32-byte hex private key.");
  return key as `0x${string}`;
}

function paymentReceipt(header: string | null) {
  if (!header) return "";
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { transaction?: unknown };
    const transaction = decoded.transaction;
    if (typeof transaction === "string" && /^0x[0-9a-fA-F]{64}$/.test(transaction)) return `\npaid ${transaction}`;
  } catch {
    return "";
  }
  return "";
}

function redact(text: string) {
  const key = process.env.X402_PRIVATE_KEY?.trim() ?? "";
  if (!key) return text;
  const bare = key.startsWith("0x") ? key.slice(2) : key;
  return text.split(key).join("[redacted]").split(bare).join("[redacted]");
}

function fail(text: string) {
  return { isError: true, output: [{ type: "text" as const, text }] };
}
