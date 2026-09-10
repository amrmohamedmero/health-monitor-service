# health-monitor-service

A small, dependency-free ops-alerting engine for Node apps: register health
checks (CPU/memory/disk/HTTP, or your own DB/queue/storage checks), and it
handles aggregating overall status, formatting/sending messages to
**Teams, Slack, Discord, or Power Automate**, cron auth, alert-spam
cooldown, snoozing during planned maintenance, escalation tracking for
repeat failures, and an optional AI-generated root-cause note attached to
alerts.

It can be used two ways:

1. **Standalone microservice** — deploy it on its own, point an external
   scheduler (cron-job.org, Railway cron, GitHub Actions) at its HTTP
   endpoints.
2. **Library inside another app** — `npm install` it and call its functions
   directly from your own app's cron routes / scheduled functions, no
   second deployment needed.

---

## What problem this solves

If you have a Node service and want to know when it's unhealthy — without
standing up Datadog/PagerDuty/Grafana — this gives you: a place to register
checks, a way to turn their results into a message, somewhere to send that
message (chat apps your team already watches), and the guardrails that keep
that channel usable (cooldowns, snoozing, one combined incident instead of
a flood of pings).

It's intentionally *not* a metrics/observability platform: no time-series
storage, no querying, no dashboards. It's the alerting layer you'd otherwise
hand-roll for a small service, a side project, or as a shared package
across several client apps.

---

## How it works

```
HealthCheckRegistry           you register named checks (async functions
                                that return { status, message, value?, ... })
        │
        ▼
runDailyReport() / runCriticalCheck()        (src/runner.ts)
        │
        ├─ HistoryStore   — rolling per-check history: powers escalation
        │                   ("3rd time in a row") and trend detection
        ├─ SnoozeStore    — maintenance windows: suppress alerting for a
        │                   check (or everything) for N minutes
        ├─ AlertCooldown  — per-check spam cap (default: 3 alerts / 30 min)
        ├─ AnalysisProvider (optional) — sends non-ok results to an LLM,
        │                   attaches a root-cause note + suggestion
        ▼
notify.ts  — builds a provider-agnostic AlertPayload, then fans it out to
             every configured NotificationChannel
        │
        ▼
Teams / Slack / Discord / Power Automate  — each renders its own native
                                              message format
```

A `CheckResult` looks like:

```ts
{ name: 'Disk Usage', status: 'ok' | 'warning' | 'critical', message: '42%', value?: 42, details?: '...' }
```

Overall status is the worst individual result: any `critical` → `unhealthy`;
any `warning` (no critical) → `degraded`; otherwise `healthy`.

**Built-in checks** (`src/checks/`): `cpuCheck()`, `memoryCheck()`,
`diskCheck(path)`, `httpPingCheck(name, url)` — all accept threshold
overrides (see below). They're generic and know nothing about your app; for
anything project-specific (a database, a storage bucket, a queue) write
your own `HealthCheck` — see "Writing your own check".

---

## Ops features beyond "send a message"

| Feature | What it does | Where |
|---|---|---|
| **Multi-channel fan-out** | One alert can go to Teams *and* Slack *and* Discord at once — set any combination of `*_WEBHOOK_URL` env vars, or pass a `channels` array | `src/channels/` |
| **Incident correlation** | If 3 checks fail in the same run, you get **one** combined message, not 3 — reduces the #1 reason alerting gets muted | `buildIncidentReport` in `notify.ts` |
| **Alert cooldown** | Per-check cap (default 3 alerts / 30 min) so a flapping check doesn't spam forever | `AlertCooldown` |
| **Escalation labeling** | A check failing for the 3rd run in a row is labeled `(3x in a row)` in the message, so repeat offenders read differently from a first occurrence | `HistoryStore.consecutiveNonOk` |
| **Snooze / maintenance windows** | `POST /snooze {"check": "Database", "minutes": 30}` suppresses alerts for that check (or `"all"`) without touching the webhook config | `SnoozeStore`, `src/server.ts` |
| **Configurable thresholds** | `memoryCheck({ warnPercent: 70, criticalPercent: 85 })` — tune per environment instead of forking the check | `src/checks/*.ts` |
| **Dead-man's switch** | `GET /healthz` reports `lastSuccessfulRun` — if that goes stale, your *scheduler* stopped firing, which silence alone can't tell you | `src/server.ts` |
| **AI root-cause analysis (optional)** | Attaches a short LLM-generated "likely cause + next step" to alerts that have non-ok results. Off unless you configure a provider | `src/analysis.ts` |

---

## Option 1: Run as a standalone microservice

```bash
cd health-monitor-service
npm install
cp .env.example .env   # fill in at least one *_WEBHOOK_URL and CRON_SECRET
npm run dev            # starts on :8080 (or $PORT), auto-reloads
```

Endpoints:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/` or `/healthz` | GET | none | liveness probe; includes `lastSuccessfulRun` |
| `/health-report` | GET | Bearer | runs every check, sends the daily summary |
| `/critical-check` | GET | Bearer | runs every check, sends one combined alert (cooldown + snooze gated) for anything non-ok |
| `/snooze` | POST | Bearer | body `{"check"?: string, "minutes"?: number}` — `check` omitted or `"all"` snoozes everything |

All Bearer-gated endpoints are no-ops unless `NODE_ENV=production` — so a
staging/dev deployment never spams the real channel.

Customize which checks run by editing `examples/basic-server.ts` (the entry
point `npm run dev` uses via `createServer(registry, config)`).

### Test without the HTTP layer

```bash
npm run report:once   # runs runDailyReport() once and exits
npm run check:once    # runs runCriticalCheck() once and exits
```

### Point an external scheduler at it

E.g. with [cron-job.org](https://cron-job.org):

1. **Daily report** — `GET https://your-service/health-report`, once daily,
   header `Authorization: Bearer <CRON_SECRET>`.
2. **Critical check** — `GET https://your-service/critical-check`, every
   15–30 minutes, same header.

`401` back means the header doesn't match `CRON_SECRET`.

---

## Option 2: Use as a library inside another project

```bash
npm install /path/to/health-monitor-service
# or, once pushed to a git repo:
npm install git+https://github.com/you/health-monitor-service.git
```

```ts
import {
  HealthCheckRegistry,
  runDailyReport,
  runCriticalCheck,
  AlertCooldown,
  slackChannel,
  discordChannel,
  cpuCheck,
  memoryCheck,
  type MonitorConfig,
} from 'health-monitor-service';

const config: MonitorConfig = {
  serviceName: 'My App',
  dashboardUrl: 'https://app.example.com/admin/monitoring',
  channels: [
    slackChannel(process.env.SLACK_WEBHOOK_URL!),
    discordChannel(process.env.DISCORD_WEBHOOK_URL!),
  ],
  cronSecret: process.env.CRON_SECRET,
  timezone: 'Asia/Dubai',
  isProduction: process.env.NODE_ENV === 'production',
};

const registry = new HealthCheckRegistry()
  .register('cpu', cpuCheck())
  .register('memory', memoryCheck({ warnPercent: 75, criticalPercent: 90 }))
  .register('database', yourOwnDbCheck()); // write this yourself, see below

const cooldown = new AlertCooldown();

// Call these from your own route handlers / scheduled functions:
export const dailyReport = () => runDailyReport(registry, config);
export const criticalCheck = () => runCriticalCheck(registry, config, cooldown);
```

A full worked example (including a stubbed Prisma DB check) is in
[`examples/octopulse-integration.ts`](./examples/octopulse-integration.ts).

**Requirements for the consuming project:**
- Node.js 18+ (needs global `fetch`/`Request`)
- At least one notification destination configured (see below)
- A `CRON_SECRET`, shared with whatever triggers the checks (only needed if
  you use the built-in HTTP server / its auth helper)
- Something that calls `runDailyReport`/`runCriticalCheck` on a schedule —
  this package's own server + an external pinger, or your host app's
  existing cron routes / in-process scheduler

Nothing in `src/` is framework-specific — this works the same in Next.js,
Express, Fastify, or plain Node.

---

## Setting up notification destinations

You can enable any combination of these at once — every configured
destination gets every message.

### Microsoft Teams
1. In the target channel: **⋯ → Connectors → Incoming Webhook** (or, for
   newer Teams tenants, a **Workflow** triggered "When a Teams webhook
   request is received").
2. Copy the URL into `TEAMS_WEBHOOK_URL`, or pass `teamsChannel(url)`.
- No other credential needed. Adaptive Card format.

### Slack
1. Create/select a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
   → **Incoming Webhooks** → activate → **Add New Webhook to Workspace** →
   pick the channel.
2. Copy the `https://hooks.slack.com/services/...` URL into
   `SLACK_WEBHOOK_URL`, or pass `slackChannel(url)`.
- No bot token needed for this package — Block Kit format via plain webhook.

### Discord
1. In the target channel: **Edit Channel → Integrations → Webhooks →
   New Webhook** → copy URL.
2. Put it in `DISCORD_WEBHOOK_URL`, or pass `discordChannel(url)`.
- No bot/OAuth app needed. Embed format.

### Power Automate
1. Build a flow with an HTTP-trigger ("When an HTTP request is received").
2. Put its URL in `POWER_AUTOMATE_WEBHOOK_URL`, or pass
   `powerAutomateChannel(url)`.
- Receives the raw `AlertPayload` JSON — your flow decides how to render it.

### Zoom (not built in)
Zoom Team Chat doesn't offer a drop-in webhook URL like the others — it
requires registering a Zoom app (chatbot scope) and using OAuth, which is a
meaningfully heavier setup than "paste a URL." If you need it, implement
`NotificationChannel` yourself (see below) rather than expecting a `.env`
one-liner.

### Writing your own channel

Any destination that isn't built in — Zoom, PagerDuty, a custom webhook,
email — is just this interface:

```ts
import type { NotificationChannel, AlertPayload } from 'health-monitor-service';

function myChannel(webhookUrl: string): NotificationChannel {
  return {
    name: 'my-channel',
    async send(payload: AlertPayload) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), // or translate to your provider's format
      });
      return res.ok;
    },
  };
}

const config: MonitorConfig = { channels: [myChannel(url)], /* ... */ };
```

---

## Optional: AI analysis on alerts

Set `ANTHROPIC_API_KEY` (or pass `config.analysis` directly) and any alert
with non-ok results gets a short LLM-generated root-cause note appended:

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANALYSIS_MODEL=claude-sonnet-5   # optional, this is the default
```

Or wire up any provider yourself (OpenAI, Gemini, a local model, a fine-
tuned prompt) — it's one function:

```ts
import type { AnalysisProvider } from 'health-monitor-service';

const analysis: AnalysisProvider = {
  async analyze(results, { serviceName }) {
    // call whatever LLM you want with the non-ok results
    return { summary: '...', suggestions: ['...'] };
  },
};

const config: MonitorConfig = { analysis, /* ... */ };
```

Notes:
- It's only invoked when a run has at least one non-ok result — never on
  fully healthy runs, to keep cost down.
- A failing/slow/throwing provider never blocks the alert — the analysis
  block is just omitted and a warning is logged.
- Recommended: enable this for `runDailyReport` (slower, richer summary is
  welcome) before also enabling it for the 15-30 min `runCriticalCheck` path,
  since that one runs far more often.

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
        value: latencyMs,
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
- `name` must be stable across runs — it's the cooldown/escalation/snooze
  key. Don't put timestamps or dynamic values in it.
- Set `value` (a plain number — percent, ms, count) if you want
  `HistoryStore` to be able to compute a trend for this check.
- Never throw out of a check if avoidable; return `status: 'critical'`
  instead. (If it does throw, the runner catches it and reports it as a
  critical "Check threw an error" result rather than crashing the batch.)
- Keep `message` short — it renders as a single fact/field in every
  provider's format.

---

## Project layout

```
src/
  types.ts        - CheckResult, HealthCheck, MonitorConfig
  config.ts       - env loading + cron request auth (timing-safe)
  registry.ts     - HealthCheckRegistry
  cooldown.ts     - AlertCooldown (per-check alert-spam suppression)
  history.ts      - HistoryStore (escalation streaks + trend)
  snooze.ts       - SnoozeStore (maintenance windows)
  analysis.ts     - AnalysisProvider interface + Anthropic implementation
  notify.ts       - AlertPayload builders + multi-channel send
  runner.ts       - runDailyReport / runCriticalCheck orchestration
  server.ts       - standalone HTTP server (createServer)
  channels/       - teams.ts, slack.ts, discord.ts, power-automate.ts
  checks/         - built-in generic checks (cpu, memory, disk, http-ping)
  index.ts        - public exports
examples/
  basic-server.ts          - standalone deployment entry point
  octopulse-integration.ts - library-usage template (not compiled/run here)
```
