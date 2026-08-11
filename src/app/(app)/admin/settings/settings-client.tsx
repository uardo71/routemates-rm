"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setPasswordLoginAction } from "./actions";

export function SettingsClient({ passwordLogin, ssoConfigured }: { passwordLogin: boolean; ssoConfigured: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    if (
      !next &&
      !confirm(
        "Disable password login? Only Microsoft SSO will be able to sign in. You can re-enable it here anytime, and there's an emergency env override so you can't get locked out.",
      )
    ) {
      return;
    }
    start(async () => {
      const r = await setPasswordLoginAction(next);
      if (r.error) toast.error(r.error);
      else {
        toast.success(next ? "Password login enabled." : "Password login disabled — SSO only.");
        router.refresh();
      }
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Sign-in methods</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Email &amp; password login</span>
              <Badge variant={passwordLogin ? "default" : "secondary"}>{passwordLogin ? "Enabled" : "Disabled"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {ssoConfigured
                ? "When disabled, only Microsoft SSO can sign in. Recommended once everyone is on SSO."
                : "Microsoft SSO isn't configured yet, so password login stays on regardless of this setting."}
            </p>
          </div>
          <Button
            size="sm"
            variant={passwordLogin ? "outline" : "default"}
            disabled={pending || !ssoConfigured}
            onClick={() => toggle(!passwordLogin)}
          >
            {passwordLogin ? "Disable (SSO only)" : "Enable password login"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground border-t pt-3">
          Emergency access: if SSO ever goes down while password login is off, set{" "}
          <code className="rounded bg-muted px-1 py-0.5">AUTH_ALLOW_PASSWORD_LOGIN=true</code> in the server environment
          and restart to force password login back on — so you can never be locked out.
        </p>
      </CardContent>
    </Card>
  );
}
