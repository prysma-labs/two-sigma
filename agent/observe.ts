import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Payload = Record<string, string | number | boolean>;

export type StoredTool = {
  id?: string;
  name: string;
  status: string;
  at: string;
};

let supabase: SupabaseClient | undefined;

function client() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return undefined;
  supabase ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

export async function record(kind: string, payload: Payload = {}) {
  const db = client();
  const agentId = process.env.AGENT_ID?.trim();
  if (!db || !agentId) return;
  const { error } = await db.from("events").insert({
    agent_id: agentId,
    kind,
    payload,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function listToolEvents(): Promise<StoredTool[]> {
  const db = client();
  const agentId = process.env.AGENT_ID?.trim();
  if (!db || !agentId) return [];
  const { data, error } = await db
    .from("events")
    .select("payload, at")
    .eq("agent_id", agentId)
    .eq("kind", "tool")
    .order("at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse().flatMap((row) => {
    const payload = row.payload as { id?: unknown; name?: unknown; status?: unknown } | null;
    if (!payload || typeof payload.name !== "string") return [];
    return [
      {
        id: typeof payload.id === "string" ? payload.id : undefined,
        name: payload.name,
        status: typeof payload.status === "string" ? payload.status : "done",
        at: String(row.at),
      },
    ];
  });
}
