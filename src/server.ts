import http from 'http';
import { isAuthorizedCronRequest, loadConfigFromEnv } from './config';
import { AlertCooldown } from './cooldown';
import { HistoryStore } from './history';
import { SnoozeStore } from './snooze';
import type { HealthCheckRegistry } from './registry';
import { runCriticalCheck, runDailyReport } from './runner';
import type { MonitorConfig } from './types';

/**
 * Minimal dependency-free HTTP server exposing:
 *   GET  /              - liveness probe, no auth (includes lastSuccessfulRun
 *                          as a cheap dead-man's-switch: if this goes stale,
 *                          the scheduler calling this service has stopped)
 *   GET  /health-report   - runs every check, sends the daily summary card
 *   GET  /critical-check  - runs every check, sends one combined alert for
 *                           anything non-ok and not snoozed/on cooldown
 *   POST /snooze          - suppress alerting for a check (or "all") for N
 *                           minutes, e.g. during a planned deploy
 * All but the liveness probe require `Authorization: Bearer <cronSecret>`.
 */
export function createServer(
  registry: HealthCheckRegistry,
  config: MonitorConfig = loadConfigFromEnv()
): http.Server {
  const cooldown = new AlertCooldown();
  const history = new HistoryStore();
  const snooze = new SnoozeStore();
  let lastSuccessfulRun: string | undefined;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const isAuthorized = () =>
      isAuthorizedCronRequest(
        new Request(url, { headers: { authorization: req.headers.authorization || '' } }),
        config
      );

    if (url.pathname === '/' || url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: config.serviceName,
          lastSuccessfulRun: lastSuccessfulRun ?? null,
        })
      );
      return;
    }

    if (url.pathname === '/snooze' && req.method === 'POST') {
      if (!isAuthorized()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      let rawBody = '';
      for await (const chunk of req) rawBody += chunk;

      try {
        const { check, minutes } = JSON.parse(rawBody || '{}') as { check?: string; minutes?: number };
        const snoozeMinutes = minutes ?? 60;
        const key = check ?? 'all';
        snooze.snooze(key, snoozeMinutes * 60 * 1000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, snoozed: key, minutes: snoozeMinutes }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body — expected {"check"?: string, "minutes"?: number}' }));
      }
      return;
    }

    if (url.pathname === '/health-report' || url.pathname === '/critical-check') {
      if (!isAuthorized()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      try {
        if (url.pathname === '/health-report') {
          const { sent, results } = await runDailyReport(registry, config, history);
          lastSuccessfulRun = new Date().toISOString();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sent, checks: results.length }));
        } else {
          const { alertsSent, results, snoozed } = await runCriticalCheck(registry, config, cooldown, {
            history,
            snooze,
          });
          lastSuccessfulRun = new Date().toISOString();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, alertsSent, checks: results.length, snoozed }));
        }
      } catch (error) {
        console.error('❌ Error running check:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        );
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}
