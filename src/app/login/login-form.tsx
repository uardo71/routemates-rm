"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, microsoftLoginAction } from "./actions";

export function LoginForm({
  microsoftEnabled = false,
  passwordEnabled = true,
  customerMode = false,
}: {
  microsoftEnabled?: boolean;
  passwordEnabled?: boolean;
  customerMode?: boolean;
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

      {customerMode ? (
        <Link href="/login" className="text-center text-xs text-muted-foreground hover:underline">
          ← Staff sign-in
        </Link>
      ) : (
        <Link href="/login?customer=1" className="text-center text-xs text-muted-foreground hover:underline">
          Customer? Sign in to the support portal
        </Link>
      )}
    </div>
  );
}
