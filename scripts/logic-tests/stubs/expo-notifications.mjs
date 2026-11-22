// Stand-in for expo-notifications in the Node logic tests. It records what the
// app asks for so tests can assert on it; nothing here touches a real device.

export const SchedulableTriggerInputTypes = {
  CALENDAR: 'calendar',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
};

export const IosAuthorizationStatus = {
  NOT_DETERMINED: 0,
  DENIED: 1,
  AUTHORIZED: 2,
  PROVISIONAL: 3,
  EPHEMERAL: 4,
};

export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

/** Test controls and recordings. Reset with `__reset()` between tests. */
export const __state = {
  permission: { status: 'granted', granted: true, canAskAgain: true },
  scheduled: [],
  cancelAllCalls: 0,
  categories: [],
  handler: null,
  lastResponse: null,
  listeners: new Set(),
  failScheduling: false,
};

export function __reset() {
  __state.permission = { status: 'granted', granted: true, canAskAgain: true };
  __state.scheduled = [];
  __state.cancelAllCalls = 0;
  __state.categories = [];
  __state.handler = null;
  __state.lastResponse = null;
  __state.listeners.clear();
  __state.failScheduling = false;
}

export function setNotificationHandler(handler) {
  __state.handler = handler;
}

export async function setNotificationCategoryAsync(identifier, actions, options) {
  __state.categories.push({ identifier, actions, options });
  return { identifier, actions, options };
}

export async function getPermissionsAsync() {
  return { ...__state.permission };
}

export async function requestPermissionsAsync() {
  return { ...__state.permission };
}

let nextId = 1;

export async function scheduleNotificationAsync(request) {
  if (__state.failScheduling) throw new Error('scheduling failed (stub)');
  const identifier = `stub-${nextId++}`;
  __state.scheduled.push({ identifier, ...request });
  return identifier;
}

export async function cancelAllScheduledNotificationsAsync() {
  __state.cancelAllCalls += 1;
  __state.scheduled = [];
}

export async function getAllScheduledNotificationsAsync() {
  return [...__state.scheduled];
}

export function addNotificationResponseReceivedListener(listener) {
  __state.listeners.add(listener);
  return { remove: () => __state.listeners.delete(listener) };
}

export function getLastNotificationResponse() {
  return __state.lastResponse;
}

export function clearLastNotificationResponse() {
  __state.lastResponse = null;
}
