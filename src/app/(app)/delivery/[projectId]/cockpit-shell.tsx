"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CockpitTab = { value: string; label: string; content: ReactNode };

// URL-driven tab shell: the active tab lives in `?tab=`, so "My Day" deep-links (and the Overview
// tab's own buttons) land on the right section — including on a soft in-page navigation.
export function CockpitShell({ tabs, initial }: { tabs: CockpitTab[]; initial: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const wanted = sp.get("tab");
  const active = tabs.some((t) => t.value === wanted) ? (wanted as string) : initial;

  function setTab(v: string) {
    const p = new URLSearchParams(sp.toString());
    p.set("tab", v);
    router.replace(`?${p.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={active} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-4">{t.content}</TabsContent>
      ))}
    </Tabs>
  );
}
