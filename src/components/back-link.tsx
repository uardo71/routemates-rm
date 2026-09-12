"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// "Back" that means back.
//
// Every detail page used to hardcode a link to its own index - open a project from the Dashboard or
// the Command center and "Back" still dumped you on /projects, losing where you actually came from.
// This goes one step back through the browser when there IS an in-app step to go back to, and falls
// back to the module index when there isn't (a bookmark, a deep link from e-mail, a fresh tab).
//
// `href` is still a real href, so middle-click, ctrl-click and "open in new tab" behave normally and
// the control is a proper link for keyboard and screen readers.

const DEPTH_KEY = "rm_nav_depth";

/** How many in-app navigations this tab has made. 1 = the page you landed on, so >1 means there is
 *  somewhere of ours to go back to. */
export function navDepth(): number {
  try {
    return Number(sessionStorage.getItem(DEPTH_KEY) ?? "0");
  } catch {
    return 0; // private mode / storage blocked - fall back to the index link
  }
}

export function bumpNavDepth(): void {
  try {
    sessionStorage.setItem(DEPTH_KEY, String(navDepth() + 1));
  } catch {
    /* ignore */
  }
}

export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        // Let the browser handle new-tab / new-window / download modifiers.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (navDepth() > 1) router.back();
        else router.push(href);
      }}
      className={cn("text-sm text-muted-foreground hover:underline", className)}
    >
      ← {label}
    </a>
  );
}
