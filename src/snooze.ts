/**
 * Maintenance-window / snooze support. Suppresses alerting for a specific
 * check (or everything, via the 'all' key) for a bounded duration — for
 * planned restarts/deploys, without having to disable the whole webhook.
 * Checks still run and are still recorded in history; they're just excluded
 * from the alert set while snoozed. In-memory only — same process-lifetime
 * caveat as AlertCooldown/HistoryStore.
 */
export class SnoozeStore {
  private snoozedUntil = new Map<string, number>();

  snooze(key: string, durationMs: number): void {
    this.snoozedUntil.set(key, Date.now() + durationMs);
  }

  clear(key: string): void {
    this.snoozedUntil.delete(key);
  }

  private isSnoozed(key: string): boolean {
    const until = this.snoozedUntil.get(key);
    if (until === undefined) return false;
    if (Date.now() > until) {
      this.snoozedUntil.delete(key);
      return false;
    }
    return true;
  }

  /** True if this specific check, or everything ('all'), is snoozed. */
  isActive(checkName: string): boolean {
    return this.isSnoozed('all') || this.isSnoozed(checkName);
  }
}
