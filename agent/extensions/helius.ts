import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import type { TSchema } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";

const skillsRoot = join(import.meta.dirname, "../skills/helius-skills");
const preferred = ["helius", "svm", "helius-jupiter", "helius-dflow", "helius-okx", "helius-phantom"];
const telemetry = new Set(["_feedback", "_feedbackTool", "_model"]);
const require = createRequire(import.meta.url);

type Session = { close: () => Promise<void> };
type Holder = { current?: Session };
const holder: Holder = ((globalThis as typeof globalThis & { __solanaAuditorHelius?: Holder }).__solanaAuditorHelius ??=
  {});

export default await create();

async function create() {
  if (process.env.AGENT_ID?.trim() !== "onchain") return defineExtension({ name: "helius" });

  const skills = skillText(skillsRoot);
  const connected = await connect();
  const tools = [...(skills ? [readSkillFile()] : []), ...(connected.ok ? connected.tools : [])];
  const instructions = [
    "Follow the Helius skills below. Live Solana figures come from the Helius MCP tools. When a skill points at a reference, read it with read_skill_file before you rely on it. If a tool fails or the figure is not there, name what is missing and stop. Do not invent wallets, flows, balances, or transactions.",
    process.env.HELIUS_API_KEY?.trim()
      ? "HELIUS_API_KEY is set."
      : "HELIUS_API_KEY is not set. Chain calls will fail until it is set on this process. Say that the key is missing.",
    connected.ok
      ? `The Helius MCP tools are ${connected.names.join(", ")}. The server is read-only: it can read Solana, and it cannot send funds, change webhooks, or create accounts.`
      : `The Helius MCP server is not connected: ${connected.error}`,
    skills,
  ]
    .filter(Boolean)
    .join("\n\n");

  return defineExtension({
    name: "helius",
    sections: [section("helius", () => instructions, { tag: false })],
    tools,
  });
}

async function connect(): Promise<
  { ok: true; tools: ReturnType<typeof defineTool>[]; names: string[] } | { ok: false; error: string }
> {
  await holder.current?.close().catch((error) => console.error("helius mcp:", error));
  holder.current = undefined;
  const command = process.execPath;
  const script = require.resolve("helius-mcp");
  const transport = new StdioClientTransport({
    command,
    args: [script, "--read-only"],
    env: mcpEnv(),
    stderr: "inherit",
  });
  const client = new Client({ name: "solana-auditor", version: "1.0.0" });
  const close = async () => {
    await client.close().catch(() => undefined);
  };
  holder.current = { close };
  try {
    await withTimeout(client.connect(transport), 20_000, "Helius MCP timed out");
    const listed = await withTimeout(client.listTools(), 20_000, "Helius MCP tool list timed out");
    const tools = listed.tools.map((tool) =>
      defineTool({
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: schemaOf(tool.inputSchema),
        replay: "safe",
        execute: async (args) => {
          try {
            const result = await client.callTool({
              name: tool.name,
              arguments: withTelemetry(args as Record<string, unknown>, tool.name),
            });
            if (!result || typeof result !== "object" || !("content" in result)) {
              return {
                isError: true,
                output: [{ type: "text", text: "Helius MCP returned no content." }],
              };
            }
            return {
              isError: result.isError === true,
              output: contentOf(result.content),
            };
          } catch (error) {
            return {
              isError: true,
              output: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
            };
          }
        },
      }),
    );
    return { ok: true, tools, names: tools.map((tool) => tool.name) };
  } catch (error) {
    console.error("helius mcp:", error);
    await close();
    holder.current = undefined;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function mcpEnv() {
  const env = getDefaultEnvironment();
  for (const key of ["HELIUS_API_KEY", "HELIUS_NETWORK"]) {
    const value = process.env[key]?.trim();
    if (value) env[key] = value;
  }
  env.HELIUS_MCP_READ_ONLY = "1";
  return env;
}

function schemaOf(schema: unknown): TSchema {
  if (!schema || typeof schema !== "object") return Type.Object({}, { additionalProperties: Type.Unknown() });
  const copy = structuredClone(schema) as { required?: unknown };
  if (Array.isArray(copy.required)) copy.required = copy.required.filter((key) => !telemetry.has(String(key)));
  return copy as TSchema;
}

function withTelemetry(args: Record<string, unknown>, toolName: string) {
  return {
    _feedback: "solana auditor",
    _feedbackTool: toolName,
    _model: process.env.OPENROUTER_MODEL?.trim() || "solana-auditor",
    ...args,
  };
}

function contentOf(content: readonly { type: string; text?: string; data?: string; mimeType?: string; resource?: unknown }[]) {
  const output: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) output.push({ type: "text", text: part.text });
    else if (part.type === "image" && part.data && part.mimeType) {
      output.push({ type: "image", data: part.data, mimeType: part.mimeType });
    } else output.push({ type: "text", text: JSON.stringify(part) });
  }
  if (output.length === 0) output.push({ type: "text", text: "Helius MCP returned no content." });
  return output;
}

function readSkillFile() {
  return defineTool({
    name: "read_skill_file",
    description: "Read a Helius skill reference. The path is relative to the skills directory, such as helius/references/sender.md.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative markdown path inside the Helius skills directory" }),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        return { output: [{ type: "text", text: readSkill(skillsRoot, args.path) }] };
      } catch (error) {
        return {
          isError: true,
          output: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  });
}

function skillText(root: string) {
  if (!existsSync(root)) return "";
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return names
    .map((name) => {
      const body = stripFrontmatter(readFileSync(join(root, name, "SKILL.md"), "utf8")).trim();
      return `=== BEGIN SKILL: ${name} ===\n${body}\n=== END SKILL: ${name} ===`;
    })
    .join("\n\n");
}

function rank(name: string) {
  const index = preferred.indexOf(name);
  return index < 0 ? preferred.length : index;
}

function stripFrontmatter(text: string) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end < 0 ? text : text.slice(end + 5);
}

function readSkill(root: string, request: string) {
  if (!request || request.includes("\0")) throw new Error("Missing path");
  const rootReal = realpathSync(root);
  const full = resolve(rootReal, request);
  const rel = relative(rootReal, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path is outside the Helius skills");
  if (!full.endsWith(".md")) throw new Error("Only markdown references can be read");
  const real = realpathSync(full);
  const realRel = relative(rootReal, real);
  if (!realRel || realRel.startsWith("..") || isAbsolute(realRel)) throw new Error("Path is outside the Helius skills");
  const stat = statSync(real);
  if (!stat.isFile() || stat.size > 200_000) throw new Error("Reference is missing or too large");
  return readFileSync(real, "utf8");
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
