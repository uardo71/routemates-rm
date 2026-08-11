import { requirePermission } from "@/lib/session";
import { getPasswordLoginSetting, microsoftConfigured } from "@/lib/settings";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  await requirePermission("users:manage");
  const passwordLogin = await getPasswordLoginSetting();
  const ssoConfigured = microsoftConfigured();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">App-wide sign-in &amp; security settings.</p>
      </div>
      <SettingsClient passwordLogin={passwordLogin} ssoConfigured={ssoConfigured} />
    </div>
  );
}
