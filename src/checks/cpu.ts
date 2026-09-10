import os from 'os';
import type { HealthCheck } from '../types';

/**
 * Flags load average (1-min) relative to CPU count.
 * warning at > warnRatio cores (default 1x), critical at > criticalRatio (default 2x).
 * Note: on containers/serverless with a cgroup CPU quota, os.cpus().length
 * reflects the host, not the quota — tune the ratios or swap in your own
 * cgroup-aware check if that matters for your deployment.
 */
export function cpuCheck(opts: { warnRatio?: number; criticalRatio?: number } = {}): HealthCheck {
  const warnRatio = opts.warnRatio ?? 1;
  const criticalRatio = opts.criticalRatio ?? 2;

  return async () => {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length || 1;
    const ratio = loadAvg[0] / cpuCount;

    const status = ratio > criticalRatio ? 'critical' : ratio > warnRatio ? 'warning' : 'ok';
    return {
      name: 'CPU Load',
      status,
      value: Math.round(ratio * 100),
      message: `1m: ${loadAvg[0].toFixed(2)} | 5m: ${loadAvg[1].toFixed(2)} | 15m: ${loadAvg[2].toFixed(2)}`,
      details: `${cpuCount} cores`,
    };
  };
}
