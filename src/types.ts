/**
 * A single check's result. `status` drives both the emoji/color in the
 * Teams card and whether it can trigger a critical/warning alert.
 */
export type CheckStatus = 'ok' | 'warning' | 'critical';

export interface CheckResult {
  /** Stable identifier used as the alert-cooldown/escalation/snooze key —
   *  keep it constant across runs for the same logical check (don't put
   *  timestamps in it). */
  name: string;
  status: CheckStatus;
  /** Short human-readable summary, e.g. "42ms" or "89% (17.8/20 GB)". */
  message: string;
  /** Optional numeric measurement (percent, ms, etc) backing `message` —
   *  set this so HistoryStore can compute a trend for the check. */
  value?: number;
  latencyMs?: number;
  details?: string;
}

export type HealthCheck = () => Promise<CheckResult>;

export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface MonitorConfig {
  serviceName: string;
  dashboardUrl?: string;
  /** Back-compat single-destination fields. If `channels` is also set,
   *  these are ignored — `channels` always wins. */
  teamsWebhookUrl?: string;
  powerAutomateWebhookUrl?: string;
  cronSecret?: string;
  timezone: string;
  /** Only send real reports/alerts when true — lets you run the same code
   *  in staging without spamming Teams. */
  isProduction: boolean;
  /** Explicit list of notification destinations — send fans out to every
   *  one of them. Build with teamsChannel()/slackChannel()/discordChannel()/
   *  powerAutomateChannel(), or your own NotificationChannel. */
  channels?: import('./channels/types').NotificationChannel[];
  /** Optional AI analysis hook — off by default, see analysis.ts. Only
   *  invoked when a run has at least one non-ok result. */
  analysis?: import('./analysis').AnalysisProvider;
}
