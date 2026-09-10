import http from 'http';
import { isAuthorizedCronRequest, loadConfigFromEnv } from './config';
import { AlertCooldown } from './cooldown';
import type { HealthCheckRegistry } from './registry';
import { runCriticalCheck, runDailyReport } from './runner';
import type { MonitorConfig } from './types';

/**
 * Minimal dependency-free HTTP server exposing:
 *   GET /              - liveness probe, no auth
 *   GET /health-report  - runs every check, sends the daily summary card
 *   GET /critical-check  - runs every check, sends alerts for anything non-ok
 * Both cron endpoints require `Authorization: Bearer <cronSecret>`.
 */
export function createServer(
  registry: HealthCheckRegistry,
  config: MonitorConfig = loadConfigFromEnv()
): http.Server {
  const cooldown = new AlertCooldown();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: config.serviceName }));
      return;
    }

    if (url.pathname === '/health-report' || url.pathname === '/critical-check') {
      const authorized = isAuthorizedCronRequest(
        new Request(url, { headers: { authorization: req.headers.authorization || '' } }),
        config
      );
      if (!authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      try {
        if (url.pathname === '/health-report') {
          const { sent, results } = await runDailyReport(registry, config);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sent, checks: results.length }));
        } else {
          const { alertsSent, results } = await runCriticalCheck(registry, config, cooldown);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, alertsSent, checks: results.length }));
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
