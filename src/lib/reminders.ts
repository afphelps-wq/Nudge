/**
 * Pure reminder logic shared by the store, the screens and the logic tests:
 * time helpers, draft <-> reminder conversion, draft editing rules, the
 * toggle/maintenance reducers, list sorting and list subtitles.
 *
 * Pure module: no React, React Native or Expo imports, and every function
 * takes `now` as a parameter instead of reading the clock.
 */
import {
  formatTime,
  formatWhen,
  intervalLabel,
  isSameLocalDay,
  relativeDay,
  repeatLabel,
} from '@/lib/format';
import {
  alignToRepeat,
  nextOccurrence,
  normalizeRepeat,
  normalizeWeekdays,
  repeatsEqual,
  WEEKDAYS,
  WEEKENDS,
} from '@/lib/repeat';
import type { DraftReminder, Reminder, ReminderType, Repeat, Settings } from '@/lib/types';

// ---------------------------------------------------------------------------
// Time helpers (seeded; `parse.ts` depends on these exact signatures)
// ---------------------------------------------------------------------------

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** The next full hour strictly after `now` (10:00 → 11:00, 10:20 → 11:00). */
export function nextFullHour(now: Date): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

/**
 * Default "Start reminding me" time for a task:
 * `max(now, dueAt − settings.defaultNagStartHours)`, or `now` when there is no deadline.
 */
export function defaultNagStart(dueAt: Date | null, now: Date, settings: Settings): Date {
  if (dueAt === null) return new Date(now);
  const start = dueAt.getTime() - settings.defaultNagStartHours * HOUR_MS;
  return new Date(Math.max(now.getTime(), start));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Longest title a card accepts (the card's TextInput uses the same limit). */
const TITLE_MAX_LENGTH = 120;

/** Done reminders are deleted once they have been completed for longer than this. */
const PRUNE_AFTER_MS = 30 * DAY_MS;

/** The "N hrs before" pills of the "Start reminding me" row. */
const NAG_OFFSET_HOURS = [1, 3, 6] as const;

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** The date itself, or null for null / undefined / an Invalid Date. */
function validOrNull(value: Date | null | undefined): Date | null {
  return isValidDate(value) ? value : null;
}

/** A stored ISO string as a Date, or null when it is missing or cannot be parsed. */
function parseIso(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const date = new Date(value);
  return isValidDate(date) ? date : null;
}

/** A stored ISO string as a timestamp, or null when it is missing or cannot be parsed. */
function isoTime(value: string | null | undefined): number | null {
  const date = parseIso(value);
  return date === null ? null : date.getTime();
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** A copy with the seconds and milliseconds set to zero. */
function withoutSeconds(date: Date): Date {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy;
}

/** `clamp(chosen, now, dueAt ?? ∞)`. A deadline that is not after `now` gives `now`. */
function clampNagStart(chosen: Date, now: Date, dueAt: Date | null): Date {
  const upper = dueAt === null ? Infinity : dueAt.getTime();
  return new Date(Math.max(now.getTime(), Math.min(chosen.getTime(), upper)));
}

/** Trimmed and cut to the title limit, without cutting an emoji (surrogate pair) in half. */
function clampTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
  const lastUnit = trimmed.charCodeAt(TITLE_MAX_LENGTH - 1);
  const splitsPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return trimmed.slice(0, splitsPair ? TITLE_MAX_LENGTH - 1 : TITLE_MAX_LENGTH).trimEnd();
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

/** The repeat rule of a stored reminder: only events repeat, and an empty weekly rule counts as none. */
function activeRepeat(reminder: Reminder): Repeat {
  return reminder.type === 'event' ? normalizeRepeat(reminder.repeat) : null;
}

// Makes the keys of fallback cards unique without reading the clock or Math.random().
let emptyDraftCount = 0;

/** Fields of a stored reminder that may be changed after creation. */
export type ReminderPatch = Partial<Omit<Reminder, 'id' | 'createdAt'>>;

// --- ids -------------------------------------------------------------------

/**
 * `Date.now().toString(36) + Math.random().toString(36).slice(2, 8)`
 * The one function here that reads the clock: call it from event handlers only, never while rendering.
 */
export function newReminderId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- drafts ----------------------------------------------------------------

/**
 * A card is valid when the title is non-empty after trimming, `needsTime` is
 * false, and, for events, `dueAt` exists and is in the future.
 */
export function isDraftValid(draft: DraftReminder, now: Date): boolean {
  if (draft.text.trim().length === 0) return false;
  if (draft.needsTime) return false;
  if (draft.type === 'event') {
    return isValidDate(draft.dueAt) && draft.dueAt.getTime() > now.getTime();
  }
  return true;
}

/** Review fallback when parsing yields nothing: one task card holding the raw text, needing a time. */
export function emptyTaskDraft(text: string, now: Date): DraftReminder {
  emptyDraftCount += 1;
  return {
    key: `empty-${now.getTime().toString(36)}-${emptyDraftCount}`,
    text: clampTitle(text),
    type: 'task',
    dueAt: null,
    needsTime: true,
    pickerPreset: nextFullHour(now),
    nagStartAt: null,
    repeat: null,
  };
}

/**
 * Review "On Save": new id, `createdAt = now`, `status = 'active'`, `completedAt = null`.
 * Tasks: `repeat = null`, `nagStartAt = clamp(chosen ?? default, now, dueAt ?? ∞)`
 * (a deadline already in the past gives `now`). Events: `nagStartAt = null`.
 */
export function draftToReminder(draft: DraftReminder, now: Date, settings: Settings): Reminder {
  const dueAt = validOrNull(draft.dueAt);
  const isTask = draft.type === 'task';
  const chosen = validOrNull(draft.nagStartAt) ?? defaultNagStart(dueAt, now, settings);
  return {
    id: newReminderId(),
    text: draft.text.trim(),
    type: draft.type,
    dueAt: dueAt === null ? null : dueAt.toISOString(),
    nagStartAt: isTask ? clampNagStart(chosen, now, dueAt).toISOString() : null,
    repeat: isTask ? null : normalizeRepeat(draft.repeat),
    status: 'active',
    completedAt: null,
    createdAt: now.toISOString(),
  };
}

/** Edit screen: prefill a card from a stored reminder (`key = reminder.id`, `needsTime = false`). */
export function reminderToDraft(reminder: Reminder, now: Date): DraftReminder {
  const dueAt = parseIso(reminder.dueAt);
  const isEvent = reminder.type === 'event';
  return {
    key: reminder.id,
    text: reminder.text,
    type: reminder.type,
    dueAt,
    // Only a damaged record gets here with an event and no usable time; the card
    // then asks for one instead of showing an event without a date.
    needsTime: isEvent && dueAt === null,
    pickerPreset: dueAt === null ? nextFullHour(now) : new Date(dueAt),
    nagStartAt: isEvent ? null : parseIso(reminder.nagStartAt),
    repeat: isEvent ? normalizeRepeat(reminder.repeat) : null,
  };
}

/**
 * Edit "Save changes": only the fields that differ from `original`.
 * - If `type`, `dueAt` or `repeat` changed and the reminder was done, the patch
 *   also sets `status: 'active'` and `completedAt: null`.
 * - A task's `nagStartAt` is re-clamped to `[now, dueAt]` only when the user
 *   changed it (or changed type/dueAt); an untouched, already-started nag keeps
 *   its original start so escalation is not reset by, say, a rename.
 */
export function draftToPatch(
  draft: DraftReminder,
  original: Reminder,
  now: Date,
  settings: Settings
): ReminderPatch {
  const patch: ReminderPatch = {};

  const text = draft.text.trim();
  if (text.length > 0 && text !== original.text) patch.text = text;

  const typeChanged = draft.type !== original.type;
  if (typeChanged) patch.type = draft.type;

  const dueAt = validOrNull(draft.dueAt);
  const dueChanged = !sameInstant(dueAt, parseIso(original.dueAt));
  if (dueChanged) patch.dueAt = dueAt === null ? null : dueAt.toISOString();

  const repeat = draft.type === 'event' ? normalizeRepeat(draft.repeat) : null;
  const repeatChanged = !repeatsEqual(repeat, original.repeat);
  if (repeatChanged) patch.repeat = repeat;

  if (draft.type === 'event') {
    if (original.nagStartAt !== null) patch.nagStartAt = null;
  } else {
    const originalNag = parseIso(original.nagStartAt);
    const draftNag = validOrNull(draft.nagStartAt);
    const touched =
      typeChanged || dueChanged || originalNag === null || !sameInstant(draftNag, originalNag);
    if (touched) {
      const chosen = draftNag ?? defaultNagStart(dueAt, now, settings);
      const nagStartAt = clampNagStart(chosen, now, dueAt);
      if (!sameInstant(nagStartAt, originalNag)) patch.nagStartAt = nagStartAt.toISOString();
    }
  }

  if (original.status === 'done' && (typeChanged || dueChanged || repeatChanged)) {
    patch.status = 'active';
    patch.completedAt = null;
  }

  return patch;
}

// --- draft editing rules (each returns a NEW draft; never mutates) ----------

/**
 * Type chip. To event: `nagStartAt = null`, and `needsTime = true` when there is no `dueAt`.
 * To task: `repeat = null`; `nagStartAt` = the default rule when there is a `dueAt`,
 * `now` for a no-deadline task, or `null` while `needsTime` is still true.
 */
export function setDraftType(
  draft: DraftReminder,
  type: ReminderType,
  now: Date,
  settings: Settings
): DraftReminder {
  if (type === draft.type) return { ...draft };
  const dueAt = validOrNull(draft.dueAt);
  if (type === 'event') {
    return {
      ...draft,
      type: 'event',
      dueAt,
      nagStartAt: null,
      needsTime: draft.needsTime || dueAt === null,
    };
  }
  return {
    ...draft,
    type: 'task',
    dueAt,
    repeat: null,
    nagStartAt: draft.needsTime ? null : defaultNagStart(dueAt, now, settings),
  };
}

/**
 * A time was chosen in the When picker: sets `dueAt` (seconds zeroed) and clears `needsTime`.
 * Tasks: `nagStartAt` keeps a fixed "N hrs before" choice relative to the new deadline,
 * keeps a custom time (clamped to `[now, dueAt]`), and otherwise falls back to the default rule.
 * Events: a weekly repeat on exactly the old weekday follows the new weekday. Any other
 * weekly repeat stays as it is, and a date on a day it does not allow moves forward to
 * the next day it does, at the same hour and minute.
 */
export function setDraftDueAt(
  draft: DraftReminder,
  dueAt: Date,
  now: Date,
  settings: Settings
): DraftReminder {
  if (!isValidDate(dueAt)) return { ...draft };
  const due = withoutSeconds(dueAt);

  if (draft.type === 'event') {
    const oldAnchor = validOrNull(draft.dueAt) ?? validOrNull(draft.pickerPreset);
    let repeat = draft.repeat;
    if (repeat !== null && repeat.kind === 'weekly' && oldAnchor !== null) {
      const weekdays = normalizeWeekdays(repeat.weekdays);
      if (weekdays.length === 1 && weekdays[0] === oldAnchor.getDay()) {
        repeat = { kind: 'weekly', weekdays: [due.getDay()] };
      }
    }
    // An event's date is always on a day its repeat allows.
    const active = normalizeRepeat(repeat);
    const allowedDue = active === null ? due : alignToRepeat(due, active);
    return { ...draft, dueAt: allowedDue, needsTime: false, nagStartAt: null, repeat };
  }

  const previousDue = validOrNull(draft.dueAt);
  const previousNag = validOrNull(draft.nagStartAt);
  let nagStartAt = defaultNagStart(due, now, settings);
  if (previousDue !== null && previousNag !== null) {
    const choice = getNagChoice(draft, now);
    if (choice === 'custom') {
      // With a 2-hour default there is no matching pill, so the default offset
      // reads as "custom"; it still has to follow the deadline like the others.
      const defaultStart = previousDue.getTime() - settings.defaultNagStartHours * HOUR_MS;
      const wasDefaultOffset = Math.abs(previousNag.getTime() - defaultStart) < MINUTE_MS;
      if (!wasDefaultOffset) nagStartAt = clampNagStart(previousNag, now, due);
    } else if (choice !== 'now') {
      nagStartAt = new Date(Math.max(now.getTime(), due.getTime() - choice * HOUR_MS));
    }
  }
  return { ...draft, dueAt: due, needsTime: false, nagStartAt };
}

/** "Not sure — nag me until it's done": task, no deadline, `needsTime = false`, `nagStartAt = now`, no repeat. */
export function setDraftNotSure(draft: DraftReminder, now: Date): DraftReminder {
  return {
    ...draft,
    type: 'task',
    dueAt: null,
    needsTime: false,
    nagStartAt: new Date(now),
    repeat: null,
  };
}

/**
 * The value the When picker should display: `dueAt ?? pickerPreset`, moved to the
 * next full hour when a preset is not in the future, and never before `now` for events.
 * Always a valid Date.
 */
export function pickerValue(draft: DraftReminder, now: Date): Date {
  const fallback = nextFullHour(now);
  const dueAt = validOrNull(draft.dueAt);
  let value = fallback;
  if (dueAt !== null) {
    value = dueAt;
  } else {
    const preset = validOrNull(draft.pickerPreset);
    if (preset !== null && preset.getTime() > now.getTime()) value = preset;
  }
  // An event's picker has "now" as its minimum; a value below it would be out of range.
  if (draft.type === 'event' && value.getTime() < now.getTime()) value = fallback;
  return new Date(value);
}

/** Text of the When chip: "Pick a time", "No deadline", "Due Today · 5:00 PM" or "Tue, Nov 24 · 3:00 PM". */
export function whenChipLabel(draft: DraftReminder, now: Date): string {
  if (draft.needsTime) return 'Pick a time';
  const dueAt = validOrNull(draft.dueAt);
  if (draft.type === 'task') {
    return dueAt === null ? 'No deadline' : `Due ${formatWhen(dueAt, now)}`;
  }
  return dueAt === null ? 'Pick a time' : formatWhen(dueAt, now);
}

export type NagChoice = 'now' | 1 | 3 | 6 | 'custom';

/**
 * Which "Start reminding me" pill is selected, derived from the draft:
 * 'now' when `nagStartAt <= now` (within a minute), 1/3/6 when it is that many
 * hours before `dueAt` (within a minute), otherwise 'custom'.
 */
export function getNagChoice(draft: DraftReminder, now: Date): NagChoice {
  const dueAt = validOrNull(draft.dueAt);
  const nagStartAt = validOrNull(draft.nagStartAt);
  if (dueAt === null || nagStartAt === null) return 'now';
  // The minute of slack absorbs the gap between the clock the draft was built
  // with and the screen's clock, which only ticks every 30 seconds.
  if (nagStartAt.getTime() - now.getTime() < MINUTE_MS) return 'now';
  for (const hours of NAG_OFFSET_HOURS) {
    const offsetStart = dueAt.getTime() - hours * HOUR_MS;
    if (Math.abs(nagStartAt.getTime() - offsetStart) < MINUTE_MS) return hours;
  }
  return 'custom';
}

/** A fixed pill was tapped. "N hrs before" in the past is stored as `now` (and so shows as 'now'). */
export function setDraftNagChoice(
  draft: DraftReminder,
  choice: Exclude<NagChoice, 'custom'>,
  now: Date
): DraftReminder {
  if (draft.type === 'event') return { ...draft, nagStartAt: null };
  const dueAt = validOrNull(draft.dueAt);
  if (choice === 'now' || dueAt === null) return { ...draft, nagStartAt: new Date(now) };
  const start = dueAt.getTime() - choice * HOUR_MS;
  return { ...draft, nagStartAt: new Date(Math.max(now.getTime(), start)) };
}

/** The Custom picker changed: `nagStartAt` clamped to `[now, dueAt]`, seconds zeroed. */
export function setDraftNagStart(draft: DraftReminder, nagStartAt: Date, now: Date): DraftReminder {
  if (draft.type === 'event') return { ...draft, nagStartAt: null };
  if (!isValidDate(nagStartAt)) return { ...draft };
  const clamped = clampNagStart(withoutSeconds(nagStartAt), now, validOrNull(draft.dueAt));
  return { ...draft, nagStartAt: clamped };
}

export type RepeatChoice = 'never' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'custom';

/**
 * Which Repeat-row pill is selected. `anchor` is `dueAt ?? pickerPreset`:
 * 'weekly' means a weekly repeat on exactly the anchor's weekday; any other
 * weekday set that is not Weekdays/Weekends is 'custom'.
 */
export function getRepeatChoice(repeat: Repeat, anchor: Date): RepeatChoice {
  const normalized = normalizeRepeat(repeat);
  if (normalized === null) return 'never';
  if (normalized.kind === 'daily') return 'daily';
  const { weekdays } = normalized;
  // All seven days is the same rule as Daily (and `repeatLabel` calls it "Every day").
  if (weekdays.length === 7) return 'daily';
  if (sameDays(weekdays, WEEKDAYS)) return 'weekdays';
  if (sameDays(weekdays, WEEKENDS)) return 'weekends';
  if (weekdays.length === 1 && isValidDate(anchor) && weekdays[0] === anchor.getDay()) {
    return 'weekly';
  }
  return 'custom';
}

/** The Repeat value for a tapped pill ("Weekly" = the weekday of `anchor`). */
export function repeatForChoice(choice: Exclude<RepeatChoice, 'custom'>, anchor: Date): Repeat {
  switch (choice) {
    case 'never':
      return null;
    case 'daily':
      return { kind: 'daily' };
    case 'weekdays':
      return { kind: 'weekly', weekdays: [...WEEKDAYS] };
    case 'weekends':
      return { kind: 'weekly', weekdays: [...WEEKENDS] };
    case 'weekly':
      return isValidDate(anchor) ? { kind: 'weekly', weekdays: [anchor.getDay()] } : null;
    default:
      return null;
  }
}

/**
 * Sets a (normalised) repeat on an event draft. An event's date is always on a
 * day its repeat allows: when a weekly repeat does not include the weekday of
 * `dueAt`, the date moves forward to the next day it does include, at the same
 * hour and minute. While no time has been picked yet, the picker's preset moves
 * the same way, so the picker opens on a day the repeat allows.
 */
export function setDraftRepeat(draft: DraftReminder, repeat: Repeat): DraftReminder {
  if (draft.type !== 'event') return { ...draft, repeat: null };
  const next = normalizeRepeat(repeat);
  if (next === null) return { ...draft, repeat: null };
  const dueAt = validOrNull(draft.dueAt);
  if (dueAt !== null) return { ...draft, repeat: next, dueAt: alignToRepeat(dueAt, next) };
  const preset = validOrNull(draft.pickerPreset);
  if (preset === null) return { ...draft, repeat: next };
  return { ...draft, repeat: next, pickerPreset: alignToRepeat(preset, next) };
}

// --- store reducers (return the SAME array reference when nothing changed) --

/** The active → done half of `toggleDone` for one active reminder. */
function completeReminder(reminder: Reminder, now: Date): Reminder {
  const repeat = activeRepeat(reminder);
  const dueAt = parseIso(reminder.dueAt);
  if (repeat !== null && dueAt !== null) {
    const next = nextOccurrence(repeat, dueAt, dueAt);
    if (isValidDate(next)) return { ...reminder, dueAt: next.toISOString() };
  }
  return { ...reminder, status: 'done', completedAt: now.toISOString() };
}

/** The done → active half of `toggleDone` for one done reminder. */
function reactivateReminder(reminder: Reminder, now: Date): Reminder {
  const next: Reminder = { ...reminder, status: 'active', completedAt: null };
  if (reminder.type === 'task') {
    const nagStart = isoTime(reminder.nagStartAt);
    if (nagStart === null || nagStart < now.getTime()) next.nagStartAt = now.toISOString();
  }
  return next;
}

function replaceAt(reminders: Reminder[], index: number, next: Reminder): Reminder[] {
  const copy = [...reminders];
  copy[index] = next;
  return copy;
}

/**
 * Active → done: a task or non-repeating event gets `status = 'done'`, `completedAt = now`;
 * a repeating event is not marked done, its `dueAt` advances to the next occurrence
 * after the current `dueAt` ("skip this one").
 * Done → active: `status = 'active'`, `completedAt = null`; a task whose `nagStartAt < now`
 * gets `nagStartAt = now`.
 */
export function applyToggleDone(reminders: Reminder[], id: string, now: Date): Reminder[] {
  const index = reminders.findIndex((reminder) => reminder.id === id);
  if (index === -1) return reminders;
  const current = reminders[index];
  const next =
    current.status === 'done' ? reactivateReminder(current, now) : completeReminder(current, now);
  return replaceAt(reminders, index, next);
}

/** Notification "Done ✓": like the active → done half of toggle; missing or already-done ids are ignored. */
export function applyMarkDone(reminders: Reminder[], id: string, now: Date): Reminder[] {
  const index = reminders.findIndex((reminder) => reminder.id === id);
  if (index === -1 || reminders[index].status === 'done') return reminders;
  return replaceAt(reminders, index, completeReminder(reminders[index], now));
}

/** Steps 1 and 2 of maintenance for one reminder; returns the same object when nothing applies. */
function settlePastEvent(reminder: Reminder, now: Date): Reminder {
  if (reminder.status !== 'active' || reminder.type !== 'event') return reminder;
  const dueAt = parseIso(reminder.dueAt);
  if (dueAt === null || dueAt.getTime() > now.getTime()) return reminder;
  const repeat = activeRepeat(reminder);
  if (repeat === null) {
    return { ...reminder, status: 'done', completedAt: dueAt.toISOString() };
  }
  const next = nextOccurrence(repeat, dueAt, now);
  return isValidDate(next) ? { ...reminder, dueAt: next.toISOString() } : reminder;
}

/**
 * 1. Non-repeating active events with `dueAt <= now`: done, `completedAt = dueAt`.
 * 2. Repeating active events with `dueAt <= now`: `dueAt` advances to the next occurrence after `now`.
 * 3. Done reminders whose `completedAt` is older than 30 days are removed.
 */
export function applyMaintenance(reminders: Reminder[], now: Date): Reminder[] {
  const cutoff = now.getTime() - PRUNE_AFTER_MS;
  const result: Reminder[] = [];
  let changed = false;
  for (const reminder of reminders) {
    const settled = settlePastEvent(reminder, now);
    if (settled.status === 'done') {
      const completedAt = isoTime(settled.completedAt);
      if (completedAt !== null && completedAt < cutoff) {
        changed = true;
        continue;
      }
    }
    if (settled !== reminder) changed = true;
    result.push(settled);
  }
  return changed ? result : reminders;
}

// --- lists -------------------------------------------------------------------

/** `completedAt` falls on the same local calendar date as `now`. */
export function isCompletedToday(reminder: Reminder, now: Date): boolean {
  if (reminder.status !== 'done') return false;
  const completedAt = parseIso(reminder.completedAt);
  return completedAt !== null && isSameLocalDay(completedAt, now);
}

/** An active task whose deadline has passed (`dueAt < now`). */
export function isOverdue(reminder: Reminder, now: Date): boolean {
  if (reminder.type !== 'task' || reminder.status !== 'active') return false;
  const dueAt = isoTime(reminder.dueAt);
  return dueAt !== null && dueAt < now.getTime();
}

/** Number of active tasks (the badge on the Capture list button). */
export function activeTaskCount(reminders: Reminder[]): number {
  return reminders.filter((reminder) => reminder.type === 'task' && reminder.status === 'active')
    .length;
}

/** Ascending, with missing values last. */
function compareTimes(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a - b;
}

function byCreatedAt(a: Reminder, b: Reminder): number {
  return compareTimes(isoTime(a.createdAt), isoTime(b.createdAt));
}

/** Earliest `dueAt` first, reminders without one last, ties in creation order. */
function byDueAt(a: Reminder, b: Reminder): number {
  return compareTimes(isoTime(a.dueAt), isoTime(b.dueAt)) || byCreatedAt(a, b);
}

/** Most recently completed first, ties in creation order. */
function byCompletedAtDescending(a: Reminder, b: Reminder): number {
  return compareTimes(isoTime(b.completedAt), isoTime(a.completedAt)) || byCreatedAt(a, b);
}

function sectionFor(reminders: Reminder[], type: ReminderType, now: Date): Reminder[] {
  const ofType = reminders.filter((reminder) => reminder.type === type);
  const active = ofType.filter((reminder) => reminder.status === 'active');
  const doneToday = ofType.filter((reminder) => isCompletedToday(reminder, now));
  // Sorting by deadline already puts overdue tasks first: their deadline is the earliest.
  return [...active.sort(byDueAt), ...doneToday.sort(byCompletedAtDescending)];
}

/**
 * The two Reminders-screen sections, already filtered and sorted:
 * - todo: active tasks (overdue first, then by `dueAt` ascending, then no-deadline
 *   tasks by `createdAt` ascending), then tasks completed today (`completedAt` descending).
 * - comingUp: active events by `dueAt` ascending, then events completed today (`completedAt` descending).
 * Done items not completed today are hidden.
 */
export function buildSections(
  reminders: Reminder[],
  now: Date
): { todo: Reminder[]; comingUp: Reminder[] } {
  return {
    todo: sectionFor(reminders, 'task', now),
    comingUp: sectionFor(reminders, 'event', now),
  };
}

/** The row subtitle, exactly per the "List subtitles" table in SPEC.md. */
export function reminderSubtitle(reminder: Reminder, now: Date, settings: Settings): string {
  const dueAt = parseIso(reminder.dueAt);

  if (reminder.type === 'task') {
    if (reminder.status === 'done') return 'Done ✓';
    const nagging = `nagging every ${intervalLabel(settings.nagIntervalMinutes)}`;
    if (dueAt === null) return `No deadline · ${nagging}`;
    const due = `${relativeDay(dueAt, now)} · ${formatTime(dueAt)}`;
    if (dueAt.getTime() < now.getTime()) return `Overdue · was due ${due}`;
    const nagStartAt = parseIso(reminder.nagStartAt);
    if (nagStartAt === null || nagStartAt.getTime() <= now.getTime()) {
      return `Due ${due} · ${nagging}`;
    }
    return `Due ${due} · nags from ${formatTime(nagStartAt)}`;
  }

  if (reminder.status === 'done') {
    return dueAt === null ? 'Done' : `Done · ${formatWhen(dueAt, now)}`;
  }
  const repeat = activeRepeat(reminder);
  if (dueAt === null) return repeat === null ? '' : repeatLabel(repeat);
  if (repeat !== null) return `${repeatLabel(repeat)} · ${formatTime(dueAt)}`;
  return formatWhen(dueAt, now);
}
