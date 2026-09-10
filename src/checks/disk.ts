import { execFile } from 'child_process';
import { promisify } from 'util';
import type { HealthCheck } from '../types';

const execFileAsync = promisify(execFile);

/**
 * Uses `df` to check disk usage at `path` (POSIX only — Linux/macOS
 * containers). warning at > 80%, critical at > 90%.
 */
export function diskCheck(path = '/'): HealthCheck {
  return async () => {
    try {
      const { stdout } = await execFileAsync('df', ['-Pk', path]);
      const lines = stdout.trim().split('\n');
      const parts = lines[lines.length - 1].split(/\s+/);
      const totalKB = parseInt(parts[1], 10);
      const usedKB = parseInt(parts[2], 10);
      const percent = Math.round((usedKB / totalKB) * 100);

      const status = percent > 90 ? 'critical' : percent > 80 ? 'warning' : 'ok';
      return {
        name: 'Disk Usage',
        status,
        message: `${percent}% (${(usedKB / 1024 / 1024).toFixed(1)}/${(totalKB / 1024 / 1024).toFixed(1)} GB)`,
        details: `Path: ${path}`,
      };
    } catch (error) {
      return {
        name: 'Disk Usage',
        status: 'warning' as const,
        message: 'Could not read disk usage',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
