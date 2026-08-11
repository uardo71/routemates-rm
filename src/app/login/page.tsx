import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoutematesLogo } from "@/components/routemates-logo";
import { LoginForm } from "./login-form";
import { microsoftConfigured, isPasswordLoginAllowed } from "@/lib/settings";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const microsoftEnabled = microsoftConfigured();
  const passwordEnabled = await isPasswordLoginAllowed();

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center gap-3">
          <RoutematesLogo variant="color" className="h-12" />
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-3 text-sm text-destructive">
              {error === "AccessDenied"
                ? "This Microsoft account isn't set up for RM Ops. Ask an admin to add you with the same email."
                : "Sign-in failed. Please try again."}
            </p>
          )}
          <LoginForm microsoftEnabled={microsoftEnabled} passwordEnabled={passwordEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}
