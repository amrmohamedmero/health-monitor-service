import type { AlertPayload, NotificationChannel } from './types';

/** Slack via an Incoming Webhook URL (Block Kit formatting). */
export function slackChannel(webhookUrl: string): NotificationChannel {
  return {
    name: 'slack',
    async send(payload) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildMessage(payload)),
        });
        if (!response.ok) {
          console.error(`❌ Slack webhook failed: ${response.status} ${response.statusText}`);
          return false;
        }
        return true;
      } catch (error) {
        console.error('❌ Error sending Slack message:', error);
        return false;
      }
    },
  };
}

function buildMessage(payload: AlertPayload) {
  const emoji = payload.statusColor === 'green' ? '🟢' : payload.statusColor === 'orange' ? '🟠' : '🔴';

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${payload.title}`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: payload.summary } },
  ];

  // Slack section blocks cap at 10 fields.
  for (let i = 0; i < payload.facts.length; i += 10) {
    blocks.push({
      type: 'section',
      fields: payload.facts
        .slice(i, i + 10)
        .map(f => ({ type: 'mrkdwn', text: `*${f.title}*\n${f.value}` })),
    });
  }

  if (payload.analysis) {
    blocks.push(
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `🤖 *AI Analysis*\n${payload.analysis.summary}` } }
    );
  }

  if (payload.actions.length) {
    blocks.push({
      type: 'context',
      elements: payload.actions.map(a => ({ type: 'mrkdwn', text: `<${a.url}|${a.title}>` })),
    });
  }

  return { blocks };
}
