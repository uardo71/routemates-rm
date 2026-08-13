// App-only (client-credentials) Microsoft Graph mail, reusing the SAME Entra app registration as
// SSO — no new provider, no new client credentials. Unlike SSO (delegated / on behalf of a signed-in
// user), a cron-triggered nudge has no user, so it uses the client-credentials grant. This requires
// the Mail.Send APPLICATION permission (+ admin consent) on the app registration, and a real sender
// mailbox (GRAPH_MAIL_SENDER) in the tenant. See docs / the plan for the portal steps.

type GraphConfig = { clientId: string; clientSecret: string; tenantId: string; sender: string };

function graphConfig(): GraphConfig | null {
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  const sender = process.env.GRAPH_MAIL_SENDER;
  // Tenant id lives inside the SSO issuer URL (same parse auth.ts uses) — no separate env var.
  const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.match(
    /login\.microsoftonline\.com\/([^/]+)\/v2\.0/i
  )?.[1];
  if (!clientId || !clientSecret || !sender || !tenantId) return null;
  return { clientId, clientSecret, tenantId, sender };
}

export function graphMailConfigured(): boolean {
  return graphConfig() !== null;
}

// Cache the app token for the process — a single nudge run sends up to ~10 mails, and the token is
// valid ~1h. Refreshed with a 60s safety margin.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppOnlyToken(cfg: GraphConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!res.ok) {
    throw new Error(`Entra token request failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export async function sendGraphMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const cfg = graphConfig();
  if (!cfg) {
    throw new Error("Microsoft Graph mail is not configured (Entra vars + GRAPH_MAIL_SENDER).");
  }
  const token = await getAppOnlyToken(cfg);

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.sender)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: "HTML", content: opts.html },
          toRecipients: [{ emailAddress: { address: opts.to } }],
        },
        saveToSentItems: false,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
  }
}
