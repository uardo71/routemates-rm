import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoutematesLogo } from "@/components/routemates-logo";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center gap-3">
          <RoutematesLogo variant="color" className="h-12" />
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
