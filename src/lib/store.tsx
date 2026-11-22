/**
 * App state: reminders, settings, the toast and the capture text.
 *
 * The state lives in a small module-level store so that code outside React
 * (the notification response handler, and `rescheduleAllNotifications()` called
 * right after a change) always sees the latest values. `RemindersProvider`
 * exposes it to the tree through React context and `useNudge()`.
 */
import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { setHapticsEnabled } from '@/lib/haptics';
import {
  rescheduleAllNotifications as rescheduleOnDevice,
  type ScheduleSnapshot,
} from '@/lib/notifications';
import {
  applyMaintenance,
  applyMarkDone,
  applyToggleDone,
  type ReminderPatch,
} from '@/lib/reminders';
import { loadAll, saveReminders, saveSettings, type StoredData } from '@/lib/storage';
import { DEFAULT_SETTINGS, type Reminder, type Settings } from '@/lib/types';

export interface NudgeState {
  reminders: Reminder[];
  settings: Settings;
  /** True once reminders and settings have been read from storage. */
  isLoaded: boolean;
  /** Current toast message, or null. Cleared automatically 1800 ms after `showToast`. */
  toast: string | null;
  /** Text in the Capture text box (shared so Review can clear it after Save). */
  captureText: string;
}

export interface NudgeActions {
  // Reminder actions. Each one updates state synchronously and persists right away.
  addReminders: (reminders: Reminder[]) => void;
  updateReminder: (id: string, patch: ReminderPatch) => void;
  removeReminder: (id: string) => void;
  /** Also reschedules notifications afterwards. */
  toggleDone: (id: string) => void;
  clearAllReminders: () => void;
  // Other actions.
  /** Shallow merge; pass a complete `quietHours` object when changing it. */
  updateSettings: (patch: Partial<Settings>) => void;
  showToast: (message: string) => void;
  setCaptureText: (text: string) => void;
  /** Auto-completes past events, advances repeating ones, prunes old done items, then reschedules. */
  runMaintenance: (now?: Date) => void;
  /** Rebuilds all scheduled notifications from the latest state. Never rejects. */
  rescheduleAllNotifications: () => Promise<void>;
}

export type NudgeContextValue = NudgeState & NudgeActions;

const TOAST_DURATION_MS = 1800;
const DEFAULT_NOW_INTERVAL_MS = 30_000;
/** Lower bound for `useNow`, so a bad argument can never turn into a busy loop. */
const MIN_NOW_INTERVAL_MS = 1000;

// --- the store -----------------------------------------------------------------

let state: NudgeState = {
  reminders: [],
  // A copy, so the shared DEFAULT_SETTINGS object can never be reached through the store.
  settings: { ...DEFAULT_SETTINGS, quietHours: { ...DEFAULT_SETTINGS.quietHours } },
  isLoaded: false,
  toast: null,
  captureText: '',
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NudgeState {
  return state;
}

/**
 * Replaces the snapshot with a new object (it is never mutated) and notifies
 * subscribers. When nothing would change, the snapshot keeps its identity.
 */
function setState(patch: Partial<NudgeState>): void {
  const next: NudgeState = { ...state, ...patch };
  if (
    next.reminders === state.reminders &&
    next.settings === state.settings &&
    next.isLoaded === state.isLoaded &&
    next.toast === state.toast &&
    next.captureText === state.captureText
  ) {
    return;
  }
  state = next;
  // Copied first: a subscriber may unsubscribe while being notified.
  for (const listener of [...listeners]) listener();
}

/**
 * Reminders and settings may only change once storage has loaded: anything
 * changed earlier would be overwritten by the load (or, worse, saved over the
 * stored data). The screens are not rendered before then, so this only guards
 * against a call from outside React.
 */
function isReady(action: string): boolean {
  if (state.isLoaded) return true;
  console.warn(`[nudge] ${action} ignored: storage has not loaded yet`);
  return false;
}

/**
 * True while a key could not be read from storage. Its real contents are then
 * unknown (the data may well still be there), so nothing is saved over it and
 * no notification is cancelled on the strength of the empty stand-in in memory.
 * `retryLoad()` clears the flag once the key can be read.
 */
let remindersUnread = false;
let settingsUnread = false;

/** "Done ✓" taps that arrived while the reminders could not be read; applied once they can. */
let pendingDoneIds: string[] = [];

/** Stores and persists a new reminders array. Returns false (and does nothing) for the same array. */
function commitReminders(next: Reminder[]): boolean {
  if (next === state.reminders) return false;
  setState({ reminders: next });
  // While the stored list is unread this one is partial; it is merged and saved after a successful retry.
  if (!remindersUnread) void saveReminders(next);
  return true;
}

/**
 * Runs one of the reducers from `@/lib/reminders`. They return the same array
 * when nothing changed, so the result says whether anything was persisted.
 */
function reduceReminders(action: string, reducer: (reminders: Reminder[]) => Reminder[]): boolean {
  try {
    return commitReminders(reducer(state.reminders));
  } catch (error) {
    console.warn(`[nudge] ${action} failed`, error);
    return false;
  }
}

// --- actions (module-level, so their identity never changes) ---------------------

function addReminders(reminders: Reminder[]): void {
  if (!isReady('addReminders')) return;
  // Ids must stay unique: storage keeps only the first reminder with a given id.
  const ids = new Set(state.reminders.map((reminder) => reminder.id));
  const added: Reminder[] = [];
  for (const reminder of reminders) {
    if (ids.has(reminder.id)) continue;
    ids.add(reminder.id);
    added.push(reminder);
  }
  if (added.length === 0) return;
  commitReminders([...state.reminders, ...added]);
}

/** The reminder with the defined fields of `patch` applied; `id` and `createdAt` never change. */
function patchReminder(reminder: Reminder, patch: ReminderPatch): Reminder {
  // Field by field rather than a spread: an explicit `undefined` in the patch
  // must not erase a stored value, and unknown keys must not get in.
  return {
    id: reminder.id,
    text: patch.text !== undefined ? patch.text : reminder.text,
    type: patch.type !== undefined ? patch.type : reminder.type,
    dueAt: patch.dueAt !== undefined ? patch.dueAt : reminder.dueAt,
    nagStartAt: patch.nagStartAt !== undefined ? patch.nagStartAt : reminder.nagStartAt,
    repeat: patch.repeat !== undefined ? patch.repeat : reminder.repeat,
    status: patch.status !== undefined ? patch.status : reminder.status,
    completedAt: patch.completedAt !== undefined ? patch.completedAt : reminder.completedAt,
    createdAt: reminder.createdAt,
  };
}

function updateReminder(id: string, patch: ReminderPatch): void {
  if (!isReady('updateReminder')) return;
  if (!state.reminders.some((reminder) => reminder.id === id)) return;
  commitReminders(
    state.reminders.map((reminder) => (reminder.id === id ? patchReminder(reminder, patch) : reminder))
  );
}

function removeReminder(id: string): void {
  if (!isReady('removeReminder')) return;
  const remaining = state.reminders.filter((reminder) => reminder.id !== id);
  if (remaining.length === state.reminders.length) return;
  commitReminders(remaining);
}

function clearAllReminders(): void {
  if (!isReady('clearAllReminders')) return;
  if (state.reminders.length > 0) setState({ reminders: [] });
  // Written even when the list already looks empty (or could not be read):
  // "Delete all" must leave nothing on disk. After it, the stored list is known again.
  remindersUnread = false;
  pendingDoneIds = [];
  void saveReminders([]);
}

function toggleDone(id: string): void {
  if (!isReady('toggleDone')) return;
  const changed = reduceReminders('toggleDone', (reminders) =>
    applyToggleDone(reminders, id, new Date())
  );
  if (changed) void rescheduleAllNotifications();
}

function updateSettings(patch: Partial<Settings>): void {
  if (!isReady('updateSettings')) return;
  const current = state.settings;
  // Field by field for the same reason as `patchReminder`.
  const next: Settings = {
    quietHours: patch.quietHours !== undefined ? { ...patch.quietHours } : current.quietHours,
    eventLeadMinutes:
      patch.eventLeadMinutes !== undefined ? patch.eventLeadMinutes : current.eventLeadMinutes,
    nagIntervalMinutes:
      patch.nagIntervalMinutes !== undefined
        ? patch.nagIntervalMinutes
        : current.nagIntervalMinutes,
    defaultNagStartHours:
      patch.defaultNagStartHours !== undefined
        ? patch.defaultNagStartHours
        : current.defaultNagStartHours,
    hapticsEnabled:
      patch.hapticsEnabled !== undefined ? patch.hapticsEnabled : current.hapticsEnabled,
    hasAskedNotificationPermission:
      patch.hasAskedNotificationPermission !== undefined
        ? patch.hasAskedNotificationPermission
        : current.hasAskedNotificationPermission,
  };
  setState({ settings: next });
  // Not saved over stored settings that could not be read (see `settingsUnread`).
  if (!settingsUnread) void saveSettings(next);
  setHapticsEnabled(next.hapticsEnabled);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  setState({ toast: message });
  // Restarted on every call, so a toast shown twice in a row stays up for its full time.
  toastTimer = setTimeout(() => {
    toastTimer = null;
    setState({ toast: null });
  }, TOAST_DURATION_MS);
}

function setCaptureText(text: string): void {
  setState({ captureText: text });
}

function maintain(at: Date): void {
  reduceReminders('runMaintenance', (reminders) => applyMaintenance(reminders, at));
  // Always, even when nothing changed: this is what refills the 48-hour notification window.
  void rescheduleAllNotifications();
}

function runMaintenance(now?: Date): void {
  // Nothing to maintain yet; `loadStore()` runs this itself as soon as storage has loaded.
  if (!state.isLoaded) return;
  // Coming back to the app is a good moment to try an unreadable key again.
  if (remindersUnread || settingsUnread) void retryLoad();
  // Reminders that could not be read cannot be maintained; a successful retry does it then.
  if (remindersUnread) return;
  // Tolerates being handed something else (e.g. used directly as a listener).
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  maintain(at);
}

function getScheduleSnapshot(): ScheduleSnapshot {
  return { reminders: state.reminders, settings: state.settings };
}

function rescheduleAllNotifications(): Promise<void> {
  // Never before storage has loaded: a reschedule built from the initial empty
  // state would cancel every notification that is still pending.
  return whenLoaded()
    .then(() => {
      // Same reason while the stored reminders could not be read: what is already
      // scheduled on the phone is better than a schedule built from an empty list.
      if (remindersUnread) return undefined;
      return rescheduleOnDevice(getScheduleSnapshot);
    })
    .catch((error: unknown) => {
      console.warn('[nudge] could not reschedule notifications', error);
    });
}

const actions: NudgeActions = {
  addReminders,
  updateReminder,
  removeReminder,
  toggleDone,
  clearAllReminders,
  updateSettings,
  showToast,
  setCaptureText,
  runMaintenance,
  rescheduleAllNotifications,
};

// --- non-React API (root layout, notification handler) -------------------------

let loadPromise: Promise<void> | null = null;

/**
 * Delays before an unreadable key is tried again by itself. It is also tried
 * again every time the app returns to the foreground (see `runMaintenance`).
 */
const RETRY_DELAYS_MS = [2000, 10_000];
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retrying: Promise<void> | null = null;

/** Puts what was read into the store. A key that could not be read is left as it is in memory. */
function applyLoaded(stored: StoredData): void {
  const firstLoad = !state.isLoaded;
  const patch: Partial<NudgeState> = { isLoaded: true };

  // On a retry only the keys that had been unreadable are taken from disk: the
  // others are already in memory, and may be newer than a second read.
  if (firstLoad || remindersUnread) {
    if (stored.remindersUnread) {
      remindersUnread = true;
    } else {
      // Reminders added while the stored list was unreadable exist in memory only.
      const known = new Set(stored.reminders.map((reminder) => reminder.id));
      const unsaved = state.reminders.filter((reminder) => !known.has(reminder.id));
      const reminders = unsaved.length > 0 ? [...stored.reminders, ...unsaved] : stored.reminders;
      remindersUnread = false;
      patch.reminders = reminders;
      if (unsaved.length > 0) void saveReminders(reminders);
    }
  }
  if (firstLoad || settingsUnread) {
    if (stored.settingsUnread) {
      settingsUnread = true;
    } else {
      settingsUnread = false;
      patch.settings = stored.settings;
      setHapticsEnabled(stored.settings.hapticsEnabled);
    }
  }
  setState(patch);
}

function scheduleRetry(): void {
  if (retryTimer !== null || retryCount >= RETRY_DELAYS_MS.length) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void retryLoad();
  }, RETRY_DELAYS_MS[retryCount]);
  retryCount += 1;
}

/**
 * Reads storage into the store. Never rejects. If a key cannot be read the app
 * still opens (with an empty list or default settings for now) and the read is
 * tried again; until it works, that key is neither saved over nor used to
 * rebuild the notification schedule.
 */
async function hydrate(): Promise<void> {
  try {
    applyLoaded(await loadAll());
  } catch (error) {
    console.warn('[nudge] could not load saved data', error);
  }
  try {
    // The app must leave the splash screen even if loading failed.
    if (!state.isLoaded) setState({ isLoaded: true });
    if (remindersUnread || settingsUnread) scheduleRetry();
    if (!remindersUnread) {
      const queued = pendingDoneIds;
      pendingDoneIds = [];
      for (const id of queued) markDone(id);
      maintain(new Date());
    }
  } catch (error) {
    console.warn('[nudge] could not finish loading', error);
  }
}

/** Tries again to read whatever could not be read. Resolves when that attempt is over; never rejects. */
function retryLoad(): Promise<void> {
  if (!remindersUnread && !settingsUnread) return Promise.resolve();
  if (retrying === null) {
    retrying = hydrate().then(() => {
      retrying = null;
    });
  }
  return retrying;
}

/** Loads reminders and settings from storage once, then runs maintenance. Safe to call repeatedly. */
export function loadStore(): Promise<void> {
  if (loadPromise === null) {
    // Started one microtask later, so `loadPromise` is already set by the time
    // anything inside `hydrate` asks for `whenLoaded()`.
    loadPromise = Promise.resolve().then(hydrate);
  }
  return loadPromise;
}

/** Resolves once `loadStore()` has finished (it starts the load if nobody has yet). */
export function whenLoaded(): Promise<void> {
  return loadStore();
}

function markDone(id: string): void {
  if (remindersUnread) {
    // The reminder is on disk but not in memory yet: keep the tap and apply it once it has been read.
    if (!pendingDoneIds.includes(id)) pendingDoneIds.push(id);
    void retryLoad();
    return;
  }
  const changed = reduceReminders('markDoneFromNotification', (reminders) =>
    applyMarkDone(reminders, id, new Date())
  );
  if (changed) void rescheduleAllNotifications();
}

/** Notification "Done ✓": marks an active reminder done, persists and reschedules. Ignores unknown ids. */
export function markDoneFromNotification(id: string): void {
  if (typeof id !== 'string' || id.length === 0) return;
  if (state.isLoaded) {
    markDone(id);
    return;
  }
  // The app can be woken by the action before storage has loaded; the tap must
  // be applied to the stored reminders, not dropped or applied to the empty state.
  void whenLoaded().then(() => markDone(id));
}

// --- React API -----------------------------------------------------------------

const NudgeContext = createContext<NudgeContextValue | null>(null);

/** Wraps the app (in the root layout) and starts loading storage on mount. */
export function RemindersProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void loadStore();
  }, []);

  const value: NudgeContextValue = { ...snapshot, ...actions };
  return <NudgeContext value={value}>{children}</NudgeContext>;
}

/** State and actions. Must be used inside `RemindersProvider`. */
export function useNudge(): NudgeContextValue {
  const value = use(NudgeContext);
  if (value === null) {
    throw new Error('useNudge() must be used inside <RemindersProvider>');
  }
  return value;
}

/**
 * The current time as React state: refreshed every `intervalMs` and whenever
 * the app returns to the foreground. Use this instead of `new Date()` /
 * `Date.now()` while rendering (render must stay pure under the React Compiler).
 */
export function useNow(intervalMs = DEFAULT_NOW_INTERVAL_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      setNow(new Date());
    };
    const period = Number.isFinite(intervalMs)
      ? Math.max(MIN_NOW_INTERVAL_MS, intervalMs)
      : DEFAULT_NOW_INTERVAL_MS;
    const timer = setInterval(refresh, period);
    // Timers do not run while the app is in the background, so catch up on return.
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);

  return now;
}
