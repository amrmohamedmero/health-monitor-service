import os from 'os';
import type { HealthCheck } from '../types';

/**
 * Flags used-memory percent. warning at > warnPercent (default 80), critical
 * at > criticalPercent (default 90).
 */
export function memoryCheck(opts: { warnPercent?: number; criticalPercent?: number } = {}): HealthCheck {
  const warnPercent = opts.warnPercent ?? 80;
  const criticalPercent = opts.criticalPercent ?? 90;

  return async () => {
    const totalMB = os.totalmem() / 1024 / 1024;
    const freeMB = os.freemem() / 1024 / 1024;
    const usedMB = totalMB - freeMB;
    const percent = Math.round((usedMB / totalMB) * 100);

    const status = percent > criticalPercent ? 'critical' : percent > warnPercent ? 'warning' : 'ok';
    return {
      name: 'Memory',
      status,
      value: percent,
      message: `${percent}% (${(usedMB / 1024).toFixed(1)}/${(totalMB / 1024).toFixed(1)} GB)`,
    };
  };
}
