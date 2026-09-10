import type { AlertPayload, NotificationChannel } from './types';

interface AdaptiveCard {
  type: 'AdaptiveCard';
  version: '1.5';
  msteams?: { width?: 'Full' };
  body: unknown[];
}

/** Microsoft Teams via an Incoming Webhook connector URL. */
export function teamsChannel(webhookUrl: string): NotificationChannel {
  return {
    name: 'teams',
    async send(payload) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'message',
            attachments: [
              { contentType: 'application/vnd.microsoft.card.adaptive', content: buildCard(payload) },
            ],
          }),
        });
        if (!response.ok) {
          console.error(`❌ Teams webhook failed: ${response.status} ${response.statusText}`);
          return false;
        }
        return true;
      } catch (error) {
        console.error('❌ Error sending Teams message:', error);
        return false;
      }
    },
  };
}

function buildCard(payload: AlertPayload): AdaptiveCard {
  const body: unknown[] = [
    {
      type: 'TextBlock',
      text: payload.title,
      weight: 'Bolder',
      size: 'Large',
      color:
        payload.statusColor === 'green'
          ? 'Good'
          : payload.statusColor === 'orange'
            ? 'Warning'
            : 'Attention',
    },
    { type: 'TextBlock', text: payload.summary, wrap: true, size: 'Medium' },
    { type: 'FactSet', facts: payload.facts },
  ];

  if (payload.analysis) {
    body.push(
      { type: 'TextBlock', text: '🤖 AI Analysis', weight: 'Bolder', spacing: 'Medium' },
      { type: 'TextBlock', text: payload.analysis.summary, wrap: true }
    );
  }

  if (payload.actions.length) {
    body.push({ type: 'ActionSet', actions: payload.actions });
  }

  return { type: 'AdaptiveCard', version: '1.5', msteams: { width: 'Full' }, body };
}
