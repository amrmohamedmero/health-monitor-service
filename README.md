# health-monitor-service

A small, dependency-free health-check + Teams/Power Automate alerting
engine, extracted and generalized from Octopulse's monitoring system
(`~/project/octopulse`). Register whatever checks matter to your app, and it
handles: aggregating overall status, formatting/sending Teams cards, cron
auth, and alert-spam cooldown.

It can be used two ways:

1. **Standalone microservice** — deploy it on its own, point external
   schedulers (cron-job.org, Railway cron, GitHub Actions) at its two HTTP
   endpoints.
2. **Library inside another app** — import the functions directly and call
   them from that app's own cron routes (this is how Octopulse itself could
   eventually consume it, without running a second deployment).

---

## How it works

```
HealthCheckRegistry          — you register named checks (async functions
                                that return { status, message, ... })
        │
        ▼
runDailyReport() / runCriticalCheck()
        │            (src/runner.ts)
        ▼
notify.ts  — builds a Teams Adaptive Card / Power Automate payload,
             sends it via TEAMS_WEBHOOK_URL or POWER_AUTOMATE_WEBHOOK_URL
        │
        ▼
AlertCooldown  — for runCriticalCheck only: suppresses repeat alerts for
                  the same check within a time window (30 min default, max
                  3 per window) so a flapping check doesn't spam the
                  channel
```

A `CheckResult` looks like:

```ts
{ name: 'Database', status: 'ok' | 'warning' | 'critical', message: '12ms', details?: '...' }
```

Overall status is derived from the worst individual result: any `critical`
→ `unhealthy`; any `warning` (and no critical) → `degraded`; otherwise
`healthy`.

**Built-in checks** (`src/checks/`): `cpuCheck()`, `memoryCheck()`,
`diskCheck(path)`, `httpPingCheck(name, url)`. These are generic — they
don't know anything about your app. For anything project-specific (a
database, a storage bucket, a queue), write your own `HealthCheck` function
— see `examples/octopulse-integration.ts` for a template.

---

## Option 1: Run as a standalone microservice

```bash
cd health-monitor-service
npm install
cp .env.example .env   # fill in TEAMS_WEBHOOK_URL and CRON_SECRET at minimum
npm run dev            # starts on :8080 (or $PORT), auto-reloads
```

Endpoints:

| Route | Auth | Purpose |
|---|---|---|
| `GET /` or `/healthz` | none | liveness probe |
| `GET /health-report` | `Authorization: Bearer $CRON_SECRET` | runs every registered check, sends the daily summary card |
| `GET /critical-check` | `Authorization: Bearer $CRON_SECRET` | runs every check, sends alerts (with cooldown) for anything non-`ok` |

Both cron endpoints are no-ops unless `NODE_ENV=production` — this mirrors
Octopulse's gate so a staging/dev deployment never spams the real channel.

Customize which checks run by editing `examples/basic-server.ts` (or copy
it — it's the entry point `npm run dev` uses via `src/server.ts` +
`createServer(registry, config)`).

### Test a single run without the HTTP layer

```bash
npm run report:once   # runs runDailyReport() once and exits
npm run check:once    # runs runCriticalCheck() once and exits
```

### Deploy

Build and run like any Node service:

```bash
npm run build
npm start              # runs dist/examples/basic-server.js
```

Deploy it anywhere that runs a long-lived Node process (Railway, a Docker
container, an Azure App Service, a VM). Set the same env vars as `.env.example`
in that platform's environment/secrets config — **never commit `.env`**.

### Point an external scheduler at it

Same pattern as Octopulse's own setup — e.g. with
[cron-job.org](https://cron-job.org):

1. **Daily report** — `GET https://your-service/health-report`, once daily,
   header `Authorization: Bearer <CRON_SECRET>`.
2. **Critical check** — `GET https://your-service/critical-check`, every
   15–30 minutes, same header.

`401` back means the header doesn't match `CRON_SECRET` on the deployment.

---

## Option 2: Use as a library inside another project

Since this isn't published to npm, install it into another project as a
local/git dependency:

```bash
# from the other project's root
npm install /Users/amr/Desktop/health-monitor-service
# or, once you push this folder to a git repo:
npm install git+https://github.com/you/health-monitor-service.git
```

Then in that project's own code (e.g. Octopulse's
`src/app/api/cron/health-report/route.ts`):

```ts
import {
  HealthCheckRegistry,
  runDailyReport,
  runCriticalCheck,
  AlertCooldown,
  cpuCheck,
  memoryCheck,
  type MonitorConfig,
} from 'health-monitor-service';

const config: MonitorConfig = {
  serviceName: 'Octopulse',
  dashboardUrl: 'https://app.octopulse.co/admin/monitoring',
  teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL,
  cronSecret: process.env.CRON_SECRET,
  timezone: 'Asia/Dubai',
  isProduction: process.env.NODE_ENV === 'production',
};

const registry = new HealthCheckRegistry()
  .register('cpu', cpuCheck())
  .register('memory', memoryCheck())
  .register('database', yourOwnDbCheck()); // write this yourself, see below

export const GET = async (request: Request) => {
  // reuse your existing auth check, or import isAuthorizedCronRequest
  await runDailyReport(registry, config);
  return Response.json({ success: true });
};
```

A full worked example — including a stubbed Prisma DB check — is in
[`examples/octopulse-integration.ts`](./examples/octopulse-integration.ts).

**Requirements for the consuming project:**
- Node.js 18+ (needs global `fetch`/`Request`)
- A Teams incoming webhook URL, or a Power Automate HTTP-trigger URL
- A `CRON_SECRET` value, shared with whatever triggers the checks
- Something that calls `runDailyReport`/`runCriticalCheck` on a schedule —
  either this package's own HTTP server + an external pinger, or the host
  app's existing cron routes / in-process scheduler

There's nothing Next.js-specific in `src/` — the only Next-flavored code is
what you write in the route handler that calls these functions, so this
works the same in Express, Fastify, plain Node, etc.

---

## Writing your own check

```ts
import type { HealthCheck } from 'health-monitor-service';

function redisCheck(client: RedisClient): HealthCheck {
  return async () => {
    const start = Date.now();
    try {
      await client.ping();
      const latencyMs = Date.now() - start;
      return {
        name: 'Redis',
        status: latencyMs > 500 ? 'warning' : 'ok',
        message: `${latencyMs}ms`,
      };
    } catch (error) {
      return {
        name: 'Redis',
        status: 'critical',
        message: 'Unreachable',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
```

Rules of thumb:
- `name` should be stable across runs — it's used as the alert-cooldown key.
- Never throw out of a check if avoidable; return `status: 'critical'`
  instead. (If it does throw, the runner catches it and reports it as a
  critical "Check threw an error" result rather than crashing the whole
  batch.)
- Keep `message` short — it renders as a single Adaptive Card fact value.

---

## Project layout

```
src/
  types.ts       - CheckResult, HealthCheck, MonitorConfig
  config.ts      - env loading + cron request auth (timing-safe)
  registry.ts    - HealthCheckRegistry
  cooldown.ts    - AlertCooldown (alert-spam suppression)
  notify.ts      - Teams/Power Automate payload builders + senders
  runner.ts      - runDailyReport / runCriticalCheck orchestration
  server.ts      - standalone HTTP server (createServer)
  checks/        - built-in generic checks (cpu, memory, disk, http-ping)
  index.ts       - public exports
examples/
  basic-server.ts          - standalone deployment entry point
  octopulse-integration.ts - library-usage template (not compiled/run here)
```
