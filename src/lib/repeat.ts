/**
 * Repeat rules for events. Pure module: no React Native imports.
 * Weekdays use JS `Date.getDay()` numbering: 0 = Sunday … 6 = Saturday.
 */
import type { Repeat } from '@/lib/types';

export type ActiveRepeat = Exclude<Repeat, null>;

export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
export const WEEKENDS: readonly number[] = [0, 6];

/** Sorted, unique, valid (0–6) weekday numbers. */
export function normalizeWeekdays(days: readonly number[]): number[] {
  const seen = new Set<number>();
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) seen.add(day);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Canonical form: weekdays sorted and unique; a weekly repeat with no days becomes null. */
export function normalizeRepeat(repeat: Repeat): Repeat {
  if (repeat === null) return null;
  if (repeat.kind === 'daily') return { kind: 'daily' };
  const weekdays = normalizeWeekdays(repeat.weekdays);
  return weekdays.length === 0 ? null : { kind: 'weekly', weekdays };
}

export function repeatsEqual(a: Repeat, b: Repeat): boolean {
  const left = normalizeRepeat(a);
  const right = normalizeRepeat(b);
  if (left === null || right === null) return left === right;
  if (left.kind === 'daily' || right.kind === 'daily') return left.kind === right.kind;
  return (
    left.weekdays.length === right.weekdays.length &&
    left.weekdays.every((day, index) => day === right.weekdays[index])
  );
}

/** Does this repeat rule include the local calendar day of `date`? */
export function matchesRepeat(repeat: ActiveRepeat, date: Date): boolean {
  if (repeat.kind === 'daily') return true;
  const weekdays = normalizeWeekdays(repeat.weekdays);
  // A weekly rule with no valid days is treated as daily so callers never loop forever.
  return weekdays.length === 0 || weekdays.includes(date.getDay());
}

/**
 * Days searched by `nextOccurrence`. A weekly rule needs at most 7 days after
 * today; the extra days cover a local calendar day that does not exist (a time
 * zone that skips a whole date).
 */
const SEARCH_DAYS = 14;

/**
 * The first occurrence strictly after `after`, keeping the hour and minute of `dueAt`.
 * Daily: the next day at that time. Weekly: the next date whose weekday is in `weekdays`.
 * Uses local calendar arithmetic, so the wall-clock time survives daylight-saving changes.
 * Returns an Invalid Date when `dueAt` or `after` is invalid.
 */
export function nextOccurrence(repeat: ActiveRepeat, dueAt: Date, after: Date): Date {
  const hours = dueAt.getHours();
  const minutes = dueAt.getMinutes();
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    // Each day is built from the calendar fields instead of stepping one Date
    // forward: a time inside a daylight-saving gap (2:30 AM on the spring-forward
    // day) is moved by JS to 3:30, and stepping would carry that 3:30 into the
    // following days.
    const candidate = new Date(
      after.getFullYear(),
      after.getMonth(),
      after.getDate() + offset,
      hours,
      minutes,
      0,
      0
    );
    if (candidate.getTime() > after.getTime() && matchesRepeat(repeat, candidate)) {
      return candidate;
    }
  }
  return new Date(NaN);
}

/**
 * `dueAt` itself followed by each later occurrence, up to and including `until`.
 * `max` bounds the list so a bad rule can never produce an unbounded result.
 */
export function occurrencesUntil(
  repeat: ActiveRepeat,
  dueAt: Date,
  until: Date,
  max = 64
): Date[] {
  const result: Date[] = [];
  let current = new Date(dueAt);
  while (current.getTime() <= until.getTime() && result.length < max) {
    result.push(current);
    // The time of day always comes from `dueAt`, not from the previous
    // occurrence, which a daylight-saving gap may have shifted by an hour.
    current = nextOccurrence(repeat, dueAt, current);
  }
  return result;
}
