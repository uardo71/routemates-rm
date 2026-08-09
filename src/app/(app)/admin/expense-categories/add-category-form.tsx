"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createExpenseCategoryAction } from "./actions";

export function AddCategoryForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");

  function submit() {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await createExpenseCategoryAction(name);
      if (result.error) {
        toast.error(result.error);
      } else {
        setName("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="New category name"
        className="w-56"
        maxLength={100}
      />
      <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>
        <PlusIcon /> {pending ? "Adding..." : "Add"}
      </Button>
    </div>
  );
}
