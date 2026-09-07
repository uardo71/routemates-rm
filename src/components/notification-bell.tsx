"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BellIcon, CheckCheckIcon, MessageSquareIcon, ActivityIcon, UserPlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "@/lib/notifications";
import { getMyNotificationsAction, markNotificationReadAction, markAllNotificationsReadAction } from "@/app/notifications-actions";

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  COMMENT: MessageSquareIcon,
  STATUS: ActivityIcon,
  ASSIGN: UserPlusIcon,
};

export function NotificationBell({
  initialItems, initialUnread, basePath, openUp = false, tone = "sidebar",
}: {
  initialItems: NotificationItem[]; initialUnread: number; basePath: string; openUp?: boolean; tone?: "sidebar" | "bar";
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(initialItems);
  const [unread, setUnread] = React.useState(initialUnread);
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const PANEL_W = 320;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal needs document; only after mount
  React.useEffect(() => setMounted(true), []);

  const refresh = React.useCallback(async () => {
    const r = await getMyNotificationsAction();
    setItems(r.items); setUnread(r.unread);
  }, []);

  // Poll periodically.
  React.useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const toggleOpen = () => {
    const next = !open;
    if (next && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Sidebar bell extends rightward from its left edge; a top-bar bell aligns to its right edge.
      let left = tone === "sidebar" ? r.left : r.right - PANEL_W;
      left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8));
      setPos(openUp ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
      refresh();
    }
    setOpen(next);
  };

  // Close on outside click / Escape (button + portalled panel both count as "inside").
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.read) { setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x))); setUnread((u) => Math.max(0, u - 1)); markNotificationReadAction(n.id); }
    router.push(`${basePath}/${n.ticketId}`);
  }
  function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true }))); setUnread(0);
    markAllNotificationsReadAction().then(() => router.refresh());
  }

  const btnTone = tone === "sidebar"
    ? "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring"
    : "text-foreground/70 hover:bg-muted hover:text-foreground focus-visible:ring-ring";

  return (
    <>
      <button
        ref={btnRef}
        type="button" onClick={toggleOpen} aria-label="Notifications" aria-expanded={open}
        className={cn("relative inline-flex size-9 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none", btnTone)}
      >
        <BellIcon className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.6rem] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && mounted && createPortal(
        <div ref={panelRef} style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_W }} className="z-[100] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><CheckCheckIcon className="size-3.5" /> Mark all read</button>}
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? BellIcon;
                return (
                  <button key={n.id} onClick={() => openItem(n)} className={cn("flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left last:border-none hover:bg-muted/50", !n.read && "bg-primary/[0.04]")}>
                    <span className={cn("mt-0.5 shrink-0", n.read ? "text-muted-foreground/50" : "text-primary")}><Icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm"><span className="font-medium">{n.actorName}</span> {n.summary} <span className="font-mono text-xs text-muted-foreground">{n.ticketNumber}</span></span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{relTime(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}
