/**
 * AsyncStorage persistence for reminders and settings.
 *
 * Everything read from disk is treated as untrusted: it is validated field by
 * field, and anything malformed is dropped (reminders) or replaced by the
 * default (settings). Loading and saving never throw.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { hhmmToDate, parseHHmm, toHHmm } from '@/lib/format';
import { normalizeRepeat } from '@/lib/repeat';
import {
  DEFAULT_SETTINGS,
  type DefaultNagStartHours,
  type EventLeadMinutes,
  type NagIntervalMinutes,
  type Reminder,
  type Repeat,
  type Settings,
} from '@/lib/types';

export const REMINDERS_KEY = 'nudge.reminders.v1';
export const SETTINGS_KEY = 'nudge.settings.v1';

/** Upper bound on stored reminders, so a damaged file can never produce an unbounded list. */
export const MAX_REMINDERS = 1000;

/** Same limit as the title input on the card. */
const MAX_TEXT_LENGTH = 120;

const EVENT_LEAD_OPTIONS: readonly EventLeadMinutes[] = [0, 10, 15, 30, 60];
const NAG_INTERVAL_OPTIONS: readonly NagIntervalMinutes[] = [15, 30, 60, 120];
const NAG_START_OPTIONS: readonly DefaultNagStartHours[] = [1, 2, 3, 6];

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Reads an own property only, so nothing inherited from a prototype is ever picked up. */
function own(source: PlainObject, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

/** A parsable date string in canonical ISO form, or undefined when it is not one. */
function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** null or missing → null; a parsable date string → ISO; anything else → undefined (invalid). */
function toNullableIso(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

/** null or missing → null; a well-formed repeat → its canonical form; anything else → undefined (invalid). */
function toRepeat(value: unknown): Repeat | undefined {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return undefined;
  const kind = own(value, 'kind');
  if (kind === 'daily') return { kind: 'daily' };
  if (kind !== 'weekly') return undefined;
  const weekdays = own(value, 'weekdays');
  if (!Array.isArray(weekdays)) return undefined;
  const days: unknown[] = weekdays;
  if (!days.every((day): day is number => typeof day === 'number')) return undefined;
  return normalizeRepeat({ kind: 'weekly', weekdays: [...days] });
}

/** Trimmed title, at most MAX_TEXT_LENGTH characters. */
function clampText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_TEXT_LENGTH) return trimmed;
  let clipped = trimmed.slice(0, MAX_TEXT_LENGTH);
  // Cutting by UTF-16 units can split an emoji; do not leave half of one behind.
  const last = clipped.charCodeAt(clipped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1);
  return clipped.trimEnd();
}

/** One stored item → a well-formed Reminder, or null when it has to be dropped. */
function sanitizeReminder(raw: unknown): Reminder | null {
  if (!isPlainObject(raw)) return null;

  const id = own(raw, 'id');
  const rawText = own(raw, 'text');
  const type = own(raw, 'type');
  const status = own(raw, 'status');
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof rawText !== 'string') return null;
  if (type !== 'event' && type !== 'task') return null;
  if (status !== 'active' && status !== 'done') return null;

  const text = clampText(rawText);
  if (text.length === 0) return null;

  const createdAt = toIso(own(raw, 'createdAt'));
  const dueAt = toNullableIso(own(raw, 'dueAt'));
  const nagStartAt = toNullableIso(own(raw, 'nagStartAt'));
  const completedAt = toNullableIso(own(raw, 'completedAt'));
  const repeat = toRepeat(own(raw, 'repeat'));
  if (
    createdAt === undefined ||
    dueAt === undefined ||
    nagStartAt === undefined ||
    completedAt === undefined ||
    repeat === undefined
  ) {
    return null;
  }

  // An event without a time cannot be shown or scheduled.
  if (type === 'event' && dueAt === null) return null;

  // Built from the known fields only (never a spread of the stored object), so
  // unknown keys cannot ride along. The model invariants are enforced here too.
  return {
    id,
    text,
    type,
    dueAt,
    nagStartAt: type === 'event' ? null : (nagStartAt ?? createdAt),
    repeat: type === 'event' ? repeat : null,
    status,
    completedAt: status === 'done' ? (completedAt ?? createdAt) : null,
    createdAt,
  };
}

/** Keeps only well-formed reminders from parsed JSON; anything else is dropped. Pure. */
export function sanitizeReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return [];
  const items: unknown[] = raw;
  const result: Reminder[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (result.length >= MAX_REMINDERS) break;
    const reminder = sanitizeReminder(item);
    // Of two reminders sharing an id, the first one wins.
    if (reminder === null || seenIds.has(reminder.id)) continue;
    seenIds.add(reminder.id);
    result.push(reminder);
  }
  return result;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A valid "HH:mm" string in its two-digit form, or the fallback. */
function toClockTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || parseHHmm(value) === null) return fallback;
  return toHHmm(hhmmToDate(value));
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  const match = allowed.find((option) => option === value);
  return match === undefined ? fallback : match;
}

/**
 * Known, valid settings fields merged over DEFAULT_SETTINGS; unknown keys are ignored. Pure.
 * Always returns a new object (with a new `quietHours`), never DEFAULT_SETTINGS itself.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const source = isPlainObject(raw) ? raw : {};
  const rawQuietHours = own(source, 'quietHours');
  const quietHours = isPlainObject(rawQuietHours) ? rawQuietHours : {};
  const defaults = DEFAULT_SETTINGS;
  return {
    quietHours: {
      enabled: toBoolean(own(quietHours, 'enabled'), defaults.quietHours.enabled),
      start: toClockTime(own(quietHours, 'start'), defaults.quietHours.start),
      end: toClockTime(own(quietHours, 'end'), defaults.quietHours.end),
    },
    eventLeadMinutes: oneOf(
      own(source, 'eventLeadMinutes'),
      EVENT_LEAD_OPTIONS,
      defaults.eventLeadMinutes
    ),
    nagIntervalMinutes: oneOf(
      own(source, 'nagIntervalMinutes'),
      NAG_INTERVAL_OPTIONS,
      defaults.nagIntervalMinutes
    ),
    defaultNagStartHours: oneOf(
      own(source, 'defaultNagStartHours'),
      NAG_START_OPTIONS,
      defaults.defaultNagStartHours
    ),
    hapticsEnabled: toBoolean(own(source, 'hapticsEnabled'), defaults.hapticsEnabled),
    hasAskedNotificationPermission: toBoolean(
      own(source, 'hasAskedNotificationPermission'),
      defaults.hasAskedNotificationPermission
    ),
  };
}

function parseStored(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    // The engine's own message can quote part of the stored text (the user's
    // reminders), and the caller logs whatever is thrown here.
    throw new Error('stored value is not valid JSON');
  }
}

/** What `loadAll()` found on disk. */
export interface StoredData {
  reminders: Reminder[];
  settings: Settings;
  /**
   * True when the key could not be read at all. That is different from an empty
   * or damaged value: the data may still be there (iOS refuses file reads in some
   * states, e.g. a background launch on a locked phone), so it must not be
   * overwritten with the empty fallback returned here.
   */
  remindersUnread: boolean;
  settingsUnread: boolean;
}

async function readReminders(): Promise<{ reminders: Reminder[]; unread: boolean }> {
  let stored: string | null;
  try {
    stored = await AsyncStorage.getItem(REMINDERS_KEY);
  } catch (error) {
    console.warn('[nudge] could not load reminders', error);
    return { reminders: [], unread: true };
  }
  if (typeof stored !== 'string') return { reminders: [], unread: false };
  try {
    return { reminders: sanitizeReminders(parseStored(stored)), unread: false };
  } catch (error) {
    // Readable but not usable: there is nothing here worth protecting from a later save.
    console.warn('[nudge] could not load reminders', error);
    return { reminders: [], unread: false };
  }
}

async function readSettings(): Promise<{ settings: Settings; unread: boolean }> {
  let stored: string | null;
  try {
    stored = await AsyncStorage.getItem(SETTINGS_KEY);
  } catch (error) {
    console.warn('[nudge] could not load settings', error);
    return { settings: sanitizeSettings(null), unread: true };
  }
  if (typeof stored !== 'string') return { settings: sanitizeSettings(null), unread: false };
  try {
    return { settings: sanitizeSettings(parseStored(stored)), unread: false };
  } catch (error) {
    console.warn('[nudge] could not load settings', error);
    return { settings: sanitizeSettings(null), unread: false };
  }
}

/** Resolves [] (after a `console.warn`) when reading or parsing fails. */
export async function loadReminders(): Promise<Reminder[]> {
  return (await readReminders()).reminders;
}

/** Resolves a fresh copy of DEFAULT_SETTINGS (after a `console.warn`) when reading or parsing fails. */
export async function loadSettings(): Promise<Settings> {
  return (await readSettings()).settings;
}

/**
 * Reads both keys and says, for each, whether the read itself failed. Never
 * rejects: a key that cannot be read comes back as empty / defaults with its
 * `…Unread` flag set.
 */
export async function loadAll(): Promise<StoredData> {
  const [reminders, settings] = await Promise.all([readReminders(), readSettings()]);
  return {
    reminders: reminders.reminders,
    settings: settings.settings,
    remindersUnread: reminders.unread,
    settingsUnread: settings.unread,
  };
}

/** The last write queued for each key; the next write to that key waits for it. */
const pendingWrites = new Map<string, Promise<void>>();

function write(key: string, value: unknown, failureMessage: string): Promise<void> {
  let json: string;
  try {
    // Serialised now, so what gets written is the state at the time of the call.
    json = JSON.stringify(value);
  } catch (error) {
    console.warn(failureMessage, error);
    return Promise.resolve();
  }
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  // `previous` never rejects (each link ends in the catch below), so writes to
  // one key land in call order and a failed write cannot block the next one.
  const next = previous
    .then(() => AsyncStorage.setItem(key, json))
    .catch((error: unknown) => {
      console.warn(failureMessage, error);
    });
  pendingWrites.set(key, next);
  return next;
}

/** Full-replace write. Writes to one key are applied in call order; failures are `console.warn`ed. */
export function saveReminders(reminders: Reminder[]): Promise<void> {
  return write(REMINDERS_KEY, reminders, '[nudge] could not save reminders');
}

/** Full-replace write. Writes to one key are applied in call order; failures are `console.warn`ed. */
export function saveSettings(settings: Settings): Promise<void> {
  return write(SETTINGS_KEY, settings, '[nudge] could not save settings');
}
