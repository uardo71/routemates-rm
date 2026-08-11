import { prisma } from "@/lib/prisma";

// Global app settings (see model AppSetting). Kept tiny and dependency-light so it can be read from
// the login page and the Credentials authorize() — i.e. BEFORE there is a session.

const PASSWORD_LOGIN_KEY = "passwordLoginEnabled";

/** Whether Microsoft Entra ID SSO is configured (env vars present). */
export function microsoftConfigured(): boolean {
  return !!(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
}

/** The raw admin toggle value (defaults to enabled when never set). This is what the admin panel
 *  shows and flips — independent of the break-glass overrides below. */
export async function getPasswordLoginSetting(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: PASSWORD_LOGIN_KEY } });
  return row ? row.value === "true" : true;
}

export async function setPasswordLoginSetting(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: PASSWORD_LOGIN_KEY },
    create: { key: PASSWORD_LOGIN_KEY, value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
}

/** Whether email+password login is ACTUALLY allowed right now — the value both the login UI and the
 *  server-side authorize() must honour. Break-glass guarantees you can never lock everyone out:
 *   • if SSO isn't configured, password login is always available (there'd be no other way in);
 *   • if AUTH_ALLOW_PASSWORD_LOGIN=true (an env override you set on the server in an emergency),
 *     password login is forced on regardless of the DB toggle;
 *   • otherwise the admin toggle decides (default enabled). */
export async function isPasswordLoginAllowed(): Promise<boolean> {
  if (!microsoftConfigured()) return true;
  if (process.env.AUTH_ALLOW_PASSWORD_LOGIN === "true") return true;
  return getPasswordLoginSetting();
}
