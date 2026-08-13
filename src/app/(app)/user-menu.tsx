"use client";

import Link from "next/link";
import { useTransition } from "react";
import { LogOutIcon, UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InitialsAvatar } from "@/components/initials-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "./sign-out-action";
import { cn } from "@/lib/utils";

export function UserMenu({
  name,
  role,
  avatarSrc = null,
  collapsed = false,
}: {
  name: string;
  role: string;
  avatarSrc?: string | null;
  collapsed?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className={cn("flex items-center gap-1", collapsed && "justify-center")}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex items-center gap-2 rounded-sm text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none",
            collapsed ? "justify-center p-1" : "flex-1 px-2 py-1.5",
          )}
        >
          {avatarSrc ? (
            <InitialsAvatar name={name} src={avatarSrc} size="sm" className="rounded-full" />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="truncate text-xs text-sidebar-foreground/50 uppercase tracking-wide">{role}</div>
            </div>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={collapsed ? "center" : "start"} className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/profile" />}>
              <UserIcon />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem disabled={pending} onClick={() => startTransition(() => signOutAction())}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {!collapsed && <ThemeToggle />}
    </div>
  );
}
