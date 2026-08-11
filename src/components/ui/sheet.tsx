"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetTitle(props: SheetPrimitive.Title.Props) {
  return <SheetPrimitive.Title data-slot="sheet-title" {...props} />;
}

function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: SheetPrimitive.Popup.Props & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className={cn(
          "fixed inset-0 z-40 bg-foreground/40 duration-200 supports-backdrop-filter:backdrop-blur-sm",
          "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:hidden",
          "motion-reduce:animate-none",
        )}
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-[17rem] max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-paper outline-none duration-200 ease-out",
          "data-open:animate-in data-closed:animate-out data-closed:hidden motion-reduce:animate-none",
          side === "left" &&
            "left-0 border-r border-sidebar-border data-open:slide-in-from-left data-closed:slide-out-to-left",
          side === "right" &&
            "right-0 border-l border-sidebar-border data-open:slide-in-from-right data-closed:slide-out-to-right",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetTitle, SheetContent };
