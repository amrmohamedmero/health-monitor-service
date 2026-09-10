import type { CheckResult, MonitorConfig } from './types';
import type { HealthCheckRegistry } from './registry';
import type { AlertCooldown } from './cooldown';
import { buildAlertReport, buildDailyReport, sendNotification } from './notify';

async function runAllChecks(registry: HealthCheckRegistry): Promise<CheckResult[]> {
  const checks = registry.list();
  const settled = await Promise.allSettled(checks.map(check => check()));

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    // A check that threw is itself a critical finding, not a silent gap.
    return {
      name: `check-${i}`,
      status: 'critical' as const,
      message: 'Check threw an error',
      details: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

/**
 * Runs every registered check, sends one summary card, then sends
 * individual alerts for anything critical/warning (no cooldown here — this
 * is the once-a-day report, so duplicates aren't a concern).
 */
export async function runDailyReport(
  registry: HealthCheckRegistry,
  config: MonitorConfig
): Promise<{ sent: boolean; results: CheckResult[] }> {
  if (!config.isProduction) {
    console.log('⏭️  Skipping daily report — isProduction is false.');
    return { sent: false, results: [] };
  }

  console.log(`📊 Running daily health report for ${config.serviceName}...`);
  const results = await runAllChecks(registry);

  const report = buildDailyReport(results, config);
  const sent = await sendNotification(report, config);
  console.log(sent ? `✅ Report sent (${report.overallStatus})` : '❌ Failed to send report');

  for (const r of results.filter(r => r.status !== 'ok')) {
    const alertReport = buildAlertReport(
      { title: r.name, message: r.message, checkName: r.name, details: r.details },
      r.status === 'critical' ? 'critical' : 'warning',
      config
    );
    await sendNotification(alertReport, config);
  }

  return { sent, results };
}

/**
 * Runs every registered check and sends alerts only for non-ok results,
 * gated by the cooldown so a flapping check doesn't spam Teams. Intended to
 * be triggered every 15-30 minutes by an external scheduler.
 */
export async function runCriticalCheck(
  registry: HealthCheckRegistry,
  config: MonitorConfig,
  cooldown: AlertCooldown
): Promise<{ results: CheckResult[]; alertsSent: number }> {
  if (!config.isProduction) {
    console.log('⏭️  Skipping critical check — isProduction is false.');
    return { results: [], alertsSent: 0 };
  }

  console.log(`🔍 Running critical checks for ${config.serviceName}...`);
  const results = await runAllChecks(registry);
  let alertsSent = 0;

  for (const r of results.filter(r => r.status !== 'ok')) {
    const key = r.status === 'critical' ? r.name : `warning:${r.name}`;
    if (!cooldown.shouldSend(key)) continue;

    console.log(`${r.status === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING'}: ${r.name} — ${r.message}`);
    const report = buildAlertReport(
      { title: r.name, message: r.message, checkName: r.name, details: r.details },
      r.status === 'critical' ? 'critical' : 'warning',
      config
    );
    const sent = await sendNotification(report, config);
    if (sent) {
      cooldown.record(key);
      alertsSent++;
    }
  }

  if (alertsSent === 0) {
    console.log('✅ All checks healthy (or within cooldown) — nothing sent');
  }

  return { results, alertsSent };
}
