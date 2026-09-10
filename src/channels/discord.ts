import type { AlertPayload, NotificationChannel } from './types';

/** Discord via a channel Webhook URL (embed formatting). */
export function discordChannel(webhookUrl: string): NotificationChannel {
  return {
    name: 'discord',
    async send(payload) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [buildEmbed(payload)] }),
        });
        // Discord webhooks return 204 with no body on success.
        if (!response.ok) {
          console.error(`❌ Discord webhook failed: ${response.status} ${response.statusText}`);
          return false;
        }
        return true;
      } catch (error) {
        console.error('❌ Error sending Discord message:', error);
        return false;
      }
    },
  };
}

function buildEmbed(payload: AlertPayload) {
  const color =
    payload.statusColor === 'green' ? 0x2ecc71 : payload.statusColor === 'orange' ? 0xe67e22 : 0xe74c3c;

  const fields = payload.facts.slice(0, 25).map(f => ({ name: f.title, value: f.value, inline: true }));
  if (payload.analysis) {
    fields.push({ name: '🤖 AI Analysis', value: payload.analysis.summary.slice(0, 1024), inline: false });
  }

  return {
    title: payload.title,
    description: payload.summary,
    color,
    fields,
    url: payload.actions[0]?.url,
    timestamp: payload.timestamp,
  };
}
