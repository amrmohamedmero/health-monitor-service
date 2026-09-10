import type { CheckResult } from './types';

interface HistoryEntry {
  timestamp: number;
  status: CheckResult['status'];
  value?: number;
}

/**
 * Rolling per-check history, in-memory. Powers two things the raw
 * point-in-time CheckResult can't: escalation (how many runs in a row has
 * this check been non-ok) and trend (is the underlying number climbing).
 * Same process-lifetime caveat as AlertCooldown — fine for a long-lived
 * server, resets on a serverless cold start.
 */
export class HistoryStore {
  private history = new Map<string, HistoryEntry[]>();

  constructor(private readonly maxEntriesPerCheck = 20) {}

  record(results: CheckResult[]): void {
    const now = Date.now();
    for (const r of results) {
      const entries = this.history.get(r.name) ?? [];
      entries.push({ timestamp: now, status: r.status, value: r.value });
      if (entries.length > this.maxEntriesPerCheck) entries.shift();
      this.history.set(r.name, entries);
    }
  }

  /** How many of the most recent runs (inclusive of the latest) this check
   *  has been non-ok, counting back until the first 'ok'. */
  consecutiveNonOk(name: string): number {
    const entries = this.history.get(name);
    if (!entries) return 0;
    let count = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].status === 'ok') break;
      count++;
    }
    return count;
  }

  /** Compares the earliest vs. latest numeric `value` in the retained
   *  window. Requires checks to set CheckResult.value (percent, ms, etc). */
  trend(name: string): 'rising' | 'falling' | 'flat' | 'unknown' {
    const entries = (this.history.get(name) ?? []).filter(e => e.value !== undefined);
    if (entries.length < 2) return 'unknown';
    const delta = entries[entries.length - 1].value! - entries[0].value!;
    if (Math.abs(delta) < 5) return 'flat';
    return delta > 0 ? 'rising' : 'falling';
  }
}
