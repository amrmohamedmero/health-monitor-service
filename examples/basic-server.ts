/**
 * Standalone deployment example. Run with `npm run dev` (uses this file
 * indirectly via src/server.ts) or directly:
 *   tsx examples/basic-server.ts
 *
 * This registers only the generic, dependency-free built-in checks. Swap in
 * your own checks (DB ping, storage bucket, upstream API — see
 * examples/octopulse-integration.ts) for anything project-specific.
 */
import 'dotenv/config';
import {
  HealthCheckRegistry,
  createServer,
  cpuCheck,
  memoryCheck,
  diskCheck,
  httpPingCheck,
  loadConfigFromEnv,
  runDailyReport,
  runCriticalCheck,
  AlertCooldown,
} from '../src/index';

const config = loadConfigFromEnv();

const registry = new HealthCheckRegistry()
  .register('cpu', cpuCheck())
  .register('memory', memoryCheck())
  .register('disk', diskCheck('/'))
  .register('self', httpPingCheck('Self', `http://localhost:${process.env.PORT || 8080}/healthz`));

// `npm run report:once` / `npm run check:once` — run a single pass without
// starting the HTTP server, useful for local testing (see package.json).
const mode = process.argv.includes('--report')
  ? 'report'
  : process.argv.includes('--check')
    ? 'check'
    : 'serve';

if (mode === 'report') {
  runDailyReport(registry, config).then(() => process.exit(0));
} else if (mode === 'check') {
  runCriticalCheck(registry, config, new AlertCooldown()).then(() => process.exit(0));
} else {
  const port = Number(process.env.PORT) || 8080;
  createServer(registry, config).listen(port, () => {
    console.log(`🚀 health-monitor-service listening on :${port}`);
  });
}
