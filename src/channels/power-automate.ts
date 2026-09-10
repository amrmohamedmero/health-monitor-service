import type { NotificationChannel } from './types';

/** Power Automate HTTP-trigger flow — receives the raw AlertPayload as JSON,
 *  so the flow's own "Parse JSON" + condition/actions build the message. */
export function powerAutomateChannel(webhookUrl: string): NotificationChannel {
  return {
    name: 'power-automate',
    async send(payload) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          console.error(`❌ Power Automate failed: ${response.status} ${response.statusText}`);
          return false;
        }
        return true;
      } catch (error) {
        console.error('❌ Error sending to Power Automate:', error);
        return false;
      }
    },
  };
}
