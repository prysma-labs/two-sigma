import { proxyAgent, pass } from "@/lib/upstream";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8_000;

type RouteParams = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteParams) {
  const { agentId } = await context.params;
  const raw = await request.text();
  let text = "";
  try {
    const body = JSON.parse(raw) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!text || text.length > MAX_TEXT) {
    return Response.json({ error: "Write a message under 8000 characters." }, { status: 400 });
  }
  return pass(
    await proxyAgent(agentId, "/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
  );
}
