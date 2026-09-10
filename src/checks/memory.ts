import os from 'os';
import type { HealthCheck } from '../types';

/**
 * Flags used-memory percent. warning at > 80%, critical at > 90%.
 */
export function memoryCheck(): HealthCheck {
  return async () => {
    const totalMB = os.totalmem() / 1024 / 1024;
    const freeMB = os.freemem() / 1024 / 1024;
    const usedMB = totalMB - freeMB;
    const percent = Math.round((usedMB / totalMB) * 100);

    const status = percent > 90 ? 'critical' : percent > 80 ? 'warning' : 'ok';
    return {
      name: 'Memory',
      status,
      message: `${percent}% (${(usedMB / 1024).toFixed(1)}/${(totalMB / 1024).toFixed(1)} GB)`,
    };
  };
}
