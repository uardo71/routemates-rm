"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Owner picker for actions: type a name freely (client-side people) or pick one of our people from
// the list — picking stores both the display name and the user id. Typing a name that exactly
// matches a person (case-insensitive) links them too, so a pasted name still ends up on "My actions".

export type OwnerPerson = { id: string; name: string };
export type OwnerValue = { owner: string; ownerUserId: string | null };

export function resolveOwner(text: string, people: OwnerPerson[]): OwnerValue {
  const t = text.trim();
  const hit = t ? people.find((p) => p.name.trim().toLowerCase() === t.toLowerCase()) : undefined;
  return { owner: hit ? hit.name : t, ownerUserId: hit?.id ?? null };
}

export function OwnerCombobox({ value, people, onChange, placeholder = "Who owns it", className, inputClassName, disabled }: {
  value: OwnerValue; people: OwnerPerson[]; onChange: (v: OwnerValue) => void;
  placeholder?: string; className?: string; inputClassName?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value.owner);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Keep the box in step when the parent resets the draft (edit another row) — derived-state
  // pattern: adjust during render, not in an effect.
  const [seenOwner, setSeenOwner] = useState(value.owner);
  if (value.owner !== seenOwner) { setSeenOwner(value.owner); setText(value.owner); }

  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    return people.filter((p) => !t || p.name.toLowerCase().includes(t)).slice(0, 8);
  }, [people, text]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(p: OwnerPerson) {
    setText(p.name); setOpen(false);
    onChange({ owner: p.name, ownerUserId: p.id });
  }
  function commitText(t: string) {
    onChange(resolveOwner(t, people));
  }

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <input
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setHi(0); setOpen(true); commitText(e.target.value); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(matches[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className={cn("h-9 w-full rounded-md border border-input bg-background px-2.5 pr-7 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50", inputClassName)}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" title={value.ownerUserId ? "Linked to a person" : "Free text"}>
        {value.ownerUserId ? <CheckIcon className="size-3.5 text-emerald-600" /> : <UserIcon className="size-3.5 opacity-40" />}
      </span>
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted", i === hi && "bg-muted")}>
                <UserIcon className="size-3.5 text-muted-foreground" /> {p.name}
                {value.ownerUserId === p.id && <CheckIcon className="ml-auto size-3.5 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
