"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon, ChevronLeftIcon } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RoutematesLogo } from "@/components/routemates-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "./user-menu";
import { SidebarNav, type NavGroup } from "./sidebar-nav";
import { cn } from "@/lib/utils";

const COLLAPSE_COOKIE = "rm_sidebar_collapsed";

function ChromeIconButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-sm text-sidebar-foreground/70 transition-colors",
        "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarShell({
  groups,
  userName,
  userRole,
  userAvatar = null,
  defaultCollapsed = false,
  children,
}: {
  groups: NavGroup[];
  userName: string;
  userRole: string;
  userAvatar?: string | null;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the drawer on any route change (covers programmatic nav / back button).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing overlay visibility to the route is a valid effect
  React.useEffect(() => setMobileOpen(false), [pathname]);

  // Force-close if we cross into desktop while the drawer is open.
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setMobileOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `${COLLAPSE_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  return (
    <TooltipProvider>
      <div className="flex min-h-full flex-1">
        {/* ---------- DESKTOP SIDEBAR (hidden below md) ---------- */}
        <aside
          data-collapsed={collapsed || undefined}
          className={cn(
            "group/sidebar relative hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex",
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "w-[4.5rem]" : "w-60",
          )}
        >
          {/* brand header */}
          <div
            className={cn(
              "flex h-16 shrink-0 items-center border-b border-sidebar-border/70",
              collapsed ? "justify-center px-0" : "px-4",
            )}
          >
            {collapsed ? (
              <div className="flex size-9 items-center justify-center rounded-sm bg-sidebar-primary font-heading text-sm font-bold text-sidebar-primary-foreground">
                R
              </div>
            ) : (
              <RoutematesLogo variant="negative" className="h-8 w-auto" />
            )}
          </div>

          {/* floating collapse toggle (rotates; clear affordance in both states) */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="absolute top-[1.65rem] -right-3 z-20 hidden size-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-paper transition-colors hover:border-sidebar-ring/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none md:flex"
          >
            <ChevronLeftIcon
              className={cn(
                "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
                collapsed && "rotate-180",
              )}
            />
          </button>

          {/* nav + scroll fade masks */}
          <div className="relative min-h-0 flex-1">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-sidebar to-transparent"
            />
            <div className="h-full overflow-x-hidden overflow-y-auto [scrollbar-width:thin]">
              <SidebarNav groups={groups} collapsed={collapsed} />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-gradient-to-t from-sidebar to-transparent"
            />
          </div>

          {/* footer */}
          <div className="border-t border-sidebar-border/70 p-2">
            <UserMenu name={userName} role={userRole} avatarSrc={userAvatar} collapsed={collapsed} />
          </div>
        </aside>

        {/* ---------- CONTENT COLUMN ---------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* glass mobile top bar (sits on paper → theme-aware logo) */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-3 supports-backdrop-filter:bg-background/70 supports-backdrop-filter:backdrop-blur-md md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              className="inline-flex size-9 items-center justify-center rounded-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <MenuIcon className="size-5" />
            </button>
            <RoutematesLogo variant="color" className="h-7 dark:hidden" />
            <RoutematesLogo variant="negative" className="hidden h-7 dark:block" />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-auto bg-background p-4 sm:p-6">
            <div className="w-full">{children}</div>
          </main>
        </div>

        {/* ---------- MOBILE DRAWER ---------- */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent id="mobile-nav" side="left" className="md:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
              <RoutematesLogo variant="negative" className="h-7 w-auto" />
              <ChromeIconButton aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
                <XIcon className="size-5" />
              </ChromeIconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav groups={groups} onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-sidebar-border p-2">
              <UserMenu name={userName} role={userRole} avatarSrc={userAvatar} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
