"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, microsoftLoginAction } from "./actions";

export function LoginForm({
  microsoftEnabled = false,
  passwordEnabled = true,
}: {
  microsoftEnabled?: boolean;
  passwordEnabled?: boolean;
}) {
  const [error, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="flex flex-col gap-4">
      {microsoftEnabled && (
        <form action={microsoftLoginAction}>
          <Button type="submit" variant="outline" className="w-full">
            Sign in with Microsoft
          </Button>
        </form>
      )}

      {microsoftEnabled && passwordEnabled && (
        <div className="relative text-center">
          <span className="bg-card text-muted-foreground relative z-10 px-2 text-xs uppercase">or</span>
          <span className="bg-border absolute inset-x-0 top-1/2 h-px" />
        </div>
      )}

      {passwordEnabled && (
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}
