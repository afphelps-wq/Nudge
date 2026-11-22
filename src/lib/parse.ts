/**
 * Rule-based capture parsing (SPEC.md "Parsing Rules"). No AI and no network:
 * chrono-node finds dates, everything else is the keyword rules below.
 *
 * Pure module: no React, React Native or Expo imports; `now` is always a parameter.
 */
import * as chrono from 'chrono-node';

import { defaultNagStart, nextFullHour } from '@/lib/reminders';
import { alignToRepeat, WEEKDAYS, WEEKENDS } from '@/lib/repeat';
import type { DraftReminder, ReminderType, Repeat, Settings } from '@/lib/types';

/** Longest capture text the app accepts (the Capture text box uses the same limit). */
export const MAX_CAPTURE_LENGTH = 300;

/** One sentence is split into at most this many reminders. */
export const MAX_PARTS = 5;

/** Same limit as the card's title input. */
const MAX_TITLE_LENGTH = 120;

/** A separator only splits the sentence when the word after it is one of these. */
export const ACTION_VERBS: readonly string[] = [
  'call',
  'text',
  'email',
  'buy',
  'get',
  'pick',
  'pay',
  'book',
  'schedule',
  'finish',
  'submit',
  'send',
  'start',
  'study',
  'read',
  'write',
  'review',
  'practice',
  'clean',
  'do',
  'go',
  'make',
  'take',
  'return',
  'cancel',
  'check',
  'order',
  'reply',
  'sign',
  'renew',
  'print',
  'wash',
  'water',
  'feed',
  'fix',
  'update',
  'prepare',
  'plan',
  'apply',
  'register',
  'file',
  'bring',
  'drop',
  'meet',
  'attend',
  'grab',
  'cook',
  'workout',
  'exercise',
  'walk',
  'run',
  'laundry',
  'vacuum',
  'charge',
];

/** Any of these (as a whole word or phrase) makes a reminder an event. */
export const EVENT_KEYWORDS: readonly string[] = [
  'meeting',
  'meet',
  'appointment',
  'appt',
  'dentist',
  'doctor',
  'doctors',
  'class',
  'lecture',
  'lab',
  'recitation',
  'exam',
  'midterm',
  'final',
  'quiz',
  'interview',
  'dinner',
  'lunch',
  'breakfast',
  'brunch',
  'coffee',
  'party',
  'concert',
  'game',
  'flight',
  'practice',
  'rehearsal',
  'office hours',
  'session',
  'event',
  'birthday',
  'haircut',
  'recital',
  'show',
  'movie',
  'wedding',
  'call with',
  'date with',
  'hangout',
  'game night',
  'therapy',
  'workout class',
  'tutoring',
];

// --- step 1: normalise -------------------------------------------------------

const LEADING_PHRASES: readonly string[] = [
  'remind me to',
  'remind me',
  'nudge me to',
  "don't forget to",
  'dont forget to',
  'i need to',
  'i have to',
  'i should',
  'please',
];

/**
 * One leading phrase, longest first so "remind me to" wins over "remind me".
 * The lookahead keeps it to whole words ("pleased", "I should've" are left alone);
 * dictation types a curly apostrophe, so both kinds are accepted.
 */
const LEADING_PHRASE = new RegExp(
  `^(?:${[...LEADING_PHRASES]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/'/g, "['\u2019]"))
    .join('|')})(?![\\w'\u2019])`,
  'i'
);

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

/** Punctuation the title never starts or ends with (the spec's `.,;:!-` plus the dashes iOS types). */
const LEADING_NOISE = /^[\s.,;:!\-\u2013\u2014]+/;
const TRAILING_NOISE = /[\s.,;:!\-\u2013\u2014]+$/;

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Cuts to `max` UTF-16 units without leaving half of a surrogate pair (an emoji) at the end. */
function clampLength(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return text.slice(0, end).trimEnd();
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Removes one leading phrase; text that is nothing but the phrase is kept as it is. */
function stripLeadingPhrase(text: string): string {
  const match = LEADING_PHRASE.exec(text);
  if (match === null) return text;
  const rest = text.slice(match[0].length).replace(LEADING_NOISE, '');
  return rest === '' ? text : rest;
}

/**
 * Makes capture text safe to send as the `text` route param. Expo Router's
 * `useLocalSearchParams` URL-decodes a second time, so a literal "%" has to be
 * pre-escaped or text like "50%41" would arrive changed.
 */
export function encodeCaptureParam(text: string): string {
  return text.replace(/%/g, '%25');
}

/**
 * Normalises whatever arrived in the `text` route param (it can come from a
 * deep link, so it is untrusted): first value if repeated, control characters
 * replaced by spaces, trimmed, and clamped to MAX_CAPTURE_LENGTH.
 */
export function cleanCaptureText(raw: string | string[] | undefined): string {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return '';
  return clampLength(collapseSpaces(value.replace(CONTROL_CHARACTERS, ' ')), MAX_CAPTURE_LENGTH);
}

// --- step 2: split into parts ------------------------------------------------

/** In order of precedence: at one position the more specific separator is tried first. */
const SEPARATORS: readonly string[] = [
  ';',
  ', and ',
  ', then ',
  ' and then ',
  ' and also ',
  ' then ',
  ' and ',
  ',',
];

const ACTION_VERB_SET = new Set(ACTION_VERBS);

/** The first word of `text`, lowercased, with ASCII punctuation and curly quotes stripped. */
function firstWord(text: string): string {
  const word = /^\s*(\S*)/.exec(text)?.[1] ?? '';
  return word.toLowerCase().replace(/[^a-z0-9\u00C0-\u1FFF]/g, '');
}

function splitParts(text: string): string[] {
  const pieces: { start: number; text: string }[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const position = index;
    const separator = SEPARATORS.find(
      (candidate) =>
        text.slice(position, position + candidate.length).toLowerCase() === candidate &&
        ACTION_VERB_SET.has(firstWord(text.slice(position + candidate.length)))
    );
    if (separator === undefined) {
      // Not a split: the separator stays in the text. Moving one character on
      // (not past it) lets ", and then call" still split at " and then ".
      index += 1;
    } else {
      pieces.push({ start, text: text.slice(start, index).trim() });
      start = index + separator.length;
      index = start;
    }
  }
  pieces.push({ start, text: text.slice(start).trim() });

  const parts = pieces.filter((piece) => piece.text !== '');
  if (parts.length <= MAX_PARTS) return parts.map((piece) => piece.text);
  // The extras are merged into the last allowed part with their separators intact.
  const kept = parts.slice(0, MAX_PARTS - 1).map((piece) => piece.text);
  kept.push(text.slice(parts[MAX_PARTS - 1].start).trim());
  return kept;
}

// --- step 3: repeat ----------------------------------------------------------

type ActiveRepeat = Exclude<Repeat, null>;

interface TextRange {
  start: number;
  end: number;
}

interface RepeatMatch {
  /** `null` for "every week" / "weekly": the weekday comes from the date found afterwards. */
  repeat: ActiveRepeat | null;
  /** The part with the repeat phrase taken out (a weekday phrase leaves its first day name behind). */
  text: string;
  /** Where that day name sits in `text`. */
  dayName: TextRange | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_PREFIXES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Full or 3-letter day names (plus the common "tues", "thur", "thurs"). */
const DAY =
  '(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
/**
 * Plural day names for "on <day>s". "tues", "weds" and "sats" are left out on
 * purpose: "dentist on Tues" is one Tuesday and "work on SATs" is an exam.
 */
const PLURAL_DAY =
  '(?:sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|suns|mons|thus|fris)';
const DAY_JOIN = '(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)';

const DAILY_PHRASE = /\b(?:every\s?day|each day|daily)\b/i;
const WEEKDAYS_PHRASE = /\b(?:every weekdays?|on weekdays|weekdays)\b/i;
const WEEKENDS_PHRASE = /\b(?:every weekends?|on weekends|weekends)\b/i;
const DAYS_PHRASE = new RegExp(
  `\\b(?:every\\s+${DAY}s?|on\\s+${PLURAL_DAY})(?:${DAY_JOIN}${DAY}s?)*\\b`,
  'i'
);
const WEEKLY_PHRASE = /\b(?:every week|weekly)\b/i;
const DAY_TOKEN = /\b(?:sun|mon|tue|wed|thu|fri|sat)/g;

/** Takes `match` out of `text`, leaving `replacement` (possibly empty) in its place. */
function replacePhrase(
  text: string,
  match: RegExpExecArray,
  replacement: string
): { text: string; dayName: TextRange | null } {
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index + match[0].length).trimStart();
  const start = before === '' ? 0 : before.length + 1;
  return {
    text: [before, replacement, after].filter((piece) => piece !== '').join(' '),
    dayName: replacement === '' ? null : { start, end: start + replacement.length },
  };
}

/** The spec's repeat table, checked in its listed order; the first match wins. */
function detectRepeat(part: string): RepeatMatch | null {
  const daily = DAILY_PHRASE.exec(part);
  if (daily !== null) {
    return { repeat: { kind: 'daily' }, ...replacePhrase(part, daily, '') };
  }
  const weekdays = WEEKDAYS_PHRASE.exec(part);
  if (weekdays !== null) {
    return {
      repeat: { kind: 'weekly', weekdays: [...WEEKDAYS] },
      ...replacePhrase(part, weekdays, ''),
    };
  }
  const weekends = WEEKENDS_PHRASE.exec(part);
  if (weekends !== null) {
    return {
      repeat: { kind: 'weekly', weekdays: [...WEEKENDS] },
      ...replacePhrase(part, weekends, ''),
    };
  }
  const days = DAYS_PHRASE.exec(part);
  if (days !== null) {
    const listed = (days[0].toLowerCase().match(DAY_TOKEN) ?? []).map((token) =>
      DAY_PREFIXES.indexOf(token)
    );
    if (listed.length > 0) {
      // The whole phrase becomes its first day, in the singular, so chrono
      // finds the first occurrence ("every Monday and Wednesday at 7" -> "Monday at 7").
      return {
        repeat: { kind: 'weekly', weekdays: [...new Set(listed)].sort((a, b) => a - b) },
        ...replacePhrase(part, days, DAY_NAMES[listed[0]]),
      };
    }
  }
  const weekly = WEEKLY_PHRASE.exec(part);
  if (weekly !== null) {
    return { repeat: null, ...replacePhrase(part, weekly, '') };
  }
  return null;
}

// --- steps 4 and 5: date, time and deadline words -----------------------------

interface FoundDate {
  /** What to cut from the title: the deadline word (if any) through the end of the date phrase. */
  range: TextRange;
  /** Set when a clock time was given. */
  dueAt: Date | null;
  /** Set instead when only a day was given: the picker's starting value. */
  preset: Date | null;
  isDeadline: boolean;
}

/**
 * A deadline word directly before the date phrase. chrono never includes the
 * word in its match, and it swallows "on"/"at" only before some kinds of date,
 * so one of those may still sit in between.
 */
const DEADLINE_BEFORE = /\b(?:by|before|due|until|no later than)(?:\s+(?:on|at|the))?[\s:\-\u2013]*$/i;

/** chrono implied an hour for these, so the preset keeps it instead of 9:00. */
const TIME_OF_DAY_TAGS = [
  'casualReference/tonight',
  'casualReference/evening',
  'casualReference/morning',
  'casualReference/afternoon',
];

const RELATIVE_PREFIX = /^(?:in|within|next|after|the day after)\b/i;
const RELATIVE_SUFFIX = /\b(?:from now|later)$/i;

/**
 * Matches that are not dates the user meant:
 * - a time with a time-zone offset that is not relative or "now": chrono reads
 *   "15-113" as 15:00 at UTC-11;
 * - a bare duration ("for 2 hours", "10 min"), which chrono turns into now + duration.
 */
function isJunk(result: chrono.ParsedResult): boolean {
  const tags = result.start.tags();
  const relative = tags.has('result/relativeDate');
  if (
    result.start.isCertain('timezoneOffset') &&
    !relative &&
    !tags.has('casualReference/now')
  ) {
    return true;
  }
  return relative && !RELATIVE_PREFIX.test(result.text) && !RELATIVE_SUFFIX.test(result.text);
}

function findDate(text: string, now: Date): FoundDate | null {
  try {
    const result = chrono.parse(text, now, { forwardDate: true }).find((item) => !isJunk(item));
    if (result === undefined) return null;

    const start = result.start;
    const tags = start.tags();
    const deadline = DEADLINE_BEFORE.exec(text.slice(0, result.index));
    const range = {
      start: deadline === null ? result.index : deadline.index,
      end: result.index + result.text.length,
    };
    const isDeadline = deadline !== null;

    if (!start.isCertain('hour')) {
      // A day with no clock time. "today"/"tomorrow" carry the reference time
      // and other dates carry 12:00, so the hour is always replaced, unless
      // chrono implied one ("tonight", "this evening").
      let preset = start.date();
      if (TIME_OF_DAY_TAGS.some((tag) => tags.has(tag))) {
        preset.setSeconds(0, 0);
      } else {
        preset.setHours(9, 0, 0, 0);
      }
      if (!isValidDate(preset)) return null;
      if (preset.getTime() <= now.getTime()) preset = nextFullHour(now);
      return { range, dueAt: null, preset, isDeadline };
    }

    // The raw 0-23 hour. chrono has already moved "at 8 tonight" to 20, so
    // converting to a 12-hour clock first would shift it a second time.
    const hour = start.get('hour') ?? 0;
    const minute = start.get('minute') ?? 0;
    const toPm =
      !start.isCertain('meridiem') &&
      hour >= 1 &&
      hour <= 7 &&
      !tags.has('casualReference/morning');
    const timeOnly =
      !start.isCertain('day') && !start.isCertain('weekday') && !start.isCertain('month');

    let dueAt: Date;
    if (timeOnly) {
      // chrono has already rolled the AM reading of "at 7" to tomorrow, so the
      // time is rebuilt on today's date before deciding whether it has passed.
      dueAt = new Date(now);
      dueAt.setHours(toPm ? hour + 12 : hour, minute, 0, 0);
      if (dueAt.getTime() <= now.getTime()) dueAt.setDate(dueAt.getDate() + 1);
    } else {
      dueAt = start.date();
      if (toPm) dueAt.setHours(hour + 12);
      dueAt.setSeconds(0, 0);
    }
    if (!isValidDate(dueAt)) return null;
    return { range, dueAt, preset: null, isDeadline };
  } catch {
    // A date library failure must not lose the reminder: carry on as "no date".
    return null;
  }
}

// --- step 6: type -------------------------------------------------------------

const EVENT_KEYWORD = new RegExp(
  `\\b(?:${EVENT_KEYWORDS.map((keyword) => keyword.replace(/ /g, '\\s+')).join('|')})\\b`,
  'i'
);

/** "with Sam": tested on the original casing. */
const WITH_NAME = /\bwith [A-Z]/;

// --- step 8: title ------------------------------------------------------------

const DANGLING_WORDS = 'at|on|by|before|due|until|for|this|next|the|in|to';
const LEADING_DANGLING = new RegExp(`^(?:${DANGLING_WORDS})(?=\\s|$)`, 'i');
const TRAILING_DANGLING = new RegExp(`(?:^|\\s)(?:${DANGLING_WORDS})$`, 'i');

function removeRanges(text: string, ranges: TextRange[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = '';
  let position = 0;
  for (const range of sorted) {
    if (range.start > position) result += `${text.slice(position, range.start)} `;
    position = Math.max(position, range.end);
  }
  return result + text.slice(position);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildTitle(text: string, ranges: TextRange[], fallback: string): string {
  let title = collapseSpaces(removeRanges(text, ranges));
  // Taking one dangling word off can expose another ("… due on"), so repeat until stable.
  for (;;) {
    const next = title
      .replace(LEADING_NOISE, '')
      .replace(TRAILING_NOISE, '')
      .replace(LEADING_DANGLING, '')
      .replace(TRAILING_DANGLING, '');
    if (next === title) break;
    title = next;
  }
  return clampLength(capitalize(title === '' ? fallback : title), MAX_TITLE_LENGTH);
}

// --- putting it together ------------------------------------------------------

function parsePart(part: string, key: string, now: Date, settings: Settings): DraftReminder {
  const repeatMatch = detectRepeat(part);
  const text = repeatMatch === null ? part : repeatMatch.text;
  const found = findDate(text, now);

  let type: ReminderType;
  if (repeatMatch !== null) {
    type = 'event';
  } else if (found !== null && found.isDeadline) {
    type = 'task';
  } else if (EVENT_KEYWORD.test(part) || WITH_NAME.test(part)) {
    type = 'event';
  } else {
    type = 'task';
  }

  // With no date at all the card asks for one, starting at the next full hour.
  let dueAt = found === null ? null : found.dueAt;
  let pickerPreset = found?.preset ?? nextFullHour(now);

  let repeat: Repeat = null;
  if (repeatMatch !== null) {
    const active: ActiveRepeat = repeatMatch.repeat ?? {
      kind: 'weekly',
      weekdays: [(dueAt ?? pickerPreset).getDay()],
    };
    repeat = active;
    // A weekly repeat whose first date falls on a day it does not include
    // ("standup every weekday at 9am" typed on a Saturday) starts on its next
    // matching day instead, at the same time.
    if (dueAt === null) {
      pickerPreset = alignToRepeat(pickerPreset, active);
    } else {
      dueAt = alignToRepeat(dueAt, active);
    }
  }

  let nagStartAt: Date | null = null;
  if (type === 'task' && dueAt !== null) {
    const start = defaultNagStart(dueAt, now, settings);
    nagStartAt = isValidDate(start) ? start : new Date(now);
  }

  // The reinserted day name goes too when chrono did not take it as the date.
  const ranges: TextRange[] = found === null ? [] : [found.range];
  if (repeatMatch !== null && repeatMatch.dayName !== null) ranges.push(repeatMatch.dayName);

  return {
    key,
    text: buildTitle(text, ranges, part),
    type,
    dueAt,
    needsTime: dueAt === null,
    pickerPreset: dueAt === null ? pickerPreset : new Date(dueAt),
    nagStartAt,
    repeat,
  };
}

/** One task card that asks for a time: what the user typed is never lost. */
function fallbackDraft(text: string, key: string, now: Date): DraftReminder {
  return {
    key,
    text: clampLength(text, MAX_TITLE_LENGTH),
    type: 'task',
    dueAt: null,
    needsTime: true,
    pickerPreset: nextFullHour(now),
    nagStartAt: null,
    repeat: null,
  };
}

/**
 * Turns capture text into draft cards, following SPEC.md steps 1–8.
 * Returns [] for empty/whitespace-only text; never throws.
 */
export function parseCapture(text: string, now: Date, settings: Settings): DraftReminder[] {
  const cleaned = cleanCaptureText(text);
  if (cleaned === '') return [];
  // Every caller passes a real clock reading; this only keeps a bad one from
  // turning into Invalid Date values, which crash the native date picker.
  const reference = isValidDate(now) ? now : new Date();
  const keyBase = reference.getTime().toString(36);
  const normalized = stripLeadingPhrase(cleaned);
  try {
    const parts = splitParts(normalized);
    if (parts.length === 0) return [fallbackDraft(normalized, `${keyBase}-0`, reference)];
    return parts.map((part, index) => parsePart(part, `${keyBase}-${index}`, reference, settings));
  } catch {
    return [fallbackDraft(normalized, `${keyBase}-0`, reference)];
  }
}
