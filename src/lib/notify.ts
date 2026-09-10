import { graphMailConfigured, sendGraphMail } from "@/lib/graph-mail";
import { teamsWebhookConfigured, postTeamsMessage } from "@/lib/teams-webhook";

// The one place that fans a message out to the channels we have. Email goes to each recipient
// individually (a recipient may carry its own subject/body — the timesheet nudge personalises
// per person); Teams gets a single post. The two channels are isolated: every send is wrapped so
// one address bouncing, or the webhook being down, never prevents the other channel from going out.
// Nothing here decides *whether* to notify — that's the caller's (and the Notification ledger's) job.

export type EmailRecipient =
  | string
  | {
      to: string;
      /** Per-recipient override; falls back to the top-level subject/html. */
      subject?: string;
      html?: string;
    };

export type NotifyInput = {
  subject: string;
  html: string;
  recipients: EmailRecipient[];
  /** Teams post. Omit (or leave empty) to skip the Teams channel for this message. */
  teamsTitle?: string;
  teamsText?: string;
  teamsColor?: string;
  /** Admin toggles from settings; a channel that is configured but switched off is reported as not configured. */
  channels?: { email?: boolean; teams?: boolean };
};

export type NotifyResult = {
  email: { configured: boolean; sent: string[]; errors: string[] };
  teams: { configured: boolean; status: string };
};

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const emailOn = input.channels?.email ?? true;
  const teamsOn = input.channels?.teams ?? true;
  const result: NotifyResult = {
    email: { configured: graphMailConfigured() && emailOn, sent: [], errors: [] },
    teams: { configured: teamsWebhookConfigured() && teamsOn && Boolean(input.teamsText), status: "skipped" },
  };

  if (result.email.configured) {
    for (const r of input.recipients) {
      const to = typeof r === "string" ? r : r.to;
      const subject = typeof r === "string" ? input.subject : (r.subject ?? input.subject);
      const html = typeof r === "string" ? input.html : (r.html ?? input.html);
      try {
        await sendGraphMail({ to, subject, html });
        result.email.sent.push(to);
      } catch (e) {
        result.email.errors.push(`${to}: ${(e as Error).message}`);
      }
    }
  }

  if (result.teams.configured) {
    try {
      await postTeamsMessage({ title: input.teamsTitle ?? input.subject, markdown: input.teamsText!, themeColor: input.teamsColor });
      result.teams.status = "sent";
    } catch (e) {
      result.teams.status = `error: ${(e as Error).message}`;
    }
  }

  return result;
}

/** True when at least one channel actually delivered. */
export function delivered(r: NotifyResult): boolean {
  return r.email.sent.length > 0 || r.teams.status === "sent";
}

/** True when there is no channel that could deliver at all — the caller should not record an alert
 *  as sent in that case, or it would never go out once a channel is configured. */
export function noChannelAvailable(r: NotifyResult): boolean {
  return !r.email.configured && !r.teams.configured;
}
