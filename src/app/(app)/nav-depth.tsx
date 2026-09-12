"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { bumpNavDepth } from "@/components/back-link";

// Counts in-app navigations for this tab so a "Back" control can tell "you came from somewhere in
// the app" (go back one step) from "you landed here directly" (go to the module index). Renders
// nothing; mounted once in the app shell.
export function NavDepthTracker() {
  const pathname = usePathname();
  React.useEffect(() => {
    bumpNavDepth();
  }, [pathname]);
  return null;
}
