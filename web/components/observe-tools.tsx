const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "oklch(0.55 0.18 250)",
  "oklch(0.6 0.16 320)",
  "oklch(0.62 0.14 150)",
  "oklch(0.58 0.2 20)",
  "oklch(0.5 0.08 260)",
];

export type ObservedTool = {
  id?: string;
  name: string;
  status: string;
};

export function ObserveTools({ tools }: { tools: ObservedTool[] }) {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const max = ranked[0]?.[1] ?? 1;
  const colorOf = new Map(ranked.map(([name], index) => [name, COLORS[index % COLORS.length]]));

  if (tools.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-sm">
        No tool calls yet. Ask something on the Ask tab.
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[44rem] flex-col gap-8 overflow-auto px-4 py-6">
      <div>
        <h1 className="text-lg font-medium">Tool calls</h1>
        <p className="text-muted-foreground text-sm">
          {tools.length} {tools.length === 1 ? "call" : "calls"} across {ranked.length}{" "}
          {ranked.length === 1 ? "tool" : "tools"}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Calls by tool</h2>
        <ul className="flex flex-col gap-2.5">
          {ranked.map(([name, total]) => (
            <li key={name} className="grid grid-cols-[minmax(0,11rem)_1fr_2rem] items-center gap-3">
              <span className="truncate font-mono text-xs" title={name}>
                {name}
              </span>
              <div className="bg-muted h-2.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(total / max) * 100}%`,
                    background: colorOf.get(name),
                  }}
                />
              </div>
              <span className="text-end text-sm tabular-nums">{total}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Call sequence</h2>
        <div className="flex h-28 items-end gap-px">
          {tools.map((tool, index) => (
            <div
              key={tool.id ?? `${tool.name}-${index}`}
              title={`${index + 1}. ${tool.name} · ${tool.status}`}
              className="h-full min-w-1 flex-1 rounded-sm"
              style={{ background: colorOf.get(tool.name) }}
            />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {ranked.map(([name]) => (
            <li key={name} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="size-2 rounded-full" style={{ background: colorOf.get(name) }} />
              {name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
