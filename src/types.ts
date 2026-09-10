/**
 * A single check's result. `status` drives both the emoji/color in the
 * Teams card and whether it can trigger a critical/warning alert.
 */
export type CheckStatus = 'ok' | 'warning' | 'critical';

export interface CheckResult {
  /** Stable identifier used as the alert-cooldown key — keep it constant
   *  across runs for the same logical check (don't put timestamps in it). */
  name: string;
  status: CheckStatus;
  /** Short human-readable summary, e.g. "42ms" or "89% (17.8/20 GB)". */
  message: string;
  latencyMs?: number;
  details?: string;
}

export type HealthCheck = () => Promise<CheckResult>;

export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface MonitorConfig {
  serviceName: string;
  dashboardUrl?: string;
  teamsWebhookUrl?: string;
  powerAutomateWebhookUrl?: string;
  cronSecret?: string;
  timezone: string;
  /** Only send real reports/alerts when true — lets you run the same code
   *  in staging without spamming Teams. */
  isProduction: boolean;
}
