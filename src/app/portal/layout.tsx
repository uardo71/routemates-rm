import Link from "next/link";
import { NavDepthTracker } from "@/app/(app)/nav-depth";
import { LifeBuoyIcon, LogOutIcon } from "lucide-react";
import { requirePortalUser } from "@/lib/portal";
import { loadNotifications } from "@/lib/notifications";
import { InitialsAvatar } from "@/components/initials-avatar";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "../(app)/sign-out-action";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePortalUser();
  const notif = await loadNotifications(u.id);
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal" className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-foreground text-background"><LifeBuoyIcon className="size-4" /></span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">{u.companyName} · Support</span>
              <span className="text-xs text-muted-foreground">{u.clientName}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell initialItems={notif.items} initialUnread={notif.unread} basePath="/portal" tone="bar" />
            <ThemeToggle />
            <div className="hidden items-center gap-2 sm:flex">
              <InitialsAvatar name={u.name} size="sm" />
              <span className="text-sm text-muted-foreground">{u.name}</span>
            </div>
            <form action={signOutAction}>
              <button className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted" title="Sign out"><LogOutIcon className="size-4" /> <span className="hidden sm:inline">Sign out</span></button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6"><NavDepthTracker />{children}</main>
    </div>
  );
}
