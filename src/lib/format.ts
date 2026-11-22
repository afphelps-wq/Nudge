/**
 * Hand-written date/label formatters. Deliberately no `Intl` / locale APIs, so
 * the output is identical on every device and in the Node logic tests.
 * Pure module: no React Native imports.
 */
import type { Repeat } from '@/lib/types';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** True when both dates fall on the same local calendar date. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Whole local calendar days from `now` to `d` (0 = today, 1 = tomorrow, -1 = yesterday). */
export function calendarDayDiff(d: Date, now: Date): number {
  // Rounding absorbs the 23h / 25h days around daylight-saving changes.
  return Math.round((startOfLocalDay(d) - startOfLocalDay(now)) / DAY_MS);
}

/** "3:00 PM": 12-hour clock, no leading zero on the hour, two-digit minutes. */
export function formatTime(d: Date): string {
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${pad2(d.getMinutes())} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/** "Today", "Tomorrow", "Yesterday", otherwise "Tue, Nov 25" (plus ", 2027" in another year). */
export function relativeDay(d: Date, now: Date): string {
  const diff = calendarDayDiff(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const base = `${WEEKDAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** "Today · 3:00 PM" */
export function formatWhen(d: Date, now: Date): string {
  return `${relativeDay(d, now)} · ${formatTime(d)}`;
}

/** Sorted, unique, valid (0–6) weekday numbers. */
function cleanWeekdays(days: readonly number[]): number[] {
  const seen = new Set<number>();
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) seen.add(day);
  }
  return [...seen].sort((a, b) => a - b);
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * "Doesn't repeat", "Every day", "Weekdays", "Weekends", "Every Monday",
 * "Mon & Wed" or "Mon, Wed & Fri".
 */
export function repeatLabel(repeat: Repeat): string {
  if (repeat === null) return "Doesn't repeat";
  if (repeat.kind === 'daily') return 'Every day';
  const days = cleanWeekdays(repeat.weekdays);
  if (days.length === 0) return "Doesn't repeat";
  if (days.length === 7) return 'Every day';
  if (sameDays(days, [1, 2, 3, 4, 5])) return 'Weekdays';
  if (sameDays(days, [0, 6])) return 'Weekends';
  if (days.length === 1) return `Every ${WEEKDAY_LONG[days[0]]}`;
  const names = days.map((day) => WEEKDAY_SHORT[day]);
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Nag interval as used in sentences: "15 min", "30 min", "hour", "2 hours". */
export function intervalLabel(minutes: number): string {
  if (minutes === 60) return 'hour';
  if (minutes === 120) return '2 hours';
  return `${minutes} min`;
}

/** Event heads-up label used in notification bodies: "10 min", "15 min", "30 min", "1 hour". */
export function leadLabel(minutes: number): string {
  if (minutes === 60) return '1 hour';
  return `${minutes} min`;
}

/** Date → "HH:mm" (24h), for quiet-hours settings. */
export function toHHmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "HH:mm" → minutes after midnight, or null when the string is not a valid 24h time. */
export function parseHHmm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * "HH:mm" → a Date on a fixed base day, for time-only pickers. The fixed day
 * keeps this pure and avoids daylight-saving gaps. Invalid input gives 00:00.
 */
export function hhmmToDate(value: string): Date {
  const total = parseHHmm(value) ?? 0;
  return new Date(2000, 0, 1, Math.floor(total / 60), total % 60, 0, 0);
}
