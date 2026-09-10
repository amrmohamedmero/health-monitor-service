import type { HealthCheck } from '../types';

/**
 * Generic "is this URL reachable" check — use it for a DB proxy health
 * endpoint, an upstream API, another microservice, etc.
 * warning above `warnMs`, critical on non-2xx or timeout.
 */
export function httpPingCheck(
  name: string,
  url: string,
  opts: { warnMs?: number; timeoutMs?: number } = {}
): HealthCheck {
  const warnMs = opts.warnMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 5000;

  return async () => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return {
          name,
          status: 'critical' as const,
          message: `HTTP ${response.status}`,
          value: latencyMs,
          latencyMs,
        };
      }

      return {
        name,
        status: latencyMs > warnMs ? ('warning' as const) : ('ok' as const),
        message: `${latencyMs}ms`,
        value: latencyMs,
        latencyMs,
      };
    } catch (error) {
      return {
        name,
        status: 'critical' as const,
        message: 'Unreachable',
        latencyMs: Date.now() - start,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
