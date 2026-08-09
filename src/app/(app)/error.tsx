"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AppError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground max-w-md">{error.message}</p>
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to dashboard
      </Link>
    </div>
  );
}
