import { isAgentId } from "./agents";
import { agentHeaders, agentUrl } from "./proxy";

export async function proxyAgent(agentId: string, path: string, init?: RequestInit) {
  if (!isAgentId(agentId)) return Response.json({ error: "Unknown agent" }, { status: 404 });
  try {
    const headers = agentHeaders();
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    return await fetch(agentUrl(agentId, path), { ...init, headers, cache: "no-store" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the agent.";
    const status = message.startsWith("Missing") ? 500 : 502;
    return Response.json({ error: message }, { status });
  }
}

export function pass(upstream: Response) {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
