import type { HealthCheck } from './types';

/**
 * Named collection of health checks. Register whatever's relevant to your
 * app (DB ping, storage bucket, CPU/memory, an upstream API) and hand the
 * registry to runDailyReport/runCriticalCheck.
 */
export class HealthCheckRegistry {
  private checks = new Map<string, HealthCheck>();

  register(name: string, check: HealthCheck): this {
    this.checks.set(name, check);
    return this;
  }

  unregister(name: string): void {
    this.checks.delete(name);
  }

  list(): HealthCheck[] {
    return Array.from(this.checks.values());
  }

  get size(): number {
    return this.checks.size;
  }
}
