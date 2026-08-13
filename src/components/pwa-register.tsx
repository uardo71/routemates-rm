"use client";

import { useEffect } from "react";

// Registers the minimal service worker (public/sw.js) so the app is installable to a phone home
// screen. The SW itself does no caching (see the file), so this can't break auth or serve stale pages.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability is best-effort; ignore registration failures */
      });
    }
  }, []);
  return null;
}
