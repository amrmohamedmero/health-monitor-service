import type { CheckResult, MonitorConfig, OverallStatus } from './types';

// ============================================
// Teams / Power Automate payload types
// ============================================

interface Fact {
  title: string;
  value: string;
}

interface Action {
  type: 'Action.OpenUrl';
  title: string;
  url: string;
}

interface AdaptiveCard {
  type: 'AdaptiveCard';
  version: '1.5';
  msteams?: { width?: 'Full' };
  body: unknown[];
}

interface PowerAutomatePayload {
  service: string;
  reportType: 'daily' | 'critical' | 'warning';
  timestamp: string;
  overallStatus: OverallStatus;
  statusColor: 'green' | 'orange' | 'red';
  title: string;
  summary: string;
  facts: Fact[];
  actions: Action[];
}

export interface Alert {
  title: string;
  message: string;
  checkName: string;
  details?: string;
}

// ============================================
// Send
// ============================================

/**
 * Send to whichever endpoint is configured. Power Automate wins if both
 * are set (matches the original Octopulse behavior).
 */
export async function sendNotification(
  payload: PowerAutomatePayload,
  config: MonitorConfig
): Promise<boolean> {
  if (config.powerAutomateWebhookUrl) {
    return sendToPowerAutomate(payload, config.powerAutomateWebhookUrl);
  }
  if (config.teamsWebhookUrl) {
    return sendToTeams(buildAdaptiveCard(payload), config.teamsWebhookUrl);
  }
  console.error(
    '❌ No notification endpoint configured (teamsWebhookUrl or powerAutomateWebhookUrl)'
  );
  return false;
}

async function sendToTeams(
  card: AdaptiveCard,
  webhookUrl: string
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [
          { contentType: 'application/vnd.microsoft.card.adaptive', content: card },
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
}

async function sendToPowerAutomate(
  payload: PowerAutomatePayload,
  url: string
): Promise<boolean> {
  try {
    const response = await fetch(url, {
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

export function buildDailyReport(
  results: CheckResult[],
  config: MonitorConfig
): PowerAutomatePayload {
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
  };
}

export function buildAlertReport(
  alert: Alert,
  severity: 'critical' | 'warning',
  config: MonitorConfig
): PowerAutomatePayload {
  const isCritical = severity === 'critical';
  return {
    service: config.serviceName,
    reportType: severity,
    timestamp: new Date().toISOString(),
    overallStatus: isCritical ? 'unhealthy' : 'degraded',
    statusColor: isCritical ? 'red' : 'orange',
    title: `${isCritical ? '🚨 CRITICAL ALERT' : '⚠️ WARNING'} — ${config.serviceName}`,
    summary: alert.message,
    facts: [
      { title: 'Alert', value: alert.title },
      { title: 'Check', value: alert.checkName },
      { title: 'Severity', value: isCritical ? '🔴 Critical' : '🟡 Warning' },
      {
        title: `Time (${config.timezone})`,
        value: new Date().toLocaleString('en-US', { timeZone: config.timezone }),
      },
      ...(alert.details ? [{ title: 'Details', value: alert.details }] : []),
    ],
    actions: dashboardActions(config),
  };
}

function buildAdaptiveCard(payload: PowerAutomatePayload): AdaptiveCard {
  return {
    type: 'AdaptiveCard',
    version: '1.5',
    msteams: { width: 'Full' },
    body: [
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
      ...(payload.actions.length
        ? [{ type: 'ActionSet', actions: payload.actions }]
        : []),
    ],
  };
}
