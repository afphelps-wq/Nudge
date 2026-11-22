/**
 * Local notifications (expo-notifications): setup, permission, the single
 * `rescheduleAllNotifications()` source of truth, and response handling.
 *
 * This module never imports the store or the router. The store passes a
 * snapshot getter in, and the root layout passes the response dependencies in,
 * which keeps the module free of import cycles and testable under Node.
 */
import * as Notifications from 'expo-notifications';
import { LogBox } from 'react-native';

import { formatTime, leadLabel, parseHHmm } from '@/lib/format';
import {
  alignToRepeat,
  nextOccurrence,
  normalizeRepeat,
  occurrencesUntil,
  type ActiveRepeat,
} from '@/lib/repeat';
import type { QuietHours, Reminder, Repeat, Settings } from '@/lib/types';

/** Category that carries the "Done ✓" action. Identifiers must not contain "-" or ":". */
export const TASK_CATEGORY = 'nudgeTask';
export const DONE_ACTION = 'done';

/** iOS allows 64 pending local notifications; stay under it. */
export const MAX_SCHEDULED = 60;
/** Tasks are scheduled this far ahead, at most MAX_NAGS_PER_TASK each. */
export const NAG_WINDOW_MS = 48 * 3_600_000;
export const MAX_NAGS_PER_TASK = 12;
/** Repeating events are scheduled this far ahead. */
export const EVENT_WINDOW_MS = 7 * 86_400_000;

export interface NotificationCandidate {
  date: Date;
  title: string;
  body: string;
  /** Set to TASK_CATEGORY for task nags; omitted for events. */
  categoryIdentifier?: string;
  data: { reminderId: string };
}

export interface ScheduleSnapshot {
  reminders: Reminder[];
  settings: Settings;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/** What `handleResponse` needs from the rest of the app (injected by the root layout). */
export interface ResponseDeps {
  /** Resolves once reminders and settings have been loaded from storage. */
  whenLoaded: () => Promise<void>;
  /** Marks an active reminder done, persists and reschedules (store's `markDoneFromNotification`). */
  markDone: (reminderId: string) => void;
  /** Opens the Reminders screen once the navigator is ready. */
  openReminders: () => void;
}

const MINUTE_MS = 60_000;
/** Anything due this soon is dropped: iOS rejects a trigger that is not in the future. */
const MIN_LEAD_MS = 5_000;

// --- pure scheduling logic (unit-tested) -------------------------------------

interface QuietWindow {
  /** Minutes after local midnight. */
  start: number;
  end: number;
}

/** The usable quiet period, or null when it is off, unreadable or empty (`start === end`). */
function quietWindow(quietHours: QuietHours): QuietWindow | null {
  if (!quietHours?.enabled) return null;
  const start = parseHHmm(quietHours.start);
  const end = parseHHmm(quietHours.end);
  if (start === null || end === null || start === end) return null;
  return { start, end };
}

function isInsideWindow(date: Date, window: QuietWindow): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return window.start < window.end
    ? minutes >= window.start && minutes < window.end
    : minutes >= window.start || minutes < window.end;
}

/** The first local `endMinutes` o'clock strictly after `date`. */
function nextTimeOfDayAfter(date: Date, endMinutes: number): Date {
  const hours = Math.floor(endMinutes / 60);
  const minutes = endMinutes % 60;
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  if (result.getTime() <= date.getTime()) {
    // Calendar arithmetic (not +24 h) keeps the wall-clock time across daylight-saving changes.
    result.setDate(result.getDate() + 1);
    result.setHours(hours, minutes, 0, 0);
  }
  return result;
}

/**
 * Quiet-hours check on the local time of `date`. With `start < end` the quiet
 * period is `start <= m < end`; otherwise it crosses midnight: `m >= start || m < end`.
 * Always false when quiet hours are disabled (or `start === end`).
 */
export function isQuietTime(date: Date, quietHours: QuietHours): boolean {
  const window = quietWindow(quietHours);
  return window !== null && isInsideWindow(date, window);
}

/**
 * The next quiet-hours end time strictly after `date`. Only `quietHours.end`
 * matters here; if it is not a valid "HH:mm" the date is returned unchanged.
 */
export function nextQuietEnd(date: Date, quietHours: QuietHours): Date {
  const end = parseHHmm(quietHours?.end);
  return end === null ? new Date(date) : nextTimeOfDayAfter(date, end);
}

const NAG_COPY: readonly { title: (text: string) => string; body: string }[] = [
  { title: (text) => `⏰ ${text}`, body: 'Time to get this done.' },
  { title: (text) => `Still on your list: ${text}`, body: "Tap Done when it's finished." },
  { title: (text) => `${text} is still waiting 👀`, body: "You've got this. Knock it out." },
  { title: (text) => `Hey. ${text}. Seriously.`, body: "Nudge isn't going away until it's done." },
  { title: (text) => `🚨 ${text}: still not done`, body: 'Do it now, then tap Done to make me stop.' },
];

/** Escalating nag copy by level (level >= 4 uses the last row); `overdue` prefixes the title with "Overdue: ". */
export function nagMessage(
  text: string,
  level: number,
  overdue: boolean
): { title: string; body: string } {
  const last = NAG_COPY.length - 1;
  const row = level >= last ? last : level >= 0 ? Math.floor(level) : 0;
  const copy = NAG_COPY[row];
  const title = copy.title(text);
  return { title: overdue ? `Overdue: ${title}` : title, body: copy.body };
}

/** A stored ISO date, or null when it is missing or does not parse. */
function parseDate(iso: string | null): Date | null {
  if (typeof iso !== 'string') return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A minutes setting that can be used in arithmetic: finite and positive, otherwise 0. */
function usableMinutes(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The repeat rule in canonical form, or null for "does not repeat" and for anything malformed. */
function usableRepeat(repeat: Repeat): ActiveRepeat | null {
  if (repeat === null || typeof repeat !== 'object') return null;
  if (repeat.kind === 'daily') return { kind: 'daily' };
  if (repeat.kind === 'weekly' && Array.isArray(repeat.weekdays)) return normalizeRepeat(repeat);
  return null;
}

/** The heads-up for one event occurrence, or null when the occurrence has already started. */
function eventCandidate(
  reminder: Reminder,
  occurrence: Date,
  leadMinutes: number,
  nowMs: number
): NotificationCandidate | null {
  const startMs = occurrence.getTime();
  const headsUpMs = startMs - leadMinutes * MINUTE_MS;
  const title = `📅 ${reminder.text}`;
  const time = formatTime(occurrence);
  const data = { reminderId: reminder.id };
  if (headsUpMs > nowMs) {
    const body =
      leadMinutes === 0
        ? `Starting now · ${time}`
        : `Starts in ${leadLabel(leadMinutes)} · ${time}`;
    return { date: new Date(headsUpMs), title, body, data };
  }
  // Already inside the heads-up window: notify at the start instead.
  if (startMs > nowMs) {
    return { date: new Date(startMs), title, body: `Starting now · ${time}`, data };
  }
  return null;
}

function eventCandidates(reminder: Reminder, settings: Settings, now: Date): NotificationCandidate[] {
  const due = parseDate(reminder.dueAt);
  if (due === null) return [];
  const nowMs = now.getTime();
  const leadMinutes = usableMinutes(settings.eventLeadMinutes);
  const repeat = usableRepeat(reminder.repeat);

  let occurrences: Date[];
  if (repeat === null) {
    occurrences = [due];
  } else {
    // Safety net: a stored `dueAt` on a day the rule does not allow is not an
    // occurrence, so the series starts on the next allowed day at the same time.
    const start = alignToRepeat(due, repeat);
    // Occurrences that have already passed produce nothing, so a stale `dueAt`
    // starts at the first one still ahead instead of using up the list's bound.
    const first = start.getTime() > nowMs ? start : nextOccurrence(repeat, due, now);
    occurrences = occurrencesUntil(repeat, first, new Date(nowMs + EVENT_WINDOW_MS));
  }

  const result: NotificationCandidate[] = [];
  for (const occurrence of occurrences) {
    const candidate = eventCandidate(reminder, occurrence, leadMinutes, nowMs);
    if (candidate !== null) result.push(candidate);
  }
  return result;
}

function taskCandidates(reminder: Reminder, settings: Settings, now: Date): NotificationCandidate[] {
  const nagStart = parseDate(reminder.nagStartAt);
  if (nagStart === null) return [];
  const hasDeadline = reminder.dueAt != null;
  const due = hasDeadline ? parseDate(reminder.dueAt) : null;
  if (hasDeadline && due === null) return [];
  const intervalMs = usableMinutes(settings.nagIntervalMinutes) * MINUTE_MS;
  if (intervalMs <= 0) return [];

  const window = quietWindow(settings.quietHours);
  const startMs = nagStart.getTime();
  const nowMs = now.getTime();
  const windowEndMs = nowMs + NAG_WINDOW_MS;
  const k0 = Math.max(0, Math.ceil((nowMs - startMs) / intervalMs));
  let t = startMs + k0 * intervalMs;

  const result: NotificationCandidate[] = [];
  // Every pass either pushes or leaves the loop, so it ends within MAX_NAGS_PER_TASK passes.
  while (t < windowEndMs && result.length < MAX_NAGS_PER_TASK) {
    if (window !== null && isInsideWindow(new Date(t), window)) {
      t = nextTimeOfDayAfter(new Date(t), window.end).getTime();
      // The shift can carry the nag past the 48 h window.
      if (!(t < windowEndMs)) break;
    }
    const level = Math.floor((t - startMs) / intervalMs);
    const overdue = due !== null && t > due.getTime();
    result.push({
      date: new Date(t),
      ...nagMessage(reminder.text, level, overdue),
      categoryIdentifier: TASK_CATEGORY,
      data: { reminderId: reminder.id },
    });
    t += intervalMs;
  }
  return result;
}

/** Only active, well-formed reminders are scheduled; anything else is skipped rather than trusted. */
function isSchedulable(reminder: Reminder): boolean {
  return (
    reminder != null &&
    reminder.status === 'active' &&
    typeof reminder.id === 'string' &&
    reminder.id !== '' &&
    typeof reminder.text === 'string'
  );
}

/**
 * SPEC.md "rescheduleAllNotifications" steps 3–4: every candidate for the given
 * reminders, sorted by date, with anything `<= now + 5s` dropped and only the
 * first MAX_SCHEDULED kept.
 */
export function buildCandidates(
  reminders: Reminder[],
  settings: Settings,
  now: Date
): NotificationCandidate[] {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs) || !Array.isArray(reminders)) return [];

  const candidates: NotificationCandidate[] = [];
  for (const reminder of reminders) {
    if (!isSchedulable(reminder)) continue;
    if (reminder.type === 'event') {
      candidates.push(...eventCandidates(reminder, settings, now));
    } else if (reminder.type === 'task') {
      candidates.push(...taskCandidates(reminder, settings, now));
    }
  }

  const earliestMs = nowMs + MIN_LEAD_MS;
  return candidates
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .filter((candidate) => candidate.date.getTime() > earliestMs)
    .slice(0, MAX_SCHEDULED);
}

// --- device-facing API ---------------------------------------------------------

/** The two push-support warnings expo-notifications prints in Expo Go; this app is local-only. */
const EXPO_GO_WARNINGS = [/not fully supported in Expo Go/, /removed from Expo Go/];

const TEST_NUDGE_DELAY_SECONDS = 5;
/**
 * A cancelled test nudge is only put back while it is at least this far away:
 * iOS truncates a date trigger to whole seconds, so anything closer could
 * already be in the past by the time it is scheduled.
 */
const TEST_NUDGE_MIN_REMAINING_MS = 1_000;

let handlerInstalled = false;
let categoryRegistration: Promise<boolean> | null = null;

async function registerCategory(): Promise<boolean> {
  try {
    await Notifications.setNotificationCategoryAsync(TASK_CATEGORY, [
      {
        identifier: DONE_ACTION,
        buttonTitle: 'Done ✓',
        // Must be explicit: left out, iOS treats the action differently from the documented default.
        options: { opensAppToForeground: false },
      },
    ]);
    return true;
  } catch (error) {
    console.warn('[nudge] could not register the notification category', error);
    return false;
  }
}

/** Registers the "Done ✓" category once; a failed attempt is forgotten so the next call retries. */
function ensureCategory(): Promise<boolean> {
  if (categoryRegistration === null) {
    const attempt = registerCategory();
    categoryRegistration = attempt;
    void attempt.then((registered) => {
      if (!registered && categoryRegistration === attempt) categoryRegistration = null;
    });
  }
  return categoryRegistration;
}

/** Installs the foreground handler and registers the "Done ✓" category. Idempotent; never throws. */
export function setupNotifications(): void {
  if (!handlerInstalled) {
    try {
      LogBox.ignoreLogs(EXPO_GO_WARNINGS);
    } catch (error) {
      console.warn('[nudge] could not silence the Expo Go notification warnings', error);
    }
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerInstalled = true;
    } catch (error) {
      console.warn('[nudge] could not install the notification handler', error);
    }
  }
  void ensureCategory();
}

function toPermissionState(status: Notifications.NotificationPermissionsStatus): PermissionState {
  // Nudge only ever asks for full authorisation, so `granted` is the whole answer.
  if (status.granted) return 'granted';
  return status.status === 'denied' ? 'denied' : 'undetermined';
}

/** Current notification permission. Never rejects ('undetermined' on error). */
export async function getPermissionState(): Promise<PermissionState> {
  try {
    return toPermissionState(await Notifications.getPermissionsAsync());
  } catch (error) {
    console.warn('[nudge] could not read the notification permission', error);
    return 'undetermined';
  }
}

/** Shows the system permission prompt if it can still be shown. Resolves true when granted; never rejects. */
export async function requestPermission(): Promise<boolean> {
  try {
    return toPermissionState(await Notifications.requestPermissionsAsync()) === 'granted';
  } catch (error) {
    console.warn('[nudge] could not request the notification permission', error);
    return false;
  }
}

function noop(): void {}

/** Tail of the serial queue. It never rejects, so a failed operation cannot block the next one. */
let queueTail: Promise<void> = Promise.resolve();

/**
 * Runs `operation` after everything queued before it. Cancelling and scheduling
 * are separate native calls, so two operations running at once would interleave
 * them and leave duplicated or missing notifications. A failure is
 * `console.warn`ed and resolves `fallback`.
 */
function enqueue<T>(failureTag: string, fallback: T, operation: () => Promise<T>): Promise<T> {
  const result = queueTail.then(operation).catch((error: unknown) => {
    console.warn(`[nudge] ${failureTag}`, error);
    return fallback;
  });
  queueTail = result.then(noop, noop);
  return result;
}

/** Fire time (epoch ms) of a test nudge that may still be pending, so a reschedule can put it back. */
let pendingTestNudgeAt: number | null = null;

function testNudgeContent(): Notifications.NotificationContentInput {
  return {
    title: '⏰ Test nudge',
    body: 'This is what a nag looks like. Tap Done to try it.',
    categoryIdentifier: TASK_CATEGORY,
    // No `reminderId` key at all: a null would reach iOS as NSNull, which userInfo cannot hold.
    data: { test: true },
    sound: true,
  };
}

/** Puts a still-pending test nudge back after a reschedule has cancelled it. */
async function restoreTestNudge(): Promise<void> {
  const fireAt = pendingTestNudgeAt;
  if (fireAt === null) return;
  if (fireAt - Date.now() <= TEST_NUDGE_MIN_REMAINING_MS) {
    pendingTestNudgeAt = null;
    return;
  }
  try {
    await Notifications.scheduleNotificationAsync({
      content: testNudgeContent(),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  } catch (error) {
    console.warn('[nudge] could not restore the test nudge', error);
  }
}

function toRequest(candidate: NotificationCandidate): Notifications.NotificationRequestInput {
  const content: Notifications.NotificationContentInput = {
    title: candidate.title,
    body: candidate.body,
    data: candidate.data,
    sound: true,
  };
  if (candidate.categoryIdentifier) content.categoryIdentifier = candidate.categoryIdentifier;
  return {
    content,
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: candidate.date },
  };
}

/** The getter passed by the most recent caller; read when a run builds its schedule. */
let latestGetSnapshot: (() => ScheduleSnapshot) | null = null;
/** The run that is queued but has not started yet; calls made before it starts share it. */
let queuedRun: Promise<void> | null = null;

async function runReschedule(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    // Scheduling on top of a set that was not cleared would duplicate every notification.
    console.warn('[nudge] could not cancel the scheduled notifications', error);
    return;
  }
  if ((await getPermissionState()) !== 'granted') return;
  await ensureCategory();
  await restoreTestNudge();

  let candidates: NotificationCandidate[];
  try {
    if (latestGetSnapshot === null) return;
    const snapshot = latestGetSnapshot();
    candidates = buildCandidates(snapshot.reminders, snapshot.settings, new Date());
  } catch (error) {
    console.warn('[nudge] could not build the notification schedule', error);
    return;
  }

  for (const candidate of candidates) {
    try {
      await Notifications.scheduleNotificationAsync(toRequest(candidate));
    } catch (error) {
      // One notification failing must not cost the rest; the reminder itself is already saved.
      console.warn('[nudge] could not schedule a notification', error);
    }
  }
}

/**
 * Rebuilds every scheduled notification from scratch: cancel all, stop if
 * permission is not granted, then schedule `buildCandidates(...)`.
 * Runs are serialised and coalesced (overlapping calls would otherwise
 * interleave cancel/schedule and duplicate notifications); the snapshot is read
 * when a run actually starts. Never rejects: failures are `console.warn`ed.
 */
export function rescheduleAllNotifications(getSnapshot: () => ScheduleSnapshot): Promise<void> {
  latestGetSnapshot = getSnapshot;
  if (queuedRun === null) {
    queuedRun = enqueue<void>('could not reschedule notifications', undefined, () => {
      // From here the run is in flight, so a later call needs a new run to see its changes.
      queuedRun = null;
      return runReschedule();
    });
  }
  return queuedRun;
}

/** "Delete all nudges": cancels everything scheduled (including a pending test nudge). Never rejects. */
export function cancelAllNotifications(): Promise<void> {
  return enqueue<void>('could not cancel the scheduled notifications', undefined, async () => {
    pendingTestNudgeAt = null;
    await Notifications.cancelAllScheduledNotificationsAsync();
  });
}

/**
 * Settings "Send a test nudge": one notification 5 seconds from now with the
 * Done action. Resolves false (and schedules nothing) when permission is not
 * granted or scheduling fails. A reschedule that runs within those 5 seconds
 * re-adds the test nudge instead of silently cancelling it.
 */
export function sendTestNudge(): Promise<boolean> {
  return enqueue<boolean>('could not send the test nudge', false, async () => {
    if ((await getPermissionState()) !== 'granted') return false;
    await ensureCategory();
    const fireAt = Date.now() + TEST_NUDGE_DELAY_SECONDS * 1_000;
    await Notifications.scheduleNotificationAsync({
      content: testNudgeContent(),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: TEST_NUDGE_DELAY_SECONDS,
      },
    });
    pendingTestNudgeAt = fireAt;
    return true;
  });
}

/** The reminder a notification belongs to, or null (the test nudge carries none). */
function reminderIdOf(response: Notifications.NotificationResponse): string | null {
  // Expo Go adds its own keys to `data`; `reminderId` is the only one this app reads.
  const raw: unknown = response.notification?.request?.content?.data?.reminderId;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * Handles a tap on a notification or on its "Done ✓" action.
 * Done + reminder id → `deps.markDone(id)`; the default tap → `deps.openReminders()`.
 * Always waits for `deps.whenLoaded()` first. Never rejects.
 */
export async function handleResponse(
  response: Notifications.NotificationResponse,
  deps: ResponseDeps
): Promise<void> {
  try {
    await deps.whenLoaded();
    const reminderId = reminderIdOf(response);
    if (response.actionIdentifier === DONE_ACTION && reminderId !== null) {
      deps.markDone(reminderId);
    } else if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      deps.openReminders();
    }
  } catch (error) {
    console.warn('[nudge] could not handle a notification response', error);
  }
}

/** Responses already handled. Module scope, so it outlives a remount of the root layout. */
const handledResponses = new Set<string>();

function responseKey(response: Notifications.NotificationResponse): string {
  const { notification } = response;
  return `${notification.request.identifier}|${notification.date}|${response.actionIdentifier}`;
}

/**
 * Subscribes to notification responses and also processes the response that
 * cold-started the app, de-duplicated so one response is never handled twice.
 * Returns the cleanup function (use it as a `useEffect` cleanup).
 */
export function subscribeToResponses(deps: ResponseDeps): () => void {
  // iOS both emits a response and keeps it as the "last response", so the same
  // one can arrive through the listener and through the cold-start read below.
  const handleOnce = (response: Notifications.NotificationResponse): void => {
    let key: string;
    try {
      key = responseKey(response);
    } catch (error) {
      console.warn('[nudge] ignored a malformed notification response', error);
      return;
    }
    if (handledResponses.has(key)) return;
    handledResponses.add(key);
    void handleResponse(response, deps);
  };

  let subscription: { remove: () => void } | null = null;
  try {
    subscription = Notifications.addNotificationResponseReceivedListener(handleOnce);
  } catch (error) {
    console.warn('[nudge] could not listen for notification responses', error);
  }

  try {
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handleOnce(last);
      Notifications.clearLastNotificationResponse();
    }
  } catch (error) {
    console.warn('[nudge] could not read the last notification response', error);
  }

  return () => {
    try {
      subscription?.remove();
    } catch (error) {
      console.warn('[nudge] could not remove the notification listener', error);
    }
  };
}
