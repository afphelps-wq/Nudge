import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  DONE_ACTION,
  MAX_NAGS_PER_TASK,
  MAX_SCHEDULED,
  TASK_CATEGORY,
  buildCandidates,
  cancelAllNotifications,
  getPermissionState,
  handleResponse,
  isQuietTime,
  nagMessage,
  nextQuietEnd,
  requestPermission,
  rescheduleAllNotifications,
  sendTestNudge,
  setupNotifications,
  subscribeToResponses,
} from '../../src/lib/notifications.ts';
import { parseCapture } from '../../src/lib/parse.ts';
import {
  draftToReminder,
  reminderSubtitle,
  repeatForChoice,
  setDraftRepeat,
} from '../../src/lib/reminders.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/types.ts';
import {
  DEFAULT_ACTION_IDENTIFIER,
  __reset,
  __state,
} from './stubs/expo-notifications.mjs';

// Sat Nov 21 2026, 10:00 AM local — the reference "now" in SPEC.md.
const NOW = new Date(2026, 10, 21, 10, 0, 0, 0);
const S = DEFAULT_SETTINGS;
const NO_QUIET = { ...S, quietHours: { ...S.quietHours, enabled: false } };

const at = (day, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute, 0, 0);
const iso = (day, hour = 0, minute = 0) => at(day, hour, minute).toISOString();
const hm = (date) => [date.getDate(), date.getHours(), date.getMinutes()];

function task(overrides = {}) {
  return {
    id: 't1',
    text: 'Finish essay',
    type: 'task',
    dueAt: null,
    nagStartAt: NOW.toISOString(),
    repeat: null,
    status: 'active',
    completedAt: null,
    createdAt: iso(20, 9),
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'e1',
    text: 'Dentist',
    type: 'event',
    dueAt: iso(24, 15),
    nagStartAt: null,
    repeat: null,
    status: 'active',
    completedAt: null,
    createdAt: iso(20, 9),
    ...overrides,
  };
}

beforeEach(async () => {
  // Leaves the module with no pending test nudge, then clears the recordings.
  await cancelAllNotifications();
  __reset();
});

// --- quiet hours -------------------------------------------------------------------

test('quiet hours that cross midnight', () => {
  const quiet = { enabled: true, start: '22:00', end: '08:00' };
  assert.equal(isQuietTime(at(21, 22, 0), quiet), true);
  assert.equal(isQuietTime(at(21, 23, 30), quiet), true);
  assert.equal(isQuietTime(at(22, 7, 59), quiet), true);
  assert.equal(isQuietTime(at(22, 8, 0), quiet), false);
  assert.equal(isQuietTime(at(21, 21, 59), quiet), false);
  assert.equal(isQuietTime(at(21, 12, 0), quiet), false);
});

test('quiet hours within one day, disabled, empty and invalid', () => {
  const afternoon = { enabled: true, start: '13:00', end: '15:00' };
  assert.equal(isQuietTime(at(21, 13, 0), afternoon), true);
  assert.equal(isQuietTime(at(21, 14, 59), afternoon), true);
  assert.equal(isQuietTime(at(21, 15, 0), afternoon), false);
  assert.equal(isQuietTime(at(21, 12, 59), afternoon), false);

  assert.equal(isQuietTime(at(21, 23), { enabled: false, start: '22:00', end: '08:00' }), false);
  assert.equal(isQuietTime(at(21, 23), { enabled: true, start: '09:00', end: '09:00' }), false);
  assert.equal(isQuietTime(at(21, 23), { enabled: true, start: 'nope', end: '08:00' }), false);
});

test('nextQuietEnd is the next end time after the given moment', () => {
  const quiet = { enabled: true, start: '22:00', end: '08:00' };
  assert.deepEqual(hm(nextQuietEnd(at(21, 23, 0), quiet)), [22, 8, 0]);
  assert.deepEqual(hm(nextQuietEnd(at(22, 3, 0), quiet)), [22, 8, 0]);
  assert.deepEqual(hm(nextQuietEnd(at(22, 8, 0), quiet)), [23, 8, 0]);
});

// --- nag copy ---------------------------------------------------------------------

test('nag messages escalate by level and cap at the last row', () => {
  assert.deepEqual(nagMessage('Call mom', 0, false), {
    title: '⏰ Call mom',
    body: 'Time to get this done.',
  });
  assert.deepEqual(nagMessage('Call mom', 1, false), {
    title: 'Still on your list: Call mom',
    body: "Tap Done when it's finished.",
  });
  assert.deepEqual(nagMessage('Call mom', 2, false), {
    title: 'Call mom is still waiting 👀',
    body: "You've got this. Knock it out.",
  });
  assert.deepEqual(nagMessage('Call mom', 3, false), {
    title: 'Hey. Call mom. Seriously.',
    body: "Nudge isn't going away until it's done.",
  });
  const last = {
    title: '🚨 Call mom: still not done',
    body: 'Do it now, then tap Done to make me stop.',
  };
  assert.deepEqual(nagMessage('Call mom', 4, false), last);
  assert.deepEqual(nagMessage('Call mom', 40, false), last);
  assert.equal(nagMessage('Call mom', 0, true).title, 'Overdue: ⏰ Call mom');
  assert.equal(nagMessage('Call mom', 9, true).title, 'Overdue: 🚨 Call mom: still not done');
});

// --- candidates: events -------------------------------------------------------------

test('a one-off event gets one heads-up before it starts', () => {
  const [candidate, ...rest] = buildCandidates([event()], S, NOW);
  assert.equal(rest.length, 0);
  assert.deepEqual(hm(candidate.date), [24, 14, 30]);
  assert.equal(candidate.title, '📅 Dentist');
  assert.equal(candidate.body, 'Starts in 30 min · 3:00 PM');
  assert.equal(candidate.categoryIdentifier, undefined, 'events have no Done action');
  assert.deepEqual(candidate.data, { reminderId: 'e1' });
});

test('the heads-up wording follows the lead setting', () => {
  const body = (eventLeadMinutes) =>
    buildCandidates([event()], { ...S, eventLeadMinutes }, NOW)[0].body;
  assert.equal(body(10), 'Starts in 10 min · 3:00 PM');
  assert.equal(body(15), 'Starts in 15 min · 3:00 PM');
  assert.equal(body(60), 'Starts in 1 hour · 3:00 PM');

  const [atStart] = buildCandidates([event()], { ...S, eventLeadMinutes: 0 }, NOW);
  assert.deepEqual(hm(atStart.date), [24, 15, 0]);
  assert.equal(atStart.body, 'Starting now · 3:00 PM');
});

test('an event already inside its lead window is announced at its start time', () => {
  const soon = event({ dueAt: iso(21, 10, 10) });
  const [candidate, ...rest] = buildCandidates([soon], S, NOW);
  assert.equal(rest.length, 0);
  assert.deepEqual(hm(candidate.date), [21, 10, 10]);
  assert.equal(candidate.body, 'Starting now · 10:10 AM');
});

test('past, done and damaged reminders produce nothing', () => {
  const reminders = [
    event({ dueAt: iso(21, 9) }),
    event({ id: 'e2', status: 'done', completedAt: iso(21, 9) }),
    task({ id: 't2', status: 'done', completedAt: iso(21, 9) }),
    event({ id: 'e3', dueAt: 'garbage' }),
    task({ id: 't3', nagStartAt: 'garbage' }),
    task({ id: 't4', nagStartAt: null }),
  ];
  assert.deepEqual(buildCandidates(reminders, S, NOW), []);
});

test('a repeating event gets a heads-up for each occurrence in the next 7 days', () => {
  const daily = event({ dueAt: iso(21, 21), repeat: { kind: 'daily' } });
  const candidates = buildCandidates([daily], S, NOW);
  assert.deepEqual(
    candidates.map((c) => hm(c.date)),
    [21, 22, 23, 24, 25, 26, 27].map((day) => [day, 20, 30])
  );
  for (const c of candidates) assert.equal(c.body, 'Starts in 30 min · 9:00 PM');

  const mondays = event({ dueAt: iso(23, 7), repeat: { kind: 'weekly', weekdays: [1] } });
  assert.deepEqual(
    buildCandidates([mondays], S, NOW).map((c) => hm(c.date)),
    [[23, 6, 30]],
    'quiet hours do not apply to events'
  );
});

// Nov 2026: 15 = Sun, 21 = Sat, 22 = Sun, 23 = Mon … 27 = Fri.
const WEEKDAYS_REPEAT = { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] };
const MON_TO_FRI_AT_830 = [23, 24, 25, 26, 27].map((day) => [day, 8, 30]);

test('REVIEW 24: "tomorrow at 9am" on a Saturday, then Weekdays, starts on Monday', () => {
  const [parsed] = parseCapture('standup meeting tomorrow at 9am', NOW, S);
  assert.equal(parsed.type, 'event');
  assert.equal(parsed.dueAt.getTime(), at(22, 9).getTime(), 'parsed as Sunday 9:00 AM');

  // The Repeat row's "Weekdays" pill.
  const card = setDraftRepeat(parsed, repeatForChoice('weekdays', parsed.dueAt));
  assert.deepEqual(card.repeat, WEEKDAYS_REPEAT);
  assert.equal(card.dueAt.getTime(), at(23, 9).getTime(), 'the date moves to Monday 9:00 AM');

  const saved = draftToReminder(card, NOW, S);
  assert.equal(saved.dueAt, iso(23, 9));
  assert.equal(reminderSubtitle(saved, NOW, S), 'Weekdays · 9:00 AM');

  const candidates = buildCandidates([saved], S, NOW);
  assert.deepEqual(candidates.map((c) => hm(c.date)), MON_TO_FRI_AT_830);
  assert.ok(
    candidates.every((c) => c.date.getDay() >= 1 && c.date.getDay() <= 5),
    'no notification on Sunday (or Saturday)'
  );
});

test('safety net: a stored repeating event that is off its days starts on the next allowed day', () => {
  // Saved before the card kept dates in line: Weekdays, but dueAt is Sunday.
  const sunday = event({ dueAt: iso(22, 9), repeat: WEEKDAYS_REPEAT });
  assert.deepEqual(buildCandidates([sunday], S, NOW).map((c) => hm(c.date)), MON_TO_FRI_AT_830);

  // The same when the stray date has already passed.
  const lastSunday = event({ dueAt: iso(15, 9), repeat: WEEKDAYS_REPEAT });
  assert.deepEqual(
    buildCandidates([lastSunday], S, NOW).map((c) => hm(c.date)),
    MON_TO_FRI_AT_830
  );

  // A date that is on the rule's days is still the first occurrence.
  const tuesday = event({ dueAt: iso(24, 9), repeat: WEEKDAYS_REPEAT });
  assert.deepEqual(
    buildCandidates([tuesday], S, NOW).map((c) => hm(c.date)),
    [24, 25, 26, 27].map((day) => [day, 8, 30])
  );

  // Daily allows every day, so a Sunday start is kept.
  const dailyFromSunday = event({ dueAt: iso(22, 9), repeat: { kind: 'daily' } });
  assert.deepEqual(
    buildCandidates([dailyFromSunday], S, NOW).map((c) => hm(c.date)),
    [22, 23, 24, 25, 26, 27, 28].map((day) => [day, 8, 30])
  );
});

// --- candidates: tasks ----------------------------------------------------------------

test('a task nags every interval with escalating copy and the Done action', () => {
  const candidates = buildCandidates([task({ text: 'Call mom' })], NO_QUIET, NOW);
  // 12 are generated from 10:00; the one at "now" is dropped by the now + 5 s rule.
  assert.equal(candidates.length, MAX_NAGS_PER_TASK - 1);
  assert.deepEqual(hm(candidates[0].date), [21, 11, 0]);
  assert.equal(candidates[0].title, 'Still on your list: Call mom');
  assert.equal(candidates[1].title, 'Call mom is still waiting 👀');
  assert.equal(candidates[2].title, 'Hey. Call mom. Seriously.');
  assert.equal(candidates[3].title, '🚨 Call mom: still not done');
  assert.deepEqual(hm(candidates.at(-1).date), [21, 21, 0]);
  for (const c of candidates) {
    assert.equal(c.categoryIdentifier, TASK_CATEGORY);
    assert.deepEqual(c.data, { reminderId: 't1' });
  }
});

test('a task that has not started yet begins at level 0 at its start time', () => {
  const essay = task({ dueAt: iso(21, 17), nagStartAt: iso(21, 14) });
  const candidates = buildCandidates([essay], NO_QUIET, NOW);
  assert.equal(candidates.length, MAX_NAGS_PER_TASK);
  assert.deepEqual(hm(candidates[0].date), [21, 14, 0]);
  assert.equal(candidates[0].title, '⏰ Finish essay');
  assert.equal(candidates[0].body, 'Time to get this done.');
  // 17:00 is the deadline itself, not after it.
  assert.deepEqual(hm(candidates[3].date), [21, 17, 0]);
  assert.ok(!candidates[3].title.startsWith('Overdue: '));
  assert.deepEqual(hm(candidates[4].date), [21, 18, 0]);
  assert.equal(candidates[4].title, 'Overdue: 🚨 Finish essay: still not done');
});

test('a task that started earlier continues from the right level', () => {
  const started = task({ nagStartAt: iso(21, 7, 30) });
  const [first] = buildCandidates([started], NO_QUIET, NOW);
  assert.deepEqual(hm(first.date), [21, 10, 30]);
  assert.equal(first.title, 'Hey. Finish essay. Seriously.'); // level 3
});

test('the nag interval follows the setting', () => {
  const candidates = buildCandidates([task()], { ...NO_QUIET, nagIntervalMinutes: 15 }, NOW);
  assert.deepEqual(hm(candidates[0].date), [21, 10, 15]);
  assert.deepEqual(hm(candidates[1].date), [21, 10, 30]);
});

test('task nags pause during quiet hours and resume at the quiet end', () => {
  const evening = task({ nagStartAt: iso(21, 20, 30) });
  const candidates = buildCandidates([evening], S, NOW); // quiet 22:00–08:00
  assert.deepEqual(hm(candidates[0].date), [21, 20, 30]);
  assert.deepEqual(hm(candidates[1].date), [21, 21, 30]);
  assert.deepEqual(hm(candidates[2].date), [22, 8, 0]);
  assert.deepEqual(hm(candidates[3].date), [22, 9, 0]);
  assert.equal(candidates.length, MAX_NAGS_PER_TASK);
  for (const c of candidates) {
    assert.equal(isQuietTime(c.date, S.quietHours), false, c.date.toString());
  }
});

test('nags stay inside the 48-hour window', () => {
  const candidates = buildCandidates([task()], { ...NO_QUIET, nagIntervalMinutes: 120 }, NOW);
  const limit = NOW.getTime() + 48 * 3_600_000;
  for (const c of candidates) assert.ok(c.date.getTime() < limit);
  assert.ok(candidates.length <= MAX_NAGS_PER_TASK);

  const farAway = task({ dueAt: iso(30, 17), nagStartAt: iso(30, 14) });
  assert.deepEqual(buildCandidates([farAway], NO_QUIET, NOW), []);
});

test('the result is sorted and capped at 60', () => {
  const tasks = Array.from({ length: 10 }, (_, index) =>
    task({ id: `t${index}`, nagStartAt: iso(21, 10, index) })
  );
  const candidates = buildCandidates(
    [...tasks, event()],
    { ...NO_QUIET, nagIntervalMinutes: 15 },
    NOW
  );
  assert.equal(candidates.length, MAX_SCHEDULED);
  for (let i = 1; i < candidates.length; i += 1) {
    assert.ok(candidates[i - 1].date.getTime() <= candidates[i].date.getTime());
  }
  const cutoff = NOW.getTime() + 5000;
  for (const c of candidates) assert.ok(c.date.getTime() > cutoff);
});

// --- device-facing API (against the stub) ------------------------------------------------

/**
 * A snapshot whose times are relative to the real clock, which reschedule uses.
 * The task started nagging 30 minutes ago, so its next 12 nags are all in the
 * future whatever the exact millisecond: 1 event heads-up + 12 nags = 13.
 */
const LIVE_COUNT = 13;

function liveSnapshot() {
  const eventTime = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const nagStart = new Date(Date.now() - 30 * 60_000).toISOString();
  return {
    reminders: [event({ dueAt: eventTime }), task({ nagStartAt: nagStart })],
    settings: NO_QUIET,
  };
}

test('setupNotifications installs the handler and the Done category, and can be repeated', async () => {
  setupNotifications();
  setupNotifications();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(__state.handler, 'handler installed');
  assert.deepEqual(await __state.handler.handleNotification(), {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
  const category = __state.categories.find((c) => c.identifier === TASK_CATEGORY);
  assert.ok(category, 'category registered');
  assert.deepEqual(category.actions, [
    { identifier: DONE_ACTION, buttonTitle: 'Done ✓', options: { opensAppToForeground: false } },
  ]);
});

test('permission helpers report the state and never reject', async () => {
  assert.equal(await getPermissionState(), 'granted');
  assert.equal(await requestPermission(), true);
  __state.permission = { status: 'denied', granted: false, canAskAgain: false };
  assert.equal(await getPermissionState(), 'denied');
  assert.equal(await requestPermission(), false);
  __state.permission = { status: 'undetermined', granted: false, canAskAgain: true };
  assert.equal(await getPermissionState(), 'undetermined');
});

test('reschedule cancels everything and schedules the current candidates', async () => {
  const snapshot = liveSnapshot();
  await rescheduleAllNotifications(() => snapshot);
  assert.ok(__state.cancelAllCalls >= 1);
  assert.equal(__state.scheduled.length, LIVE_COUNT);
  const eventRequest = __state.scheduled.find((r) => r.content.data.reminderId === 'e1');
  assert.equal(eventRequest.content.title, '📅 Dentist');
  assert.equal(eventRequest.content.sound, true);
  assert.equal(eventRequest.content.categoryIdentifier, undefined);
  assert.equal(eventRequest.trigger.type, 'date');
  assert.ok(eventRequest.trigger.date instanceof Date);
  assert.equal(eventRequest.identifier.startsWith('stub-'), true, 'no custom identifier is passed');
  const taskRequest = __state.scheduled.find((r) => r.content.data.reminderId === 't1');
  assert.equal(taskRequest.content.categoryIdentifier, TASK_CATEGORY);
});

test('reschedule schedules nothing without permission, but still cancels', async () => {
  __state.permission = { status: 'denied', granted: false, canAskAgain: false };
  __state.scheduled.push({ identifier: 'old', content: {}, trigger: {} });
  const snapshot = liveSnapshot();
  await rescheduleAllNotifications(() => snapshot);
  assert.ok(__state.cancelAllCalls >= 1);
  assert.equal(__state.scheduled.length, 0);
});

test('overlapping reschedules are merged and never duplicate notifications', async () => {
  const snapshot = liveSnapshot();
  await Promise.all(
    Array.from({ length: 8 }, () => rescheduleAllNotifications(() => snapshot))
  );
  assert.equal(__state.scheduled.length, LIVE_COUNT);
  assert.ok(__state.cancelAllCalls <= 3, `expected merged runs, saw ${__state.cancelAllCalls}`);
});

test('a later reschedule uses the latest snapshot', async () => {
  let current = liveSnapshot();
  const first = rescheduleAllNotifications(() => current);
  current = { reminders: [], settings: NO_QUIET };
  const second = rescheduleAllNotifications(() => current);
  await Promise.all([first, second]);
  assert.equal(__state.scheduled.length, 0);
});

test('one failing schedule call does not stop the run or reject', async () => {
  const snapshot = liveSnapshot();
  __state.failScheduling = true;
  await assert.doesNotReject(rescheduleAllNotifications(() => snapshot));
  __state.failScheduling = false;
  await rescheduleAllNotifications(() => snapshot);
  assert.equal(__state.scheduled.length, LIVE_COUNT, 'the queue recovers after failures');
});

test('the test nudge is scheduled with the Done action and survives a reschedule', async () => {
  assert.equal(await sendTestNudge(), true);
  assert.equal(__state.scheduled.length, 1);
  const [request] = __state.scheduled;
  assert.equal(request.content.title, '⏰ Test nudge');
  assert.equal(request.content.body, 'This is what a nag looks like. Tap Done to try it.');
  assert.equal(request.content.categoryIdentifier, TASK_CATEGORY);
  assert.equal('reminderId' in request.content.data, false, 'no null reminder id is sent');

  await rescheduleAllNotifications(() => ({ reminders: [], settings: NO_QUIET }));
  assert.equal(__state.scheduled.length, 1, 're-added after the cancel step');
  assert.equal(__state.scheduled[0].content.title, '⏰ Test nudge');

  await cancelAllNotifications();
  await rescheduleAllNotifications(() => ({ reminders: [], settings: NO_QUIET }));
  assert.equal(__state.scheduled.length, 0, 'Delete all forgets the test nudge');
});

test('the test nudge is not sent without permission', async () => {
  __state.permission = { status: 'denied', granted: false, canAskAgain: false };
  assert.equal(await sendTestNudge(), false);
  assert.equal(__state.scheduled.length, 0);
});

// --- responses ----------------------------------------------------------------------------

function response(actionIdentifier, data, identifier = 'n1', date = 1) {
  return {
    actionIdentifier,
    notification: { date, request: { identifier, content: { data } } },
  };
}

function deps() {
  const calls = { loaded: 0, done: [], opened: 0 };
  return {
    calls,
    whenLoaded: async () => {
      calls.loaded += 1;
    },
    markDone: (id) => calls.done.push(id),
    openReminders: () => {
      calls.opened += 1;
    },
  };
}

test('the Done action marks the reminder done and does not navigate', async () => {
  const d = deps();
  await handleResponse(response(DONE_ACTION, { reminderId: 't1' }), d);
  assert.deepEqual(d.calls.done, ['t1']);
  assert.equal(d.calls.opened, 0);
  assert.equal(d.calls.loaded, 1, 'waits for storage first');
});

test('tapping the notification body opens Reminders', async () => {
  const d = deps();
  await handleResponse(response(DEFAULT_ACTION_IDENTIFIER, { reminderId: 't1' }), d);
  assert.deepEqual(d.calls.done, []);
  assert.equal(d.calls.opened, 1);
});

test('Done without a usable reminder id (the test nudge) does nothing', async () => {
  for (const data of [{ test: true }, {}, undefined, { reminderId: '' }, { reminderId: 7 }]) {
    const d = deps();
    await handleResponse(response(DONE_ACTION, data), d);
    assert.deepEqual(d.calls.done, []);
    assert.equal(d.calls.opened, 0);
  }
});

test('unknown actions are ignored and failures never reject', async () => {
  const d = deps();
  await handleResponse(response('somethingElse', { reminderId: 't1' }), d);
  assert.deepEqual(d.calls.done, []);
  assert.equal(d.calls.opened, 0);

  const failing = {
    whenLoaded: async () => {
      throw new Error('storage failed');
    },
    markDone: () => {},
    openReminders: () => {},
  };
  await assert.doesNotReject(handleResponse(response(DONE_ACTION, { reminderId: 't1' }), failing));
  await assert.doesNotReject(handleResponse({}, d));
});

test('a response is handled once, whether it arrives live, at cold start, or both', async () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Cold start: the response that launched the app is waiting.
  __state.lastResponse = response(DONE_ACTION, { reminderId: 'cold' }, 'n-cold', 10);
  const d = deps();
  const unsubscribe = subscribeToResponses(d);
  await settle();
  assert.deepEqual(d.calls.done, ['cold']);
  assert.equal(__state.lastResponse, null, 'cleared after handling');

  // The same response delivered again through the listener is ignored.
  const [listener] = [...__state.listeners];
  listener(response(DONE_ACTION, { reminderId: 'cold' }, 'n-cold', 10));
  await settle();
  assert.deepEqual(d.calls.done, ['cold']);

  // A new response is handled.
  listener(response(DONE_ACTION, { reminderId: 'live' }, 'n-live', 11));
  await settle();
  assert.deepEqual(d.calls.done, ['cold', 'live']);

  unsubscribe();
  assert.equal(__state.listeners.size, 0);
});
