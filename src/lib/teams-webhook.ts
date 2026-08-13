// Posts to a Teams Incoming Webhook (a shared channel) — the simplest option, needing no Graph
// permissions and no per-user DMs. One message lists everyone missing a timecard.

export function teamsWebhookConfigured(): boolean {
  return Boolean(process.env.TEAMS_WEBHOOK_URL);
}

/** Sends a legacy MessageCard (the format Incoming Webhooks accept). `markdown` renders in the card
 *  body. Throws on a non-2xx response so the caller can record the failure. */
export async function postTeamsMessage(opts: {
  title: string;
  markdown: string;
  themeColor?: string;
}): Promise<void> {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) throw new Error("TEAMS_WEBHOOK_URL is not configured.");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: opts.title,
      themeColor: opts.themeColor ?? "A9812F", // brass, matching the app accent
      title: opts.title,
      text: opts.markdown,
    }),
  });
  if (!res.ok) {
    throw new Error(`Teams webhook failed (${res.status}): ${await res.text()}`);
  }
}
