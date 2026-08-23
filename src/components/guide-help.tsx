"use client";

import * as React from "react";
import {
  LifeBuoyIcon,
  SearchIcon,
  ChevronDownIcon,
  GitPullRequestIcon,
  TriangleAlertIcon,
  FlagIcon,
  MessageSquareWarningIcon,
  CircleArrowUpIcon,
  FileTextIcon,
  RocketIcon,
  CompassIcon,
  DatabaseIcon,
  BanknoteIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GUIDE_CATEGORIES, GUIDE_CATEGORY_LABEL } from "@/lib/guides";
import type { Guide } from "@/lib/guides-server";

const ICONS: Record<string, LucideIcon> = {
  gitPullRequest: GitPullRequestIcon,
  alertTriangle: TriangleAlertIcon,
  flag: FlagIcon,
  messageSquareWarning: MessageSquareWarningIcon,
  arrowUpCircle: CircleArrowUpIcon,
  fileText: FileTextIcon,
  rocket: RocketIcon,
  compass: CompassIcon,
  database: DatabaseIcon,
  banknote: BanknoteIcon,
  users: UsersIcon,
};
const CAT_ICON: Record<string, string> = Object.fromEntries(GUIDE_CATEGORIES.map((c) => [c.value, c.icon]));
const CAT_ORDER: Record<string, number> = Object.fromEntries(GUIDE_CATEGORIES.map((c, i) => [c.value, i]));

function iconFor(category: string): LucideIcon {
  return ICONS[CAT_ICON[category] ?? "compass"] ?? CompassIcon;
}

export function GuideHelp({
  guides,
  triggerLabel = "How do I handle…?",
  triggerClassName,
  initialCategory,
}: {
  guides: Guide[];
  triggerLabel?: string;
  triggerClassName?: string;
  initialCategory?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // Open and reset state; if a target category was given, jump to its first guide.
  function openDialog() {
    setQ("");
    const first = initialCategory ? guides.find((g) => g.category === initialCategory) : undefined;
    setExpanded(first?.id ?? null);
    setOpen(true);
  }

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? guides.filter((g) =>
          [g.title, g.summary ?? "", g.source ?? "", GUIDE_CATEGORY_LABEL[g.category] ?? "", g.steps.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : guides;
    return [...list].sort(
      (a, b) => (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99) || a.sortOrder - b.sortOrder,
    );
  }, [guides, q]);

  // Group filtered guides by category, preserving category order.
  const groups = React.useMemo(() => {
    const map = new Map<string, Guide[]>();
    for (const g of filtered) {
      const arr = map.get(g.category) ?? [];
      arr.push(g);
      map.set(g.category, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        className={cn("gap-2", triggerClassName)}
      >
        <LifeBuoyIcon className="size-4 text-primary" />
        {triggerLabel}
      </Button>

      <Dialog open={open} disablePointerDismissal onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden gap-0 p-0">
          <DialogHeader className="border-b p-4">
            <DialogTitle className="flex items-center gap-2">
              <LifeBuoyIcon className="size-[18px] text-primary" />
              How do I handle…?
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Quick, practical guidance from our ways of working. It&apos;s advice — not a checklist you have to complete.
            </p>
            <div className="relative mt-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search situations… (change request, unhappy customer, go-live)"
                className="pl-8"
              />
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {groups.length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                No guidance matches “{q}”. Try a different word.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {groups.map(([category, items]) => {
                  const CatIcon = iconFor(category);
                  return (
                    <section key={category}>
                      <div className="mb-1.5 flex items-center gap-2 px-1">
                        <CatIcon className="size-3.5 text-muted-foreground" />
                        <span className="text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          {GUIDE_CATEGORY_LABEL[category] ?? category}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {items.map((g) => (
                          <GuideRow key={g.id} guide={g} open={expanded === g.id} onToggle={() => setExpanded((cur) => (cur === g.id ? null : g.id))} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GuideRow({ guide, open, onToggle }: { guide: Guide; open: boolean; onToggle: () => void }) {
  return (
    <div className={cn("rounded-md border transition-colors", open ? "border-primary/40 bg-muted/40" : "border-border bg-card")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{guide.title}</div>
          {guide.summary && <div className="mt-0.5 text-xs text-muted-foreground">{guide.summary}</div>}
        </div>
        <ChevronDownIcon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 pt-2.5 pb-3">
          <ol className="flex flex-col gap-2">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-foreground">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[0.6875rem] font-semibold text-primary tabular-nums">
                  {i + 1}
                </span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
          {guide.source && (
            <div className="mt-3 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
              <BookMark />
              {guide.source}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BookMark() {
  return <FileTextIcon className="size-3" />;
}
