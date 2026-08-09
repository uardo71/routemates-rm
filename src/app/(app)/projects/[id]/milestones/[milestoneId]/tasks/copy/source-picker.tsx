"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Option = { id: string; name: string };

export function SourceMilestonePicker({ options, currentId }: { options: Option[]; currentId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = options.find((o) => o.id === currentId);
  const trimmed = query.trim();
  const filtered = useMemo(
    () =>
      (trimmed.length < 1 ? options : options.filter((o) => o.name.toLowerCase().includes(trimmed.toLowerCase()))).slice(
        0,
        50
      ),
    [options, trimmed]
  );

  function select(id: string) {
    router.push(`${pathname}?source=${id}`);
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
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
      >
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current?.name ?? "Select a milestone to copy tasks from…"}</span>
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy tasks from</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Type a milestone or project name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-72 overflow-auto rounded-md border">
            {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground">No matches.</div>}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => select(o.id)}
                className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
              >
                {o.name}
                {o.id === currentId && <span className="ml-2 text-xs text-muted-foreground">(current)</span>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
