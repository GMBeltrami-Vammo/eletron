import "server-only";

/**
 * Minimal Slack sender for app-side alerts (ARQIA, Gabriel 2026-07-22). Posts a
 * DM to each recipient via chat.postMessage with SLACK_BOT_TOKEN (bot needs
 * chat:write). Best-effort: never throws — returns which users got the message.
 * No token → no-op (returns ok:false, sentTo:[]).
 */

/** Default recipients = os 3 IDs conhecidos do workflow n8n; override via env. */
const DEFAULT_ARQIA_USERS = ["U0A42QX2EJG", "U083SU00P0V", "U0AGGA84WAH"];

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

export function arqiaAlertRecipients(): string[] {
  const csv = process.env.ARQIA_ALERT_SLACK_USERS;
  if (csv) {
    const ids = csv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length) return ids;
  }
  return DEFAULT_ARQIA_USERS;
}

async function postDM(token: string, userId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: userId, text }),
    });
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export interface SlackSendResult {
  ok: boolean;
  sentTo: string[];
}

/** Sends `text` to the ARQIA alert recipients. ok = at least one delivered. */
export async function sendArqiaAlert(text: string): Promise<SlackSendResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, sentTo: [] };
  const recipients = arqiaAlertRecipients();
  const sentTo: string[] = [];
  for (const userId of recipients) {
    if (await postDM(token, userId, text)) sentTo.push(userId);
  }
  return { ok: sentTo.length > 0, sentTo };
}
