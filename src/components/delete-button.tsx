"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DeleteButton({
  action,
  confirmMessage,
  label = "Delete",
  className,
}: {
  action: () => Promise<void>;
  confirmMessage: string;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={pending}
      className={cn(className)}
      onClick={() => {
        if (!confirm(confirmMessage)) return;
        startTransition(async () => {
          try {
            await action();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete.");
          }
        });
      }}
    >
      {pending ? "Deleting..." : label}
    </Button>
  );
}
