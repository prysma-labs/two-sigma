import { existsSync, readFileSync, watch } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { listToolEvents, record } from "./observe.ts";
import { promptFor } from "./prompts.ts";

const dir = import.meta.dirname;
loadEnv(join(dir, "agent.env"));

const agentId = process.env.AGENT_ID?.trim() ?? "";
const prompt = promptFor(agentId);
const secret = process.env.AGENT_SHARED_SECRET?.trim();
if (!secret) throw new Error("Set AGENT_SHARED_SECRET");

const workspace = join(dir, "workspace");
const extensionsDir = join(dir, "extensions");
const model = {
  provider: "openrouter",
  modelId: process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4.1-flash-1017",
};
const context = BACKGROUND_CONTEXT;
let ready = false;

await mkdir(join(dir, "data"), { recursive: true });
await mkdir(workspace, { recursive: true });
await mkdir(extensionsDir, { recursive: true });

const server = createServer((req, res) =>
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: String(error?.message ?? error) });
  }),
);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(process.env.PORT ?? 8000), process.env.HOST ?? "127.0.0.1", () =>
    resolve(undefined),
  );
});

const models = createModels();
models.setProvider(openRouter());

const registry = createRegistry();
registry.install(
  defineExtension({
    name: "agent",
    sections: [
      section(
        "preamble",
        () =>
          [
            prompt,
            "Your conversation is durable: if this process restarts, continue the same work.",
            "Models are served through OpenRouter.",
          ].join("\n\n"),
        { tag: false },
      ),
    ],
  }),
);

const loaded = new Map();
async function load(file: string) {
  const path = join(extensionsDir, file);
  try {
    if (!existsSync(path)) {
      if (loaded.has(file)) registry.uninstall(loaded.get(file));
      loaded.delete(file);
      return;
    }
    const { default: extension } = await import(`${pathToFileURL(path)}?v=${Date.now()}`);
    registry.install(extension);
    loaded.set(file, extension);
  } catch (error) {
    console.error(`extensions/${file}:`, error);
  }
}
for (const file of await readdir(extensionsDir)) {
  if (file.endsWith(".ts")) await load(file);
}
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const extensionsWatch = watch(extensionsDir, (_, file) => {
  if (!file?.endsWith(".ts")) return;
  clearTimeout(pending.get(file));
  pending.set(
    file,
    setTimeout(() => load(file), 300),
  );
});
extensionsWatch.on("error", (error) => console.error("extensions watch:", error));

const harness = await Harness.open(
  await openNodeSqliteStorage(join(dir, "data", "agent.sqlite")),
  {
    models,
    registry,
    env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workspace }),
    onReport: (error) => {
      console.error("pi-durable:", error);
      void record("error", { message: String(error?.message ?? error).slice(0, 300) }).catch(
        (logError) => console.error("observe:", logError),
      );
    },
  },
  context,
);
const root = await harness.root(context, { agent: { model, cwd: workspace } });
const view = await root.viewState(context);
const stored = view.value.docs["pi.agent"]?.model;
const current =
  stored && typeof stored === "object" && !Array.isArray(stored) ? stored : undefined;
if (current?.provider !== model.provider || current?.modelId !== model.modelId) {
  await root.configure({ model }, context);
}
harness.resume();
ready = true;
const address = server.address();
const port = address && typeof address === "object" ? address.port : address;
console.log(`pi-durable listening on ${port}, agent ${agentId}, model ${model.provider}/${model.modelId}`);
void record("startup", { model: `${model.provider}/${model.modelId}` }).catch((error) =>
  console.error("observe:", error),
);

type ToolItem = {
  type: "tool";
  id?: string;
  name: string;
  args?: unknown;
  status: string;
  output: string;
};

const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : ((content ?? []) as { type?: string; text?: string }[])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

function summarize(value: {
  entries: { kind?: string; data?: unknown; model?: { content?: unknown; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string; isError?: boolean }[] }[];
  docs: Record<string, any>;
}) {
  const items: Record<string, unknown>[] = [];
  const tools = new Map<string, ToolItem>();
  const assistant = (message: { content?: unknown; stopReason?: string; errorMessage?: string }, live: boolean) => {
    for (const part of (message.content ?? []) as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown }[]) {
      if (part.type === "text" && part.text) items.push({ type: "assistant", text: part.text, live });
      if (part.type === "toolCall") {
        const tool: ToolItem = {
          type: "tool",
          id: part.id,
          name: part.name ?? "tool",
          args: part.arguments,
          status: "pending",
          output: "",
        };
        if (part.id) tools.set(part.id, tool);
        items.push(tool);
      }
    }
    if (message.stopReason === "error" && message.errorMessage) {
      items.push({ type: "note", text: `Model error: ${message.errorMessage}` });
    }
  };
  const resetAt = value.entries.findLastIndex((entry) => entry.kind === "pi.reset");
  const visible = resetAt < 0 ? value.entries : value.entries.slice(resetAt + 1);
  for (const entry of visible) {
    const message = entry.model?.[0];
    if (entry.kind === "chat.input") items.push({ type: "user", ...(entry.data as object) });
    else if (entry.kind === "pi.user") items.push({ type: "user", author: "", text: textOf(message?.content) });
    else if (entry.kind === "pi.assistant" && message) assistant(message, false);
    else if (entry.kind === "pi.tool-result" && message) {
      const tool = message.toolCallId ? tools.get(message.toolCallId) : undefined;
      if (tool) {
        tool.status = message.isError ? "error" : "done";
        tool.output = textOf(message.content);
      }
    } else if (entry.kind === "pi.compaction") {
      items.push({ type: "note", text: "Older messages were summarized." });
    }
  }
  const live = value.docs["pi.live"] ?? {};
  if (live.generation?.message) assistant(live.generation.message, true);
  for (const running of live.tools ?? []) {
    const tool = tools.get(running.callId);
    if (tool && running.status !== "done") {
      tool.status = running.status;
      tool.output = running.output ?? "";
    }
  }
  for (const tool of tools.values()) tool.output = String(tool.output).slice(-4000);
  for (const queued of value.docs["pi.inbox"]?.items ?? []) {
    if (queued.entry?.kind === "chat.input") items.push({ type: "user", ...queued.entry.data, queued: true });
  }
  const agent = value.docs["pi.agent"]?.model;
  return {
    busy: live.run !== undefined,
    model: agent ? `${agent.provider}/${agent.modelId}` : "",
    items: items.slice(-300),
    toolLog: toolLogOf(value),
  };
}

function toolLogOf(value: {
  entries?: { kind?: string; model?: { content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean }[] }[];
  docs: Record<string, any>;
}) {
  const tools = new Map<string, { id: string; name: string; status: string }>();
  const order: { id: string; name: string; status: string }[] = [];
  const add = (id: string | undefined, name: string | undefined, status: string) => {
    if (!id || !name || tools.has(id)) return;
    const tool = { id, name, status };
    tools.set(id, tool);
    order.push(tool);
  };
  for (const entry of value.entries ?? []) {
    const message = entry.model?.[0];
    if (!message) continue;
    if (entry.kind === "pi.assistant") {
      for (const part of (message.content ?? []) as { type?: string; id?: string; name?: string }[]) {
        if (part.type === "toolCall") add(part.id, part.name, "pending");
      }
    } else if (entry.kind === "pi.tool-result") {
      const existing = message.toolCallId ? tools.get(message.toolCallId) : undefined;
      const status = message.isError ? "error" : "done";
      if (existing) existing.status = status;
      else add(message.toolCallId, message.toolName, status);
    }
  }
  const live = value.docs["pi.live"] ?? {};
  for (const part of (live.generation?.message?.content ?? []) as { type?: string; id?: string; name?: string }[]) {
    if (part.type === "toolCall") add(part.id, part.name, "pending");
  }
  for (const running of live.tools ?? []) {
    const existing = tools.get(running.callId);
    if (existing) {
      if (existing.status === "pending") existing.status = running.status ?? "running";
    } else add(running.callId, running.name, running.status ?? "running");
  }
  return order.slice(-500);
}

const recorded = new Set<string>();
function rememberTools(toolLog: { id: string; name: string; status: string }[]) {
  for (const tool of toolLog) {
    if (tool.status !== "done" && tool.status !== "error") continue;
    if (recorded.has(tool.id)) continue;
    recorded.add(tool.id);
    void record("tool", { id: tool.id, name: tool.name, status: tool.status }).catch((error) => {
      recorded.delete(tool.id);
      console.error("observe:", error);
    });
  }
}

const pages = new Set<ServerResponse>();
let latest = JSON.stringify(summarize(view.value));
rememberTools(JSON.parse(latest).toolLog);
let timer: ReturnType<typeof setTimeout> | undefined;
view.subscribe(() => {
  timer ??= setTimeout(() => {
    timer = undefined;
    const summary = summarize(view.value);
    rememberTools(summary.toolLog);
    const next = JSON.stringify(summary);
    if (next === latest) return;
    latest = next;
    for (const page of pages) page.write(`data: ${latest}\n\n`);
  }, 100);
});
setInterval(() => {
  for (const page of pages) page.write(": ping\n\n");
}, 25_000).unref();

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function caller(req: IncomingMessage) {
  const header = req.headers.authorization;
  return header === `Bearer ${secret}` ? "web" : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }
  const who = caller(req);
  if (!who) return send(res, 401, { error: "unauthorized" });
  if (!ready) return send(res, 503, { error: "starting" });
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, JSON.parse(latest));
  if (req.method === "GET" && url.pathname === "/api/observe") {
    return send(res, 200, { tools: await listToolEvents() });
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.write(`data: ${latest}\n\n`);
    pages.add(res);
    req.on("close", () => pages.delete(res));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/stop") {
    await root.abort(context);
    return send(res, 200, { stopped: true });
  }
  if (req.method === "POST" && url.pathname === "/api/reset") {
    await root.abort(context);
    await root.reset(undefined, context);
    return send(res, 200, { reset: true });
  }
  if (req.method === "POST" && url.pathname === "/api/messages") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { text, requestId, wait } = JSON.parse(body || "{}");
    if (typeof text !== "string" || !text.trim()) return send(res, 400, { error: "text is required" });
    const submission = await root.submit(
      {
        type: "input",
        content: text,
        requestId: typeof requestId === "string" ? requestId : undefined,
        whenBusy: "steer",
        entry: {
          kind: "chat.input",
          data: { author: who, text: text.trim() },
        },
      },
      context,
    );
    if (!wait) return send(res, 202, { id: submission.id });
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input") {
      return send(res, 200, { id: submission.id, ...settled });
    }
    const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
    return send(res, 200, {
      id: submission.id,
      status: "done",
      answer: textOf(answer?.model?.[0]?.content),
    });
  }
  send(res, 404, { error: "not found" });
}

process.once("SIGTERM", async () => {
  for (const page of pages) page.end();
  server.close();
  await harness.close(context);
  process.exit(0);
});

function openRouter() {
  const base = openrouterProvider();
  const baseUrl = process.env.OPENROUTER_BASE_URL;
  if (!baseUrl) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("Set OPENROUTER_API_KEY, or OPENROUTER_BASE_URL for an exe.dev LLM integration");
    }
    return base;
  }
  return {
    ...base,
    baseUrl,
    auth: {
      apiKey: {
        name: "OpenRouter",
        resolve: async () => ({
          auth: {
            apiKey: process.env.OPENROUTER_API_KEY || "exe-llm-integration",
            baseUrl,
          },
        }),
      },
    },
  };
}

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
