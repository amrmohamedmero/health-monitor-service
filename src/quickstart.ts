import { HealthCheckRegistry } from './registry';
import { AlertCooldown } from './cooldown';
import { HistoryStore } from './history';
import { SnoozeStore } from './snooze';
import { runDailyReport, runCriticalCheck } from './runner';
import { cpuCheck, memoryCheck, diskCheck } from './checks';
import { teamsChannel, slackChannel, discordChannel, powerAutomateChannel } from './channels';
import { anthropicAnalysisProvider } from './analysis';
import type { HealthCheck, MonitorConfig } from './types';
import type { NotificationChannel } from './channels/types';

/**
 * Flat, fill-in-the-blanks config for startHealthMonitor(). No need to know
 * about HealthCheckRegistry/AlertCooldown/channels/etc — just paste in
 * whichever webhook URLs and (optionally) an AI key you have.
 */
export interface QuickStartOptions {
  serviceName: string;
  dashboardUrl?: string;

  // Fill in whichever destinations you use — any combination is fine.
  teamsWebhookUrl?: string;
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
  powerAutomateWebhookUrl?: string;

  // Optional: attach a short AI root-cause note to alerts.
  aiApiKey?: string;
  aiModel?: string;

  timezone?: string;
  /** Defaults to true — set false to dry-run without sending anything. */
  isProduction?: boolean;

  /** Extra checks beyond the built-in cpu/memory/disk (e.g. a DB ping). */
  checks?: Record<string, HealthCheck>;
  /** Set false to skip the built-in cpu/memory/disk checks entirely. */
  includeDefaultChecks?: boolean;

  /** How often to run the critical/alert pass, in minutes. Default 15. */
  criticalIntervalMinutes?: number;
  /** Set false to skip the once-a-day summary report. Default true. */
  dailyReport?: boolean;
}

export interface HealthMonitorHandle {
  registry: HealthCheckRegistry;
  config: MonitorConfig;
  /** Stops the internal timers. Call this on app shutdown. */
  stop(): void;
}

/**
 * The one-call integration path: builds the registry, channels, and AI
 * analysis provider from flat options, then runs the alert loop on internal
 * timers for as long as your process is alive — no cron endpoint, no
 * external scheduler, no manual registry wiring required.
 *
 * For serverless functions (no long-lived process) use createServer() or
 * call runDailyReport/runCriticalCheck yourself from your own cron route
 * instead — see the README's "Option 1/2" sections.
 */
export function startHealthMonitor(opts: QuickStartOptions): HealthMonitorHandle {
  const channels: NotificationChannel[] = [];
  if (opts.teamsWebhookUrl) channels.push(teamsChannel(opts.teamsWebhookUrl));
  if (opts.slackWebhookUrl) channels.push(slackChannel(opts.slackWebhookUrl));
  if (opts.discordWebhookUrl) channels.push(discordChannel(opts.discordWebhookUrl));
  if (opts.powerAutomateWebhookUrl) channels.push(powerAutomateChannel(opts.powerAutomateWebhookUrl));

  if (channels.length === 0) {
    console.warn(
      '⚠️  startHealthMonitor: no webhook URL provided (teams/slack/discord/powerAutomate) — checks will run but nothing will be sent anywhere.'
    );
  }

  const config: MonitorConfig = {
    serviceName: opts.serviceName,
    dashboardUrl: opts.dashboardUrl,
    timezone: opts.timezone ?? 'UTC',
    isProduction: opts.isProduction ?? true,
    channels,
    analysis: opts.aiApiKey
      ? anthropicAnalysisProvider({ apiKey: opts.aiApiKey, model: opts.aiModel })
      : undefined,
  };

  const registry = new HealthCheckRegistry();
  if (opts.includeDefaultChecks !== false) {
    registry.register('cpu', cpuCheck()).register('memory', memoryCheck()).register('disk', diskCheck());
  }
  for (const [name, check] of Object.entries(opts.checks ?? {})) {
    registry.register(name, check);
  }

  const cooldown = new AlertCooldown();
  const history = new HistoryStore();
  const snooze = new SnoozeStore();

  const runCritical = () =>
    runCriticalCheck(registry, config, cooldown, { history, snooze }).catch(error =>
      console.error('❌ health-monitor critical check failed:', error)
    );

  // Fire once immediately so a failure present at startup is caught right
  // away, instead of waiting for the first interval to elapse.
  void runCritical();

  const criticalMs = (opts.criticalIntervalMinutes ?? 15) * 60 * 1000;
  const criticalTimer = setInterval(runCritical, criticalMs);

  let dailyTimer: ReturnType<typeof setInterval> | undefined;
  if (opts.dailyReport !== false) {
    const dailyMs = 24 * 60 * 60 * 1000;
    dailyTimer = setInterval(() => {
      runDailyReport(registry, config, history).catch(error =>
        console.error('❌ health-monitor daily report failed:', error)
      );
    }, dailyMs);
  }

  return {
    registry,
    config,
    stop() {
      clearInterval(criticalTimer);
      if (dailyTimer) clearInterval(dailyTimer);
    },
  };
}
