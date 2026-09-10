import type { CheckResult, MonitorConfig, OverallStatus } from './types';
import type { AlertPayload, Action, Fact, NotificationChannel } from './channels/types';
import type { AnalysisResult } from './analysis';
import { teamsChannel, powerAutomateChannel } from './channels';

export type { AlertPayload };

// ============================================
// Send — fans out to every configured channel
// ============================================

/**
 * Sends to every channel in config.channels. If that's unset, falls back to
 * config.teamsWebhookUrl / config.powerAutomateWebhookUrl for backward
 * compatibility (both, if both are set — unlike the old single-URL
 * behavior). Returns true if at least one channel accepted the message.
 */
export async function sendNotification(payload: AlertPayload, config: MonitorConfig): Promise<boolean> {
  const channels = resolveChannels(config);
  if (channels.length === 0) {
    console.error(
      '❌ No notification channel configured (set config.channels, or teamsWebhookUrl/powerAutomateWebhookUrl)'
    );
    return false;
  }

  const outcomes = await Promise.all(
    channels.map(async channel => {
      try {
        return await channel.send(payload);
      } catch (error) {
        console.error(`❌ Channel "${channel.name}" threw:`, error);
        return false;
      }
    })
  );

  return outcomes.some(Boolean);
}

function resolveChannels(config: MonitorConfig): NotificationChannel[] {
  if (config.channels?.length) return config.channels;

  const fallback: NotificationChannel[] = [];
  if (config.powerAutomateWebhookUrl) fallback.push(powerAutomateChannel(config.powerAutomateWebhookUrl));
  if (config.teamsWebhookUrl) fallback.push(teamsChannel(config.teamsWebhookUrl));
  return fallback;
}

// ============================================
// Payload builders
// ============================================

export function computeOverallStatus(results: CheckResult[]): OverallStatus {
  if (results.some(r => r.status === 'critical')) return 'unhealthy';
  if (results.some(r => r.status === 'warning')) return 'degraded';
  return 'healthy';
}

function statusColor(status: OverallStatus): 'green' | 'orange' | 'red' {
  return status === 'healthy' ? 'green' : status === 'degraded' ? 'orange' : 'red';
}

function statusEmoji(status: OverallStatus): string {
  return status === 'healthy' ? '🟢' : status === 'degraded' ? '🟠' : '🔴';
}

function checkEmoji(status: CheckResult['status']): string {
  return status === 'ok' ? '✅' : status === 'warning' ? '⚠️' : '🔴';
}

function dashboardActions(config: MonitorConfig): Action[] {
  return config.dashboardUrl
    ? [{ type: 'Action.OpenUrl', title: '📈 View Dashboard', url: config.dashboardUrl }]
    : [];
}

/** Once-a-day summary covering every registered check. */
export function buildDailyReport(
  results: CheckResult[],
  config: MonitorConfig,
  analysis?: AnalysisResult
): AlertPayload {
  const overall = computeOverallStatus(results);
  const facts: Fact[] = [
    { title: 'Overall Status', value: `${statusEmoji(overall)} ${overall.toUpperCase()}` },
    ...results.map(r => ({
      title: r.name,
      value: `${checkEmoji(r.status)} ${r.message}${r.details ? ` | ${r.details}` : ''}`,
    })),
  ];

  const summary =
    overall === 'healthy'
      ? '✅ All systems operational'
      : overall === 'degraded'
        ? `⚠️ ${results.filter(r => r.status === 'warning').length} check(s) degraded`
        : `🔴 ${results.filter(r => r.status === 'critical').length} check(s) critical`;

  return {
    service: config.serviceName,
    reportType: 'daily',
    timestamp: new Date().toISOString(),
    overallStatus: overall,
    statusColor: statusColor(overall),
    title: `📊 ${config.serviceName} — Daily Health Report`,
    summary,
    facts,
    actions: dashboardActions(config),
    analysis,
  };
}

/**
 * A single message covering every non-ok check from one run — replaces the
 * old "one message per check" behavior so 3 simultaneous failures produce
 * one incident, not 3 separate pings. `escalation` maps check name -> how
 * many consecutive runs it's been non-ok, used to label repeat offenders.
 */
export function buildIncidentReport(
  activeResults: CheckResult[],
  escalation: Map<string, number>,
  config: MonitorConfig,
  analysis?: AnalysisResult
): AlertPayload {
  const overall = computeOverallStatus(activeResults);
  const criticalCount = activeResults.filter(r => r.status === 'critical').length;
  const warningCount = activeResults.filter(r => r.status === 'warning').length;

  const facts: Fact[] = activeResults.map(r => {
    const streak = escalation.get(r.name) ?? 0;
    const streakLabel = streak > 1 ? ` (${streak}x in a row)` : '';
    return {
      title: r.name,
      value: `${checkEmoji(r.status)} ${r.message}${streakLabel}${r.details ? ` | ${r.details}` : ''}`,
    };
  });

  const summary =
    [
      criticalCount ? `🔴 ${criticalCount} critical` : '',
      warningCount ? `🟠 ${warningCount} warning` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'One or more checks degraded';

  return {
    service: config.serviceName,
    reportType: criticalCount > 0 ? 'critical' : 'warning',
    timestamp: new Date().toISOString(),
    overallStatus: overall,
    statusColor: statusColor(overall),
    title: `${criticalCount > 0 ? '🚨 CRITICAL ALERT' : '⚠️ WARNING'} — ${config.serviceName}`,
    summary,
    facts,
    actions: dashboardActions(config),
    analysis,
  };
}
