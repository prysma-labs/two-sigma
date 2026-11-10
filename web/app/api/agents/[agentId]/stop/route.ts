import { proxyAgent, pass } from "@/lib/upstream";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ agentId: string }> };

export async function POST(_request: Request, context: RouteParams) {
  const { agentId } = await context.params;
  return pass(await proxyAgent(agentId, "/api/stop", { method: "POST" }));
}
