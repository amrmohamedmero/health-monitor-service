/**
 * Per-check alert cooldown so a flapping check doesn't spam Teams every 30
 * minutes forever. In-memory and scoped to this process — on a platform
 * that recycles the process between runs (serverless), state resets each
 * time, which is an acceptable trade-off for a check running every 30 min.
 */
interface AlertState {
  lastAlertTime: number;
  count: number;
}

export class AlertCooldown {
  private states = new Map<string, AlertState>();

  constructor(
    private readonly cooldownMs = 30 * 60 * 1000,
    private readonly maxPerPeriod = 3
  ) {}

  shouldSend(key: string): boolean {
    const state = this.states.get(key);
    const now = Date.now();

    if (!state) return true;

    if (now - state.lastAlertTime > this.cooldownMs) {
      state.count = 0;
      return true;
    }

    return state.count < this.maxPerPeriod;
  }

  record(key: string): void {
    const state = this.states.get(key) || { lastAlertTime: 0, count: 0 };
    state.lastAlertTime = Date.now();
    state.count++;
    this.states.set(key, state);
  }
}
