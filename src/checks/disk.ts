import { execFile } from 'child_process';
import { promisify } from 'util';
import type { HealthCheck } from '../types';

const execFileAsync = promisify(execFile);

/**
 * Uses `df` to check disk usage at `path` (POSIX only — Linux/macOS
 * containers). warning at > warnPercent (default 80), critical at >
 * criticalPercent (default 90). Returns a `warning` (not a crash) on
 * Windows, since `df` doesn't exist there.
 */
export function diskCheck(
  path = '/',
  opts: { warnPercent?: number; criticalPercent?: number } = {}
): HealthCheck {
  const warnPercent = opts.warnPercent ?? 80;
  const criticalPercent = opts.criticalPercent ?? 90;

  return async () => {
    if (process.platform === 'win32') {
      return {
        name: 'Disk Usage',
        status: 'warning' as const,
        message: 'Unsupported on Windows (this check shells out to POSIX `df`)',
        details: `Path: ${path}`,
      };
    }

    try {
      const { stdout } = await execFileAsync('df', ['-Pk', path]);
      const lines = stdout.trim().split('\n');
      const parts = lines[lines.length - 1].split(/\s+/);
      const totalKB = parseInt(parts[1], 10);
      const usedKB = parseInt(parts[2], 10);
      const percent = Math.round((usedKB / totalKB) * 100);

      const status = percent > criticalPercent ? 'critical' : percent > warnPercent ? 'warning' : 'ok';
      return {
        name: 'Disk Usage',
        status,
        value: percent,
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
