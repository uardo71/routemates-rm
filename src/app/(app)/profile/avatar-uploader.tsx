"use client";

import { useActionState, useRef } from "react";
import { CameraIcon, Trash2Icon } from "lucide-react";
import { InitialsAvatar } from "@/components/initials-avatar";
import { Button } from "@/components/ui/button";
import { uploadAvatarAction, removeAvatarAction, type ProfileFormState } from "./actions";

export function AvatarUploader({ name, src }: { name: string; src: string | null }) {
  const [state, action, pending] = useActionState<ProfileFormState | undefined, FormData>(
    uploadAvatarAction,
    undefined
  );
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <InitialsAvatar name={name} src={src} size="xl" className="ring-4 ring-card shadow-paper" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label="Change photo"
          className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-foreground text-background ring-2 ring-card transition-colors hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <CameraIcon className="size-4" />
        </button>
      </div>

      <form ref={formRef} action={action} className="contents">
        <input
          ref={inputRef}
          type="file"
          name="avatar"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={() => formRef.current?.requestSubmit()}
        />
      </form>

      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
          {pending ? "Uploading…" : src ? "Change" : "Upload photo"}
        </Button>
        {src && !pending && (
          <form action={removeAvatarAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
              <Trash2Icon className="size-3.5" />
              Remove
            </Button>
          </form>
        )}
      </div>

      {state?.error && <p className="max-w-[12rem] text-center text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
