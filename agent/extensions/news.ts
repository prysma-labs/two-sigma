import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { privateKeyToAccount } from "viem/accounts";

const origin = "https://api.exa.ai";
const searchTypes = ["auto", "lite", "deep-lite", "deep"] as const;
const categories = ["news", "publication", "company", "financial report", "personal site", "people"] as const;
const periods = ["today", "24h", "7d"] as const;
const skill = stripFrontmatter(
  readFileSync(join(import.meta.dirname, "../skills/news-researcher/SKILL.md"), "utf8"),
);
const instructions = [
  "Research financially material news about markets, companies, macroeconomics, central banks, regulation, commodities, and digital assets.",
  "Use current_time for the current local date and time. Use the exa period parameter for today, the last 24 hours, or the last 7 days.",
  "Use exa_search for current web search and exa_contents to read pages.",
  "Each call pays USDC on Base over x402. Search is limited to 10 results and payments above $0.10 are refused.",
  "Use search to discover sources, then contents to read the most relevant URLs. Rank stories by financial impact, breadth, source quality, and corroboration. Cite source URLs and distinguish publication dates from event dates.",
  "If Exa fails or current reporting is unavailable, say what is missing. Never invent sources, headlines, quotations, dates, events, or figures.",
].join(" ");

type Args = {
  query?: string;
  type?: string;
  category?: string;
  period?: string;
  numResults?: number;
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  urls?: string[];
  text?: boolean;
  highlights?: boolean;
  summary?: boolean;
  maxCharacters?: number;
};

export default create();

function create() {
  if (process.env.AGENT_ID?.trim() !== "news") return defineExtension({ name: "news" });
  let keyNote = "X402_PRIVATE_KEY is not set. Calls will fail until a funded Base wallet key is set.";
  try {
    if (walletKey()) keyNote = "X402_PRIVATE_KEY is set.";
  } catch (error) {
    keyNote = error instanceof Error ? error.message : String(error);
  }
  return defineExtension({
    name: "news",
    sections: [section("news", () => [instructions, keyNote, skill].join("\n\n"), { tag: false })],
    tools: [
      defineTool({
        name: "exa_search",
        description: "Search current financial news with Exa. This is a paid x402 request.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query." }),
          type: Type.Optional(Type.Union(searchTypes.map((type) => Type.Literal(type)))),
          category: Type.Optional(Type.Union(categories.map((category) => Type.Literal(category)))),
          period: Type.Optional(Type.Union(periods.map((period) => Type.Literal(period)))),
          numResults: Type.Optional(Type.Number({ description: "Search results, from 1 to 10. Default 5." })),
          startPublishedDate: Type.Optional(Type.String({ description: "ISO 8601 lower publication-date bound." })),
          endPublishedDate: Type.Optional(Type.String({ description: "ISO 8601 upper publication-date bound." })),
          includeDomains: Type.Optional(Type.Array(Type.String(), { description: "Domains or domain paths to include." })),
          excludeDomains: Type.Optional(Type.Array(Type.String(), { description: "Domains or domain paths to exclude." })),
        }),
        execute: async (args) => {
          try {
            return await call("search", args);
          } catch (error) {
            return fail(redact(error instanceof Error ? error.message : String(error)));
          }
        },
      }),
      defineTool({
        name: "exa_contents",
        description: "Retrieve source pages with Exa. This is a paid x402 request.",
        parameters: Type.Object({
          urls: Type.Array(Type.String(), { description: "One to ten URLs." }),
          text: Type.Optional(Type.Boolean({ description: "Return page text for contents. Defaults true." })),
          highlights: Type.Optional(Type.Boolean({ description: "Return relevant highlights for contents." })),
          summary: Type.Optional(Type.Boolean({ description: "Return an Exa-generated summary for contents." })),
          maxCharacters: Type.Optional(Type.Number({ description: "Maximum text characters per page, from 1 to 30000." })),
        }),
        execute: async (args) => {
          try {
            return await call("contents", args);
          } catch (error) {
            return fail(redact(error instanceof Error ? error.message : String(error)));
          }
        },
      }),
      defineTool({
        name: "current_time",
        description: "Return the current local date, time, timezone, and UTC timestamp without making a paid request.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async () => ({
          output: [{ type: "text" as const, text: JSON.stringify(currentTime()) }],
        }),
      }),
    ],
  });
}

async function call(action: "search" | "contents", args: Args) {
  const body = action === "search" ? searchBody(args) : contentsBody(args);
  if ("isError" in body) return body;
  const response = await paidFetch()(`${origin}/${action}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(action === "search" && args.type?.startsWith("deep") ? 90_000 : 45_000),
  });
  const raw = await response.text();
  const text = raw.length > 120_000 ? `${raw.slice(0, 120_000)}\n\n[truncated; narrow the request]` : raw;
  const receipt = response.ok ? paymentReceipt(response.headers.get("payment-response")) : "";
  return {
    isError: !response.ok,
    output: [{ type: "text" as const, text: `HTTP ${response.status} /${action}${receipt}\n${text}` }],
  };
}

function searchBody(args: Args) {
  const query = args.query?.trim() ?? "";
  if (!query || query.length > 2_000) return fail("query must be 1-2000 characters");
  const numResults = args.numResults ?? 5;
  if (!Number.isInteger(numResults) || numResults < 1 || numResults > 10) {
    return fail("numResults must be an integer from 1 to 10");
  }
  const type = args.type ?? "auto";
  if (!searchTypes.includes(type as (typeof searchTypes)[number])) {
    return fail(`type must be one of ${searchTypes.join(", ")}`);
  }
  const category = args.category ?? "news";
  if (!categories.includes(category as (typeof categories)[number])) {
    return fail(`category must be one of ${categories.join(", ")}`);
  }
  const includeDomains = domains(args.includeDomains, "includeDomains");
  if (!Array.isArray(includeDomains)) return includeDomains;
  const excludeDomains = domains(args.excludeDomains, "excludeDomains");
  if (!Array.isArray(excludeDomains)) return excludeDomains;
  const period = args.period?.trim() ?? "";
  if (period && !periods.includes(period as (typeof periods)[number])) {
    return fail(`period must be one of ${periods.join(", ")}`);
  }
  if (period && (args.startPublishedDate || args.endPublishedDate)) {
    return fail("period cannot be combined with explicit publication dates");
  }
  const range = relativeRange(period);
  const startPublishedDate = isoDate(
    range?.start ?? args.startPublishedDate,
    "startPublishedDate",
  );
  if (typeof startPublishedDate !== "string") return startPublishedDate;
  const endPublishedDate = isoDate(range?.end ?? args.endPublishedDate, "endPublishedDate");
  if (typeof endPublishedDate !== "string") return endPublishedDate;
  if (startPublishedDate && endPublishedDate && startPublishedDate > endPublishedDate) {
    return fail("startPublishedDate must be on or before endPublishedDate");
  }
  return compact({
    query,
    type,
    category,
    numResults,
    startPublishedDate,
    endPublishedDate,
    includeDomains: includeDomains.length ? includeDomains : undefined,
    excludeDomains: excludeDomains.length ? excludeDomains : undefined,
  });
}

function contentsBody(args: Args) {
  const urls = args.urls ?? [];
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 10) return fail("urls must contain 1-10 URLs");
  const checked: string[] = [];
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return fail("urls must use http or https");
      checked.push(url.toString());
    } catch {
      return fail(`invalid URL: ${String(value).slice(0, 200)}`);
    }
  }
  const maxCharacters = args.maxCharacters ?? 12_000;
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 30_000) {
    return fail("maxCharacters must be an integer from 1 to 30000");
  }
  return compact({
    urls: checked,
    text: args.text === false ? false : { maxCharacters },
    highlights: args.highlights ? true : undefined,
    summary: args.summary ? true : undefined,
  });
}

function domains(values: string[] | undefined, name: string) {
  if (!values) return [];
  if (!Array.isArray(values) || values.length > 20) return fail(`${name} must contain at most 20 domains`);
  const checked = values.map((value) => value.trim()).filter(Boolean);
  if (checked.some((value) => !/^(?:\*\.)?[A-Za-z0-9.-]+(?:\/[^\s]*)?$/.test(value))) {
    return fail(`${name} contains an invalid domain or path`);
  }
  return checked;
}

function relativeRange(period: string) {
  if (!period) return undefined;
  const now = new Date();
  const start =
    period === "today"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getTime() - (period === "24h" ? 24 : 24 * 7) * 60 * 60 * 1_000);
  return { start: start.toISOString(), end: now.toISOString() };
}

function currentTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    localDate: `${value("year")}-${value("month")}-${value("day")}`,
    localTime: now.toString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utc: now.toISOString(),
  };
}

function isoDate(value: string | undefined, name: string) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return fail(`${name} must be an ISO 8601 date-time`);
  return new Date(parsed).toISOString();
}

let payer: ReturnType<typeof wrapFetchWithPayment> | undefined;

function paidFetch() {
  if (!payer) {
    const key = walletKey();
    if (!key) throw new Error("X402_PRIVATE_KEY is not set. Exa calls pay USDC on Base, and this process has no wallet.");
    const account = privateKeyToAccount(key);
    const client = new x402Client()
      .setSpendControls({ maxAmountPerPayment: "$0.10" })
      .register("eip155:8453", new ExactEvmScheme(account));
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

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
  );
}

function redact(text: string) {
  const key = process.env.X402_PRIVATE_KEY?.trim() ?? "";
  if (!key) return text;
  const bare = key.startsWith("0x") ? key.slice(2) : key;
  return text.split(key).join("[redacted]").split(bare).join("[redacted]");
}

function stripFrontmatter(text: string) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end < 0 ? text : text.slice(end + 5);
}

function fail(text: string) {
  return { isError: true, output: [{ type: "text" as const, text }] };
}
