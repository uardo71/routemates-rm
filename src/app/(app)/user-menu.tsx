"use client";

import { useTransition } from "react";
import { LogOutIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "./sign-out-action";

export function UserMenu({ name, role }: { name: string; role: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent/60 outline-none">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-sidebar-foreground/50">{role}</div>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={pending} onClick={() => startTransition(() => signOutAction())}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeToggle />
    </div>
  );
}
