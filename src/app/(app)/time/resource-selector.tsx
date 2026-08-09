"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Option = { id: string; name: string };

export function ResourceSelector({ resources, currentId }: { resources: Option[]; currentId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = resources.find((r) => r.id === currentId);
  const trimmed = query.trim();
  const filtered = useMemo(
    () => (trimmed.length < 1 ? resources : resources.filter((r) => r.name.toLowerCase().includes(trimmed.toLowerCase()))).slice(0, 50),
    [resources, trimmed]
  );

  function select(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("resource", id);
    router.push(`/time?${params.toString()}`);
    setDialogOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setDialogOpen(true);
        }}
        className="flex h-9 w-56 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
      >
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current?.name ?? "Select resource…"}</span>
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch resource</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Type a name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-72 overflow-auto rounded-md border">
            {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground">No matches.</div>}
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => select(r.id)}
                className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
              >
                {r.name}
                {r.id === currentId && <span className="ml-2 text-xs text-muted-foreground">(current)</span>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
