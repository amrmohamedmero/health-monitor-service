import { createHash, timingSafeEqual } from 'crypto';
import type { MonitorConfig } from './types';

/**
 * Build config from environment variables. Call this once at startup for
 * the standalone server; if you're importing this package as a library
 * inside another app, build a MonitorConfig object yourself instead (see
 * examples/octopulse-integration.ts) so it shares that app's env handling.
 */
export function loadConfigFromEnv(): MonitorConfig {
  return {
    serviceName: process.env.SERVICE_NAME || 'health-monitor-service',
    dashboardUrl: process.env.DASHBOARD_URL,
    teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL,
    powerAutomateWebhookUrl: process.env.POWER_AUTOMATE_WEBHOOK_URL,
    cronSecret: process.env.CRON_SECRET,
    timezone: process.env.TIMEZONE || 'UTC',
    isProduction: process.env.NODE_ENV === 'production',
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
