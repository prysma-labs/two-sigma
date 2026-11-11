"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { ObserveTools, type ObservedTool } from "@/components/observe-tools";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { AGENTS, type AgentId, agentById } from "@/lib/agents";
import { RefreshCwIcon } from "lucide-react";

type AgentItem =
  | { type: "user"; text: string; author?: string; queued?: boolean }
  | { type: "assistant"; text: string; live?: boolean }
  | {
      type: "tool";
      id?: string;
      name: string;
      args?: unknown;
      status: string;
      output: string;
    }
  | { type: "note"; text: string };

type AgentState = {
  busy: boolean;
  model: string;
  items: AgentItem[];
  toolLog?: ObservedTool[];
};

function AgentSidebar({
  agentId,
  onSelect,
}: {
  agentId: AgentId;
  onSelect: (id: AgentId) => void;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <p className="font-wordmark text-foreground text-3xl leading-none">twosigma</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {AGENTS.map((item, index) => {
              const available = index === 0;
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={item.id === agentId}
                    disabled={!available}
                    className="h-auto items-start overflow-visible py-2 [&>span:last-child]:overflow-visible [&>span:last-child]:text-clip [&>span:last-child]:whitespace-normal"
                    aria-current={item.id === agentId ? "page" : undefined}
                    onClick={() => {
                      if (!available) return;
                      onSelect(item.id);
                      setOpenMobile(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-muted-foreground text-xs font-normal whitespace-normal">
                        {available ? item.blurb : "coming soon..."}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export function ResearchApp() {
  const [agentId, setAgentId] = useState<AgentId>("onchain");
  const agent = agentById(agentId)!;

  return (
    <SidebarProvider className="h-full min-h-0">
      <AgentSidebar agentId={agentId} onSelect={setAgentId} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <Conversation key={agentId} agentId={agent.id} name={agent.name} />
      </SidebarInset>
    </SidebarProvider>
  );
}

function Conversation({ agentId, name }: { agentId: AgentId; name: string }) {
  const [state, setState] = useState<AgentState | null>(null);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"ask" | "observe">("ask");
  const [stored, setStored] = useState<ObservedTool[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const messages = useMemo(() => toMessages(state), [state]);
  const tools = useMemo(() => mergeTools(stored, state?.toolLog ?? []), [stored, state?.toolLog]);

  const loadStored = useCallback(async () => {
    const response = await fetch(`/api/agents/${agentId}/observe`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { tools?: ObservedTool[] };
    setStored(data.tools ?? []);
  }, [agentId]);

  useEffect(() => {
    void loadStored();
  }, [loadStored]);

  useEffect(() => {
    const finished = (state?.toolLog ?? []).some(
      (tool) => tool.status === "done" || tool.status === "error",
    );
    if (!finished) return;
    const timer = window.setTimeout(() => void loadStored(), 400);
    return () => window.clearTimeout(timer);
  }, [state?.toolLog, loadStored]);

  useEffect(() => {
    const events = new EventSource(`/api/agents/${agentId}/events`);
    events.onopen = () => setConnected(true);
    events.onmessage = (event) => {
      setConnected(true);
      setState(JSON.parse(event.data) as AgentState);
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, [agentId]);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = textOf(message);
      setSendError(null);
      const response = await fetch(`/api/agents/${agentId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, requestId: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setSendError(body.error ?? "Could not send the message.");
      }
    },
    [agentId],
  );

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: state?.busy ?? false,
    convertMessage: (message) => message,
    onNew,
    onCancel: async () => {
      await fetch(`/api/agents/${agentId}/stop`, { method: "POST" });
    },
  });

  async function refresh() {
    setRefreshing(true);
    setSendError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/reset`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not reset the conversation.");
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not reset the conversation.");
    } finally {
      setRefreshing(false);
    }
  }

  const components = useMemo(
    () => ({
      Welcome: function Welcome() {
        return (
          <div className="mb-6 flex flex-col px-2">
            <p className="text-2xl font-medium tracking-tight">{name}</p>
            <p className="text-muted-foreground mt-2 max-w-md text-sm">
              Ask a question. This agent will say when it needs data it does not have.
            </p>
          </div>
        );
      },
    }),
    [name],
  );

  const status = !connected ? "Reconnecting" : state?.busy ? "Working" : "Idle";

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b-2 px-4">
        <SidebarTrigger />
        <h1 className="text-sm font-medium">{name}</h1>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value === "ask" || value === "observe") setTab(value);
          }}
          className="w-auto"
        >
          <TabsList aria-label="Views">
            <TabsTrigger value="ask">Ask</TabsTrigger>
            <TabsTrigger value="observe">Observe</TabsTrigger>
          </TabsList>
        </Tabs>
        <Badge variant={state?.busy ? "default" : "secondary"} className="ml-auto">
          {status}
        </Badge>
        <TooltipIconButton tooltip="Reset" disabled={!connected || refreshing} onClick={() => void refresh()}>
          <RefreshCwIcon />
        </TooltipIconButton>
      </header>
      {sendError ? (
        <p role="alert" className="text-destructive px-4 py-2 text-sm">
          {sendError}
        </p>
      ) : null}
      <div className={tab === "ask" ? "font-chat flex min-h-0 flex-1 flex-col" : "hidden"}>
        <AssistantRuntimeProvider runtime={runtime}>
          <Thread components={components} />
        </AssistantRuntimeProvider>
      </div>
      <div className={tab === "observe" ? "min-h-0 flex-1" : "hidden"}>
        <ObserveTools tools={tools} />
      </div>
    </section>
  );
}

function mergeTools(stored: ObservedTool[], live: ObservedTool[]) {
  const byId = new Map<string, ObservedTool>();
  for (const tool of stored) if (tool.id) byId.set(tool.id, tool);
  for (const tool of live) {
    if (!tool.id) continue;
    const previous = byId.get(tool.id);
    byId.set(tool.id, previous ? { ...previous, ...tool } : tool);
  }
  const seen = new Set<string>();
  const ordered: ObservedTool[] = [];
  for (const tool of [...stored, ...live]) {
    if (!tool.id || seen.has(tool.id)) continue;
    seen.add(tool.id);
    ordered.push(byId.get(tool.id) ?? tool);
  }
  return ordered;
}

function textOf(message: AppendMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function toMessages(state: AgentState | null): ThreadMessageLike[] {
  if (!state) return [];
  const messages: ThreadMessageLike[] = [];
  let draft: { parts: ThreadMessageLike["content"]; live: boolean } | null = null;
  const flush = () => {
    if (!draft || !Array.isArray(draft.parts) || draft.parts.length === 0) {
      draft = null;
      return;
    }
    messages.push({
      role: "assistant",
      id: `assistant-${messages.length}`,
      content: draft.parts,
      status: draft.live ? { type: "running" } : { type: "complete", reason: "stop" },
    });
    draft = null;
  };

  state.items.forEach((item, index) => {
    if (item.type === "user") {
      flush();
      messages.push({
        role: "user",
        id: `user-${index}`,
        content: [{ type: "text", text: item.text }],
      });
      return;
    }
    draft ??= { parts: [], live: false };
    if (!Array.isArray(draft.parts)) return;
    if (item.type === "assistant") {
      draft.live = Boolean(item.live);
      draft.parts.push({ type: "text", text: item.text });
    } else if (item.type === "tool") {
      const running = item.status === "pending" || item.status === "running";
      draft.live = running;
      const args =
        item.args && typeof item.args === "object"
          ? (item.args as Record<string, unknown>)
          : { value: item.args ?? null };
      draft.parts.push({
        type: "tool-call",
        toolCallId: item.id ?? `tool-${index}`,
        toolName: item.name,
        args,
        ...(running
          ? { isPreliminary: true, ...(item.output ? { result: item.output } : {}) }
          : { result: item.output, isError: item.status === "error" }),
      });
    } else {
      draft.parts.push({ type: "text", text: item.text });
    }
  });
  flush();

  if (state.busy && messages.at(-1)?.role !== "assistant") {
    messages.push({
      role: "assistant",
      id: "pending",
      content: [{ type: "text", text: "" }],
      status: { type: "running" },
    });
  }
  return messages;
}
