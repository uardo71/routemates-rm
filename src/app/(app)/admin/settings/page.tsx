import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getPasswordLoginSetting,
  microsoftConfigured,
  getTimesheetNudgeConfig,
} from "@/lib/settings";
import { graphMailConfigured } from "@/lib/graph-mail";
import { teamsWebhookConfigured } from "@/lib/teams-webhook";
import { SettingsClient } from "./settings-client";
import { NudgeSettingsClient } from "./nudge-settings-client";

export default async function SettingsPage() {
  const admin = await requirePermission("users:manage");

  const [passwordLogin, nudgeConfig, users, company] = await Promise.all([
    getPasswordLoginSetting(),
    getTimesheetNudgeConfig(),
    prisma.user.findMany({
      where: { companyId: admin.companyId, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: admin.companyId }, select: { currency: true } }),
  ]);
  const ssoConfigured = microsoftConfigured();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Sign-in, security &amp; automation.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Reporting currency</div>
          <p className="mt-0.5 text-sm text-muted-foreground">Every report (revenue, budgets, invoices, expenses, vendors, taxes) converts amounts to this currency at each row&apos;s own date.</p>
        </div>
        <span className="rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-lg font-semibold">{company.currency}</span>
      </div>

      <Tabs defaultValue="signin" className="gap-5">
        <TabsList>
          <TabsTrigger value="signin">Sign-in &amp; security</TabsTrigger>
          <TabsTrigger value="nudge">Timesheet nudge</TabsTrigger>
        </TabsList>

        <TabsContent value="signin">
          <SettingsClient passwordLogin={passwordLogin} ssoConfigured={ssoConfigured} />
        </TabsContent>

        <TabsContent value="nudge">
          <NudgeSettingsClient
            config={nudgeConfig}
            users={users}
            emailConfigured={graphMailConfigured()}
            teamsConfigured={teamsWebhookConfigured()}
            secretConfigured={Boolean(process.env.TIMESHEET_NUDGE_SECRET)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
