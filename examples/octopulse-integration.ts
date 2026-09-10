/**
 * Example: using this package as a LIBRARY inside an existing app (e.g.
 * Octopulse) instead of running it as a separate deployed service. Copy
 * this pattern into that app's own cron route — no need to run this file.
 *
 * Requires: `npm install health-monitor-service` (see README "Use as a
 * library" section for how to get it into another project's
 * node_modules without publishing to npm).
 */
import {
  HealthCheckRegistry,
  runDailyReport,
  runCriticalCheck,
  AlertCooldown,
  teamsChannel,
  slackChannel,
  anthropicAnalysisProvider,
  cpuCheck,
  memoryCheck,
  type MonitorConfig,
  type HealthCheck,
} from '@monitor/health-service';

// Build config from the HOST APP's own env handling — don't assume this
// package's .env conventions match the app you're embedding it in.
const config: MonitorConfig = {
  serviceName: 'Octopulse',
  dashboardUrl: 'https://app.octopulse.co/admin/monitoring',
  // Fan out to every destination you configure — not limited to one.
  channels: [
    ...(process.env.TEAMS_WEBHOOK_URL ? [teamsChannel(process.env.TEAMS_WEBHOOK_URL)] : []),
    ...(process.env.SLACK_WEBHOOK_URL ? [slackChannel(process.env.SLACK_WEBHOOK_URL)] : []),
  ],
  // Optional: attach a short AI root-cause note to alerts. Omit
  // ANTHROPIC_API_KEY to leave this off entirely.
  analysis: process.env.ANTHROPIC_API_KEY
    ? anthropicAnalysisProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
    : undefined,
  cronSecret: process.env.CRON_SECRET,
  timezone: 'Asia/Dubai',
  isProduction:
    process.env.NODE_ENV === 'production' ||
    process.env.NEXTAUTH_URL?.includes('app.octopulse.co') === true,
};

// A project-specific check, e.g. wrapping Prisma — this is the kind of
// thing that stays in the HOST app rather than living in this package,
// since it depends on that app's DB client and schema.
function databaseCheck(): HealthCheck {
  return async () => {
    const start = Date.now();
    try {
      // await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;
      return {
        name: 'Database',
        status: latencyMs > 1000 ? 'warning' : 'ok',
        message: `${latencyMs}ms`,
      };
    } catch (error) {
      return {
        name: 'Database',
        status: 'critical',
        message: 'Unreachable',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

const registry = new HealthCheckRegistry()
  .register('database', databaseCheck())
  .register('cpu', cpuCheck())
  .register('memory', memoryCheck());

const cooldown = new AlertCooldown();

// Call these from your own Next.js route handlers, e.g.:
//   src/app/api/cron/health-report/route.ts -> runDailyReport(registry, config)
//   src/app/api/cron/critical-check/route.ts -> runCriticalCheck(registry, config, cooldown)
export const dailyReport = () => runDailyReport(registry, config);
export const criticalCheck = () => runCriticalCheck(registry, config, cooldown);
