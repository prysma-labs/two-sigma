import { agentBaseUrl, type AgentId } from "./agents";

export function agentUrl(agentId: AgentId, path: string, env: NodeJS.ProcessEnv = process.env) {
  return `${agentBaseUrl(agentId, env)}${path}`;
}

export function agentHeaders(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.AGENT_SHARED_SECRET?.trim();
  if (!secret) throw new Error("Missing AGENT_SHARED_SECRET");
  const headers = new Headers();
  headers.set("authorization", `Bearer ${secret}`);
  return headers;
}
