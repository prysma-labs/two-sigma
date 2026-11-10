import { proxyAgent } from "@/lib/upstream";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteParams) {
  const { agentId } = await context.params;
  const upstream = await proxyAgent(agentId, "/api/events");
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json({ error: detail || upstream.statusText }, { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
