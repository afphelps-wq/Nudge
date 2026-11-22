import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { cancelAllNotifications } from '../../src/lib/notifications.ts';
import { REMINDERS_KEY, SETTINGS_KEY } from '../../src/lib/storage.ts';
import { __storage } from './stubs/async-storage.mjs';
import { __reset as resetNotifications, __state as notifications } from './stubs/expo-notifications.mjs';

const HOUR = 3_600_000;
const fromNow = (ms) => new Date(Date.now() + ms).toISOString();

function task(overrides = {}) {
  return {
    id: 't1',
    text: 'Finish essay',
    type: 'task',
    dueAt: null,
    nagStartAt: fromNow(-HOUR / 2),
    repeat: null,
    status: 'active',
    completedAt: null,
    createdAt: fromNow(-24 * HOUR),
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'e1',
    text: 'Dentist',
    type: 'event',
    dueAt: fromNow(3 * HOUR),
    nagStartAt: null,
    repeat: null,
    status: 'active',
    completedAt: null,
    createdAt: fromNow(-24 * HOUR),
    ...overrides,
  };
}

const onDisk = () => JSON.parse(__storage.data.get(REMINDERS_KEY) ?? 'null');
const settingsOnDisk = () => JSON.parse(__storage.data.get(SETTINGS_KEY) ?? 'null');

/** Lets queued saves and reschedules finish. */
async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

let caseNumber = 0;

/**
 * A fresh copy of the store (its state lives at module level) plus `read()`,
 * which returns what `useNudge()` gives a screen right now.
 */
async function freshStore() {
  caseNumber += 1;
  const store = await import(`../../src/lib/store.tsx?case=${caseNumber}`);
  const read = () => {
    let value;
    function Probe() {
      value = store.useNudge();
      return null;
    }
    renderToString(createElement(store.RemindersProvider, null, createElement(Probe)));
    return value;
  };
  return { store, read };
}

beforeEach(async (t) => {
  // The store retries unreadable storage on a timer; tests drive retries themselves.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await cancelAllNotifications();
  __storage.reset();
  resetNotifications();
  t.mock.method(console, 'warn', () => {});
});

test('loads what is stored, then schedules notifications for it', async () => {
  __storage.data.set(REMINDERS_KEY, JSON.stringify([task(), event()]));
  __storage.data.set(SETTINGS_KEY, JSON.stringify({ nagIntervalMinutes: 30 }));
  const { store, read } = await freshStore();

  assert.equal(read().isLoaded, false);
  await store.loadStore();
  await settle();

  const loaded = read();
  assert.equal(loaded.isLoaded, true);
  assert.deepEqual(
    loaded.reminders.map((r) => r.id),
    ['t1', 'e1']
  );
  assert.equal(loaded.settings.nagIntervalMinutes, 30);
  assert.equal(loaded.settings.eventLeadMinutes, 30, 'missing fields come from the defaults');
  assert.ok(notifications.scheduled.length > 0, 'the schedule is built on load');
});

test('nothing changes before storage has loaded', async () => {
  const { read } = await freshStore();
  read().addReminders([task()]);
  read().updateSettings({ hapticsEnabled: false });
  await settle();
  assert.deepEqual(read().reminders, []);
  assert.equal(read().settings.hapticsEnabled, true);
  assert.equal(__storage.writes.length, 0);
});

test('every change is saved straight away as a full replace', async () => {
  const { store, read } = await freshStore();
  await store.loadStore();

  read().addReminders([task(), event()]);
  await settle();
  assert.deepEqual(
    onDisk().map((r) => r.id),
    ['t1', 'e1']
  );

  read().updateReminder('t1', { text: 'Finish the essay' });
  await settle();
  assert.equal(onDisk()[0].text, 'Finish the essay');
  assert.equal(read().reminders[0].text, 'Finish the essay');

  read().removeReminder('e1');
  await settle();
  assert.deepEqual(
    onDisk().map((r) => r.id),
    ['t1']
  );

  read().updateSettings({ nagIntervalMinutes: 120 });
  await settle();
  assert.equal(settingsOnDisk().nagIntervalMinutes, 120);
  assert.equal(settingsOnDisk().quietHours.start, '22:00', 'the whole settings object is written');

  read().clearAllReminders();
  await settle();
  assert.deepEqual(onDisk(), []);
  assert.equal(settingsOnDisk().nagIntervalMinutes, 120, 'Delete all keeps the settings');
});

test('duplicate ids are not added twice and unknown ids are ignored', async () => {
  const { store, read } = await freshStore();
  await store.loadStore();
  read().addReminders([task(), task()]);
  read().updateReminder('missing', { text: 'x' });
  read().removeReminder('missing');
  read().toggleDone('missing');
  await settle();
  assert.equal(read().reminders.length, 1);
});

test('toggleDone persists and rebuilds the notification schedule', async () => {
  __storage.data.set(REMINDERS_KEY, JSON.stringify([task()]));
  const { store, read } = await freshStore();
  await store.loadStore();
  await settle();
  assert.ok(notifications.scheduled.length > 0, 'an active task has nags scheduled');

  read().toggleDone('t1');
  await settle();
  assert.equal(read().reminders[0].status, 'done');
  assert.equal(onDisk()[0].status, 'done');
  assert.equal(notifications.scheduled.length, 0, 'a done task has no nags');

  read().toggleDone('t1');
  await settle();
  assert.equal(onDisk()[0].status, 'active');
  assert.ok(notifications.scheduled.length > 0);
});

test('the notification Done action is applied even if it arrives before loading', async () => {
  __storage.data.set(REMINDERS_KEY, JSON.stringify([task()]));
  const { store, read } = await freshStore();

  store.markDoneFromNotification('t1'); // before loadStore()
  store.markDoneFromNotification('missing');
  await store.whenLoaded();
  await settle();

  assert.equal(read().reminders[0].status, 'done');
  assert.equal(onDisk()[0].status, 'done');
});

test('load runs maintenance: a past one-off event is completed and saved', async () => {
  const past = fromNow(-HOUR);
  __storage.data.set(REMINDERS_KEY, JSON.stringify([event({ dueAt: past })]));
  const { store, read } = await freshStore();
  await store.loadStore();
  await settle();
  assert.equal(read().reminders[0].status, 'done');
  assert.equal(read().reminders[0].completedAt, past);
  assert.equal(onDisk()[0].status, 'done');
});

test('showToast shows a message; setCaptureText holds the text box', async () => {
  const { store, read } = await freshStore();
  await store.loadStore();
  read().showToast('Saved ✓');
  read().setCaptureText('call mom');
  assert.equal(read().toast, 'Saved ✓');
  assert.equal(read().captureText, 'call mom');
});

// --- storage that cannot be read ----------------------------------------------------

test('an unreadable store is never overwritten and never clears the schedule', async () => {
  const stored = [task(), event()];
  __storage.data.set(REMINDERS_KEY, JSON.stringify(stored));
  __storage.data.set(SETTINGS_KEY, JSON.stringify({ nagIntervalMinutes: 15 }));
  notifications.scheduled.push({ identifier: 'already-pending', content: {}, trigger: {} });
  __storage.failReads = true;

  const { store, read } = await freshStore();
  await store.loadStore();
  await settle();

  // The app still opens, with nothing to show yet.
  assert.equal(read().isLoaded, true);
  assert.deepEqual(read().reminders, []);
  assert.equal(notifications.cancelAllCalls, 0, 'pending notifications are left alone');
  assert.equal(notifications.scheduled.length, 1);

  // Whatever the user does next must not replace what is on disk.
  read().addReminders([task({ id: 'new', text: 'Added while unread' })]);
  read().toggleDone('new');
  read().updateSettings({ hapticsEnabled: false });
  await read().rescheduleAllNotifications();
  await settle();
  assert.deepEqual(onDisk(), stored);
  assert.equal(settingsOnDisk().nagIntervalMinutes, 15);
  assert.equal(notifications.cancelAllCalls, 0);
});

test('once storage can be read again, it is loaded and merged with what was added meanwhile', async () => {
  const stored = [task(), event()];
  __storage.data.set(REMINDERS_KEY, JSON.stringify(stored));
  __storage.data.set(SETTINGS_KEY, JSON.stringify({ nagIntervalMinutes: 15 }));
  __storage.failReads = true;

  const { store, read } = await freshStore();
  await store.loadStore();
  read().addReminders([task({ id: 'new', text: 'Added while unread' })]);
  store.markDoneFromNotification('t1'); // a Done tap for a reminder that is only on disk
  await settle();
  assert.equal(onDisk().length, 2, 'still untouched');

  // Reading works again; coming back to the app retries.
  __storage.failReads = false;
  read().runMaintenance();
  await settle();

  const after = read();
  assert.deepEqual(
    after.reminders.map((r) => r.id),
    ['t1', 'e1', 'new']
  );
  assert.equal(after.reminders[0].status, 'done', 'the queued Done tap was applied');
  assert.equal(after.settings.nagIntervalMinutes, 15);
  assert.deepEqual(
    onDisk().map((r) => [r.id, r.status]),
    [
      ['t1', 'done'],
      ['e1', 'active'],
      ['new', 'active'],
    ]
  );
  assert.ok(notifications.scheduled.length > 0, 'the schedule is rebuilt from the real data');

  // From here on, saving works normally again.
  read().removeReminder('new');
  await settle();
  assert.equal(onDisk().length, 2);
});

test('Delete all still clears the disk when the stored list could not be read', async () => {
  __storage.data.set(REMINDERS_KEY, JSON.stringify([task()]));
  __storage.failReads = true;
  const { store, read } = await freshStore();
  await store.loadStore();

  read().clearAllReminders();
  await settle();
  assert.deepEqual(onDisk(), []);

  read().addReminders([event()]);
  await settle();
  assert.deepEqual(
    onDisk().map((r) => r.id),
    ['e1'],
    'after Delete all the stored list is known, so saving resumes'
  );
});

test('damaged JSON is not protected: it loads as empty and the next save replaces it', async () => {
  __storage.data.set(REMINDERS_KEY, '{not json');
  const { store, read } = await freshStore();
  await store.loadStore();
  assert.deepEqual(read().reminders, []);
  read().addReminders([task()]);
  await settle();
  assert.deepEqual(
    onDisk().map((r) => r.id),
    ['t1']
  );
});
