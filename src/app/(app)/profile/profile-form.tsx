"use client";

import { useActionState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateProfileAction, type ProfileFormState } from "./actions";

type ProfileFields = {
  name: string;
  title: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
};

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProfileForm({ profile }: { profile: ProfileFields }) {
  const [state, action, pending] = useActionState<ProfileFormState | undefined, FormData>(
    updateProfileAction,
    undefined
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name">
          <Input id="name" name="name" defaultValue={profile.name} required maxLength={120} />
        </Field>
        <Field label="Job title" htmlFor="title" hint="How your role reads on your profile.">
          <Input id="title" name="title" defaultValue={profile.title ?? ""} maxLength={120} placeholder="e.g. Senior Consultant" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={40} placeholder="e.g. +355 69 123 4567" />
        </Field>
        <Field label="Location" htmlFor="location">
          <Input id="location" name="location" defaultValue={profile.location ?? ""} maxLength={120} placeholder="e.g. Tirana, Albania" />
        </Field>
      </div>

      <Field label="About" htmlFor="bio" hint="A short bio your teammates see on your profile (max 500 characters).">
        <Textarea
          id="bio"
          name="bio"
          defaultValue={profile.bio ?? ""}
          rows={4}
          maxLength={500}
          placeholder="Tell your teammates a bit about what you do…"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {state?.ok && !pending && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4" /> Saved
          </span>
        )}
        {state?.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
