import type { CheckResult, MonitorConfig } from './types';
import type { HealthCheckRegistry } from './registry';
import type { AlertCooldown } from './cooldown';
import type { AnalysisResult } from './analysis';
import { HistoryStore } from './history';
import { SnoozeStore } from './snooze';
import { buildDailyReport, buildIncidentReport, sendNotification } from './notify';

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

/** Calls config.analysis, if set, only when there's something non-ok to
 *  explain. Never throws — a broken/slow provider just means no analysis
 *  block gets attached, the alert still goes out. */
async function tryAnalyze(
  results: CheckResult[],
  config: MonitorConfig
): Promise<AnalysisResult | undefined> {
  if (!config.analysis) return undefined;
  if (!results.some(r => r.status !== 'ok')) return undefined;

  try {
    return await config.analysis.analyze(results, { serviceName: config.serviceName });
  } catch (error) {
    console.error('⚠️  AI analysis provider failed — continuing without it:', error);
    return undefined;
  }
}

/**
 * Runs every registered check, sends one summary card, then (if anything is
 * non-ok) one combined incident message for all of it — no cooldown here,
 * this is the once-a-day report, so duplicates aren't a concern.
 */
export async function runDailyReport(
  registry: HealthCheckRegistry,
  config: MonitorConfig,
  history: HistoryStore = new HistoryStore()
): Promise<{ sent: boolean; results: CheckResult[] }> {
  if (!config.isProduction) {
    console.log('⏭️  Skipping daily report — isProduction is false.');
    return { sent: false, results: [] };
  }

  console.log(`📊 Running daily health report for ${config.serviceName}...`);
  const results = await runAllChecks(registry);
  history.record(results);

  const analysis = await tryAnalyze(results, config);

  const report = buildDailyReport(results, config, analysis);
  const sent = await sendNotification(report, config);
  console.log(sent ? `✅ Report sent (${report.overallStatus})` : '❌ Failed to send report');

  const nonOk = results.filter(r => r.status !== 'ok');
  if (nonOk.length > 0) {
    const escalation = new Map(nonOk.map(r => [r.name, history.consecutiveNonOk(r.name)]));
    const incident = buildIncidentReport(nonOk, escalation, config, analysis);
    await sendNotification(incident, config);
  }

  return { sent, results };
}

/**
 * Runs every registered check and sends one combined message for anything
 * non-ok and not snoozed, gated per-check by the cooldown so a flapping
 * check doesn't spam the channel. Intended to be triggered every 15-30
 * minutes by an external scheduler.
 */
export async function runCriticalCheck(
  registry: HealthCheckRegistry,
  config: MonitorConfig,
  cooldown: AlertCooldown,
  opts: { history?: HistoryStore; snooze?: SnoozeStore } = {}
): Promise<{ results: CheckResult[]; alertsSent: number; snoozed: string[] }> {
  if (!config.isProduction) {
    console.log('⏭️  Skipping critical check — isProduction is false.');
    return { results: [], alertsSent: 0, snoozed: [] };
  }

  const history = opts.history ?? new HistoryStore();
  const snooze = opts.snooze ?? new SnoozeStore();

  console.log(`🔍 Running critical checks for ${config.serviceName}...`);
  const results = await runAllChecks(registry);
  history.record(results);

  const nonOk = results.filter(r => r.status !== 'ok');
  const snoozed = nonOk.filter(r => snooze.isActive(r.name)).map(r => r.name);
  const active = nonOk.filter(r => !snooze.isActive(r.name));

  const toAlert = active.filter(r => {
    const key = r.status === 'critical' ? r.name : `warning:${r.name}`;
    return cooldown.shouldSend(key);
  });

  let alertsSent = 0;
  if (toAlert.length > 0) {
    for (const r of toAlert) {
      console.log(`${r.status === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING'}: ${r.name} — ${r.message}`);
    }

    const analysis = await tryAnalyze(toAlert, config);
    const escalation = new Map(toAlert.map(r => [r.name, history.consecutiveNonOk(r.name)]));
    const incident = buildIncidentReport(toAlert, escalation, config, analysis);
    const sent = await sendNotification(incident, config);

    if (sent) {
      for (const r of toAlert) {
        const key = r.status === 'critical' ? r.name : `warning:${r.name}`;
        cooldown.record(key);
      }
      alertsSent = 1;
    } else {
      console.error(`❌ ${toAlert.length} check(s) non-ok but failed to send the alert — see channel errors above`);
    }
  } else if (snoozed.length > 0) {
    console.log(`🔕 ${snoozed.length} check(s) snoozed, nothing else to alert`);
  } else {
    console.log('✅ All checks healthy (or within cooldown) — nothing sent');
  }

  return { results, alertsSent, snoozed };
}
