import os from 'os';
import type { HealthCheck } from '../types';

/**
 * Flags load average (1-min) relative to CPU count.
 * warning at > 1x cores, critical at > 2x cores.
 */
export function cpuCheck(): HealthCheck {
  return async () => {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length || 1;
    const ratio = loadAvg[0] / cpuCount;

    const status = ratio > 2 ? 'critical' : ratio > 1 ? 'warning' : 'ok';
    return {
      name: 'CPU Load',
      status,
      message: `1m: ${loadAvg[0].toFixed(2)} | 5m: ${loadAvg[1].toFixed(2)} | 15m: ${loadAvg[2].toFixed(2)}`,
      details: `${cpuCount} cores`,
    };
  };
}
