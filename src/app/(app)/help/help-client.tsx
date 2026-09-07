"use client";

import * as React from "react";
import { SearchIcon, BookOpenIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HELP, HELP_GROUPS, type HelpSection, type HelpBlock } from "@/lib/help-content";

function sectionText(s: HelpSection): string {
  const parts: string[] = [s.title, s.group];
  for (const b of s.blocks) {
    if (b.t === "p" || b.t === "callout") parts.push(b.text);
    else if (b.t === "list" || b.t === "steps") parts.push(b.items.join(" "));
    else if (b.t === "formula") parts.push(b.name, b.expr, b.note ?? "");
    else if (b.t === "table") parts.push(b.head.join(" "), b.rows.flat().join(" "));
  }
  return parts.join(" ").toLowerCase();
}

export function HelpClient() {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? HELP.filter((s) => sectionText(s).includes(needle)) : HELP;
  const groups = HELP_GROUPS.map((g) => ({ group: g, sections: filtered.filter((s) => s.group === g) })).filter((g) => g.sections.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><BookOpenIcon className="size-6 text-primary" /> Help &amp; documentation</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">How every part of RM Ops works — modules, workflows and the formulas behind the numbers.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the docs…" className="pl-8" />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* TOC */}
        <nav className="hidden lg:block">
          <div className="sticky top-4 flex flex-col gap-4 text-sm">
            {groups.map((g) => (
              <div key={g.group} className="flex flex-col gap-1">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.group}</div>
                {g.sections.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className="truncate rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">{s.title}</a>
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="flex min-w-0 flex-col gap-8">
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No help topics match &ldquo;{q}&rdquo;.</p>
          ) : (
            groups.map((g) => (
              <section key={g.group} className="flex flex-col gap-5">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{g.group}</h2>
                {g.sections.map((s) => (
                  <article key={s.id} id={s.id} className="scroll-mt-6 rounded-xl border bg-card p-5">
                    <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      {s.blocks.map((b, i) => <Block key={i} b={b} />)}
                    </div>
                  </article>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ b }: { b: HelpBlock }) {
  switch (b.t) {
    case "p":
      return <p className="text-sm leading-relaxed text-muted-foreground">{b.text}</p>;
    case "list":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/50" style={{ listStyleType: "disc" }}>
          {b.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "steps":
      return (
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground" style={{ listStyleType: "decimal" }}>
          {b.items.map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      );
    case "formula":
      return (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{b.name}</div>
          <div className="mt-1 font-mono text-sm text-foreground">{b.expr}</div>
          {b.note && <div className="mt-1.5 text-xs text-muted-foreground">{b.note}</div>}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {b.head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-b last:border-none align-top">
                  {r.map((c, ci) => <td key={ci} className={cn("px-3 py-2", ci === 0 && "font-medium text-foreground")}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <div className={cn("rounded-lg border px-3 py-2.5 text-sm leading-relaxed", b.tone === "warn" ? "border-amber-500/40 bg-amber-500/[0.06] text-amber-800 dark:text-amber-300" : "border-primary/25 bg-primary/[0.05] text-foreground/90")}>
          {b.text}
        </div>
      );
  }
}
