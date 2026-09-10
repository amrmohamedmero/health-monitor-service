/**
 * How far off (ms) a given IANA timezone's wall clock is from UTC, at
 * `date`. Recomputed per call rather than cached, so DST transitions
 * self-correct the next time it's called instead of drifting.
 */
function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second')
  );
  return asIfUtc - date.getTime();
}

/**
 * Milliseconds from now until the next occurrence of `hour:minute` local
 * time in `timezone` — used to schedule the once-daily report at a specific
 * time in a specific location instead of "24h after the process booted".
 */
export function msUntilNextLocalTime(timezone: string, hour: number, minute: number): number {
  const now = new Date();
  const offsetMs = timezoneOffsetMs(now, timezone);
  const localNow = new Date(now.getTime() + offsetMs);

  const target = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), hour, minute, 0, 0)
  );

  let delayMs = target.getTime() - localNow.getTime();
  if (delayMs <= 0) delayMs += 24 * 60 * 60 * 1000;
  return delayMs;
}

/** Formats `date` as a short local time string for the given timezone, for
 *  display in outgoing messages (e.g. "Sep 10, 2026, 9:00 AM"). */
export function formatInTimezone(date: Date, timezone: string): string {
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
