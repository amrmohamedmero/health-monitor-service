import { createHash, timingSafeEqual } from 'crypto';
import type { MonitorConfig } from './types';
import type { NotificationChannel } from './channels/types';
import { teamsChannel, powerAutomateChannel, slackChannel, discordChannel } from './channels';
import { anthropicAnalysisProvider } from './analysis';

/**
 * Build config from environment variables. Call this once at startup for
 * the standalone server; if you're importing this package as a library
 * inside another app, build a MonitorConfig object yourself instead (see
 * examples/octopulse-integration.ts) so it shares that app's env handling.
 *
 * Any combination of *_WEBHOOK_URL vars can be set at once — every one that
 * is present becomes a channel, so a single run can alert Teams AND Slack
 * AND Discord. Set ANTHROPIC_API_KEY to also attach an AI root-cause
 * analysis to alerts (see analysis.ts) — omit it to opt out entirely.
 */
export function loadConfigFromEnv(): MonitorConfig {
  const channels: NotificationChannel[] = [];
  if (process.env.TEAMS_WEBHOOK_URL) channels.push(teamsChannel(process.env.TEAMS_WEBHOOK_URL));
  if (process.env.POWER_AUTOMATE_WEBHOOK_URL) {
    channels.push(powerAutomateChannel(process.env.POWER_AUTOMATE_WEBHOOK_URL));
  }
  if (process.env.SLACK_WEBHOOK_URL) channels.push(slackChannel(process.env.SLACK_WEBHOOK_URL));
  if (process.env.DISCORD_WEBHOOK_URL) channels.push(discordChannel(process.env.DISCORD_WEBHOOK_URL));

  return {
    serviceName: process.env.SERVICE_NAME || 'health-monitor-service',
    dashboardUrl: process.env.DASHBOARD_URL,
    teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL,
    powerAutomateWebhookUrl: process.env.POWER_AUTOMATE_WEBHOOK_URL,
    cronSecret: process.env.CRON_SECRET,
    timezone: process.env.TIMEZONE || 'UTC',
    isProduction: process.env.NODE_ENV === 'production',
    channels: channels.length ? channels : undefined,
    analysis: process.env.ANTHROPIC_API_KEY
      ? anthropicAnalysisProvider({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: process.env.ANALYSIS_MODEL,
        })
      : undefined,
  };
}

/**
 * Validates `Authorization: Bearer <cronSecret>`. Fails closed: if no
 * secret is configured, every request is rejected.
 */
export function isAuthorizedCronRequest(
  request: Request,
  config: MonitorConfig
): boolean {
  const secret = config.cronSecret;
  if (!secret) {
    console.error(
      '❌ cronSecret is not configured — rejecting cron request.'
    );
    return false;
  }

  const authHeader = request.headers.get('authorization') || '';
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';
  if (!provided) return false;

  // Constant-time comparison of fixed-length hashes so it never throws on a
  // length mismatch and doesn't leak timing info about the secret.
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(secret).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
