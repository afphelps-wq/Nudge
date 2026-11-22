import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  MAX_REMINDERS,
  REMINDERS_KEY,
  SETTINGS_KEY,
  loadReminders,
  loadSettings,
  sanitizeReminders,
  sanitizeSettings,
  saveReminders,
  saveSettings,
} from '../../src/lib/storage.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/types.ts';
import { __storage } from './stubs/async-storage.mjs';

// Fixed UTC instants, so nothing here depends on the machine's time zone or clock.
const CREATED = '2026-11-21T15:00:00.000Z';
const DUE = '2026-11-24T20:00:00.000Z';
const NAG = '2026-11-24T17:00:00.000Z';
const DONE_AT = '2026-11-22T09:30:00.000Z';

const REMINDER_KEYS = [
  'completedAt',
  'createdAt',
  'dueAt',
  'id',
  'nagStartAt',
  'repeat',
  'status',
  'text',
  'type',
];

function task(overrides = {}) {
  return {
    id: 'task-1',
    text: 'Finish essay',
    type: 'task',
    dueAt: DUE,
    nagStartAt: NAG,
    repeat: null,
    status: 'active',
    completedAt: null,
    createdAt: CREATED,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'event-1',
    text: 'Dentist',
    type: 'event',
    dueAt: DUE,
    nagStartAt: null,
    repeat: null,
    status: 'active',
    completedAt: null,
    createdAt: CREATED,
    ...overrides,
  };
}

function customSettings() {
  return {
    quietHours: { enabled: false, start: '23:30', end: '06:45' },
    eventLeadMinutes: 10,
    nagIntervalMinutes: 15,
    defaultNagStartHours: 6,
    hapticsEnabled: false,
    hasAskedNotificationPermission: true,
  };
}

/** Silences console.warn for one test; call the result to get the calls recorded so far. */
function captureWarnings(t) {
  const warn = t.mock.method(console, 'warn', () => {});
  return () => warn.mock.calls;
}

/** Everything a warning printed, as one string (including error messages). */
function warningText(calls) {
  return calls
    .flatMap((call) => call.arguments)
    .map((argument) => (argument instanceof Error ? `${argument.message}\n${argument.stack}` : String(argument)))
    .join('\n');
}

/** Lets every pending promise callback run. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A promise plus the function that resolves it, to hold a stubbed write back. */
function gate() {
  let open = () => {};
  const closed = new Promise((resolve) => {
    open = resolve;
  });
  return { closed, open };
}

beforeEach(() => {
  __storage.reset();
});

// --- load / save ---------------------------------------------------------------

test('the storage keys are the versioned names from the spec', () => {
  assert.equal(REMINDERS_KEY, 'nudge.reminders.v1');
  assert.equal(SETTINGS_KEY, 'nudge.settings.v1');
});

test('reminders round-trip through save and load', async (t) => {
  const warnings = captureWarnings(t);
  const reminders = [
    task(),
    task({ id: 'task-2', text: 'Call mom', dueAt: null, nagStartAt: CREATED }),
    task({ id: 'task-3', status: 'done', completedAt: DONE_AT }),
    event(),
    event({ id: 'event-2', text: 'Gym', repeat: { kind: 'weekly', weekdays: [1, 3] } }),
    event({ id: 'event-3', text: 'Take meds', repeat: { kind: 'daily' } }),
    event({ id: 'event-4', status: 'done', completedAt: DUE }),
  ];
  await saveReminders(reminders);
  assert.equal(__storage.data.get(REMINDERS_KEY), JSON.stringify(reminders));
  assert.deepEqual(await loadReminders(), reminders);
  assert.equal(warnings().length, 0);
});

test('settings round-trip through save and load', async (t) => {
  const warnings = captureWarnings(t);
  const settings = customSettings();
  await saveSettings(settings);
  assert.equal(__storage.data.get(SETTINGS_KEY), JSON.stringify(settings));
  assert.deepEqual(await loadSettings(), settings);
  assert.equal(warnings().length, 0);
});

test('every save replaces the whole stored value', async () => {
  await saveReminders([task(), event()]);
  await saveReminders([event()]);
  assert.deepEqual(await loadReminders(), [event()]);
  await saveReminders([]);
  assert.equal(__storage.data.get(REMINDERS_KEY), '[]');
  assert.deepEqual(await loadReminders(), []);
  assert.deepEqual(
    __storage.writes.map(([key]) => key),
    [REMINDERS_KEY, REMINDERS_KEY, REMINDERS_KEY]
  );
});

test('missing keys load as an empty list and fresh defaults, without a warning', async (t) => {
  const warnings = captureWarnings(t);
  assert.deepEqual(await loadReminders(), []);
  const settings = await loadSettings();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.notEqual(settings, DEFAULT_SETTINGS);
  assert.notEqual(settings.quietHours, DEFAULT_SETTINGS.quietHours);
  assert.equal(warnings().length, 0);
});

test('corrupt JSON loads as empty and defaults, and warns without quoting what was stored', async (t) => {
  const warnings = captureWarnings(t);
  __storage.data.set(REMINDERS_KEY, 'SECRET dentist at 3');
  __storage.data.set(SETTINGS_KEY, '{"hapticsEnabled": false, SECRET');

  assert.deepEqual(await loadReminders(), []);
  const settings = await loadSettings();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.notEqual(settings, DEFAULT_SETTINGS);

  assert.equal(warnings().length, 2);
  assert.equal(warnings()[0].arguments[0], '[nudge] could not load reminders');
  assert.equal(warnings()[1].arguments[0], '[nudge] could not load settings');
  assert.ok(warnings()[0].arguments[1] instanceof Error);
  assert.ok(!warningText(warnings()).includes('SECRET'));
});

test('valid JSON of the wrong shape loads as empty and defaults', async (t) => {
  const warnings = captureWarnings(t);
  __storage.data.set(REMINDERS_KEY, '{"id":"a"}');
  __storage.data.set(SETTINGS_KEY, '[1,2,3]');
  assert.deepEqual(await loadReminders(), []);
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);

  __storage.data.set(REMINDERS_KEY, 'null');
  __storage.data.set(SETTINGS_KEY, 'null');
  assert.deepEqual(await loadReminders(), []);
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);
  assert.equal(warnings().length, 0);
});

test('loading sanitises what was stored', async () => {
  __storage.data.set(
    REMINDERS_KEY,
    JSON.stringify([task(), { id: 'broken' }, event({ dueAt: null }), task()])
  );
  __storage.data.set(SETTINGS_KEY, JSON.stringify({ nagIntervalMinutes: 30, eventLeadMinutes: 7 }));
  assert.deepEqual(await loadReminders(), [task()]);
  assert.deepEqual(await loadSettings(), { ...DEFAULT_SETTINGS, nagIntervalMinutes: 30 });
});

test('a read failure loads as empty and defaults, and warns', async (t) => {
  const warnings = captureWarnings(t);
  await saveReminders([task()]);
  await saveSettings(customSettings());
  __storage.failReads = true;

  assert.deepEqual(await loadReminders(), []);
  const settings = await loadSettings();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.notEqual(settings, DEFAULT_SETTINGS);
  assert.equal(warnings().length, 2);
  assert.equal(warnings()[0].arguments[0], '[nudge] could not load reminders');
  assert.equal(warnings()[1].arguments[0], '[nudge] could not load settings');
});

test('a failed write warns instead of rejecting', async (t) => {
  const warnings = captureWarnings(t);
  __storage.failWrites = true;
  assert.equal(await saveReminders([task()]), undefined);
  assert.equal(await saveSettings(customSettings()), undefined);
  assert.equal(__storage.data.size, 0);
  assert.equal(warnings().length, 2);
  assert.equal(warnings()[0].arguments[0], '[nudge] could not save reminders');
  assert.equal(warnings()[1].arguments[0], '[nudge] could not save settings');
  assert.ok(!warningText(warnings()).includes('Finish essay'));
});

test('a failed write does not block the next write to the same key', async (t) => {
  const warnings = captureWarnings(t);
  let calls = 0;
  __storage.beforeWrite = () => {
    calls += 1;
    if (calls === 1) throw new Error('disk full (test)');
  };
  const first = saveReminders([task()]);
  const second = saveReminders([task(), event()]);
  await Promise.all([first, second]);

  assert.equal(calls, 2);
  assert.equal(warnings().length, 1);
  assert.deepEqual(await loadReminders(), [task(), event()]);
});

test('writes to one key land in call order, one at a time', async () => {
  const firstWrite = gate();
  const started = [];
  __storage.beforeWrite = (_key, value) => {
    started.push(value);
    // Only the first write is slow; unchained, the later ones would overtake it.
    return started.length === 1 ? firstWrite.closed : undefined;
  };
  const lists = [[task()], [task(), event()], [event()]];
  const saves = lists.map((list) => saveReminders(list));

  await settle();
  assert.deepEqual(started, [JSON.stringify(lists[0])]);
  assert.equal(__storage.writes.length, 0);

  firstWrite.open();
  await Promise.all(saves);
  assert.deepEqual(
    __storage.writes,
    lists.map((list) => [REMINDERS_KEY, JSON.stringify(list)])
  );
  assert.deepEqual(await loadReminders(), [event()]);
});

test('a slow write to one key does not hold up the other key', async () => {
  const remindersWrite = gate();
  __storage.beforeWrite = (key) => (key === REMINDERS_KEY ? remindersWrite.closed : undefined);
  const slow = saveReminders([task()]);
  await saveSettings(customSettings());

  assert.equal(__storage.data.has(REMINDERS_KEY), false);
  assert.equal(__storage.data.get(SETTINGS_KEY), JSON.stringify(customSettings()));

  remindersWrite.open();
  await slow;
  assert.deepEqual(await loadReminders(), [task()]);
});

test('a save writes the value as it was when save was called', async () => {
  const held = gate();
  __storage.beforeWrite = () => held.closed;
  const list = [task()];
  const saving = saveReminders(list);
  list.push(event());
  held.open();
  await saving;
  assert.deepEqual(await loadReminders(), [task()]);
});

// --- sanitizeReminders -----------------------------------------------------------

test('sanitizeReminders accepts only an array', () => {
  for (const raw of [undefined, null, 0, 42, '', 'reminders', true, {}, { 0: task(), length: 1 }]) {
    assert.deepEqual(sanitizeReminders(raw), []);
  }
  assert.deepEqual(sanitizeReminders([]), []);
  assert.deepEqual(sanitizeReminders([task(), event()]), [task(), event()]);
});

test('sanitizeReminders drops items that are not plain objects', () => {
  const raw = [null, undefined, 7, 'task', true, [], [task()], new Date(0), new Map(), task()];
  assert.deepEqual(sanitizeReminders(raw), [task()]);
  assert.deepEqual(sanitizeReminders(new Array(3)), []);
});

test('sanitizeReminders drops items with missing or wrongly typed fields', () => {
  const bad = [
    task({ id: undefined }),
    task({ id: '' }),
    task({ id: 42 }),
    task({ id: null }),
    task({ text: undefined }),
    task({ text: '' }),
    task({ text: '   \n ' }),
    task({ text: 12 }),
    task({ text: ['Finish essay'] }),
    task({ type: 'chore' }),
    task({ type: undefined }),
    task({ type: 1 }),
    task({ status: 'pending' }),
    task({ status: undefined }),
    task({ status: true }),
    task({ createdAt: undefined }),
    task({ createdAt: null }),
    task({ createdAt: 1795791600000 }),
    task({ dueAt: 1795791600000 }),
    task({ dueAt: {} }),
    task({ dueAt: false }),
    task({ nagStartAt: 5 }),
    task({ nagStartAt: [] }),
    task({ completedAt: 0 }),
    task({ completedAt: true }),
    event({ dueAt: 1795791600000 }),
  ];
  for (const item of bad) {
    assert.deepEqual(sanitizeReminders([item]), [], JSON.stringify(item));
  }
  assert.deepEqual(sanitizeReminders([...bad, event()]), [event()]);
});

test('sanitizeReminders drops items with unparsable dates', () => {
  const bad = [
    task({ createdAt: 'yesterday-ish' }),
    task({ createdAt: '' }),
    task({ dueAt: 'not a date' }),
    task({ dueAt: '' }),
    task({ dueAt: '2026-13-45T99:00:00.000Z' }),
    task({ nagStartAt: 'soon' }),
    task({ status: 'done', completedAt: 'whenever' }),
    event({ dueAt: 'Tuesday maybe' }),
    event({ nagStartAt: 'soon' }),
  ];
  for (const item of bad) {
    assert.deepEqual(sanitizeReminders([item]), [], JSON.stringify(item));
  }
});

test('sanitizeReminders stores dates in canonical ISO form', () => {
  const [reminder] = sanitizeReminders([
    task({
      createdAt: '2026-11-21T15:00:00Z',
      dueAt: '2026-11-24T21:00:00+01:00',
      nagStartAt: '2026-11-24T17:00Z',
      status: 'done',
      completedAt: '2026-11-22T09:30:00.000Z',
    }),
  ]);
  assert.equal(reminder.createdAt, CREATED);
  assert.equal(reminder.dueAt, DUE);
  assert.equal(reminder.nagStartAt, NAG);
  assert.equal(reminder.completedAt, DONE_AT);
});

test('sanitizeReminders enforces the event invariants', () => {
  // An event must have a time.
  assert.deepEqual(sanitizeReminders([event({ dueAt: null })]), []);
  assert.deepEqual(sanitizeReminders([event({ dueAt: undefined })]), []);
  // Events never nag, and may repeat.
  const repeat = { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] };
  const [reminder] = sanitizeReminders([event({ nagStartAt: NAG, repeat })]);
  assert.deepEqual(reminder, event({ nagStartAt: null, repeat }));
});

test('sanitizeReminders enforces the task invariants', () => {
  // Tasks never repeat.
  assert.deepEqual(sanitizeReminders([task({ repeat: { kind: 'daily' } })]), [task()]);
  // A task always has a nag start; a missing one falls back to createdAt.
  assert.deepEqual(sanitizeReminders([task({ nagStartAt: null })]), [task({ nagStartAt: CREATED })]);
  assert.deepEqual(sanitizeReminders([task({ nagStartAt: undefined })]), [
    task({ nagStartAt: CREATED }),
  ]);
  // A task may have no deadline.
  assert.deepEqual(sanitizeReminders([task({ dueAt: null })]), [task({ dueAt: null })]);
  assert.deepEqual(sanitizeReminders([task({ dueAt: undefined })]), [task({ dueAt: null })]);
});

test('sanitizeReminders keeps status and completedAt consistent', () => {
  assert.deepEqual(sanitizeReminders([task({ status: 'done', completedAt: null })]), [
    task({ status: 'done', completedAt: CREATED }),
  ]);
  assert.deepEqual(sanitizeReminders([event({ status: 'done', completedAt: undefined })]), [
    event({ status: 'done', completedAt: CREATED }),
  ]);
  assert.deepEqual(sanitizeReminders([task({ status: 'done', completedAt: DONE_AT })]), [
    task({ status: 'done', completedAt: DONE_AT }),
  ]);
  assert.deepEqual(sanitizeReminders([task({ status: 'active', completedAt: DONE_AT })]), [task()]);
});

test('sanitizeReminders trims the title and clamps it to 120 characters', () => {
  assert.equal(sanitizeReminders([task({ text: '  Call mom \n' })])[0].text, 'Call mom');

  assert.equal(sanitizeReminders([task({ text: 'a'.repeat(120) })])[0].text, 'a'.repeat(120));
  assert.equal(sanitizeReminders([task({ text: 'a'.repeat(500) })])[0].text, 'a'.repeat(120));

  // The cut must not leave a trailing space or half of an emoji behind.
  const spaced = sanitizeReminders([task({ text: `${'a'.repeat(119)} bcd` })])[0].text;
  assert.equal(spaced, 'a'.repeat(119));
  const emoji = sanitizeReminders([task({ text: `${'a'.repeat(119)}\u{1F600}tail` })])[0].text;
  assert.equal(emoji, 'a'.repeat(119));
});

test('sanitizeReminders validates and normalises repeat', () => {
  const repeatOf = (repeat) => sanitizeReminders([event({ repeat })])[0]?.repeat;

  assert.equal(repeatOf(null), null);
  assert.equal(repeatOf(undefined), null);
  assert.deepEqual(repeatOf({ kind: 'daily' }), { kind: 'daily' });
  assert.deepEqual(repeatOf({ kind: 'daily', weekdays: [1], extra: true }), { kind: 'daily' });
  assert.deepEqual(repeatOf({ kind: 'weekly', weekdays: [1, 3] }), { kind: 'weekly', weekdays: [1, 3] });
  // Sorted, unique, 0–6 only.
  assert.deepEqual(repeatOf({ kind: 'weekly', weekdays: [5, 1, 1, 9, -1, 2.5, 3] }), {
    kind: 'weekly',
    weekdays: [1, 3, 5],
  });
  // A weekly repeat with no usable day is "doesn't repeat".
  assert.equal(repeatOf({ kind: 'weekly', weekdays: [] }), null);
  assert.equal(repeatOf({ kind: 'weekly', weekdays: [7, 8] }), null);

  // Anything that is not one of the three shapes drops the reminder.
  const bad = [
    'daily',
    1,
    true,
    [],
    {},
    { kind: 'monthly' },
    { kind: 'weekly' },
    { kind: 'weekly', weekdays: 'mon' },
    { kind: 'weekly', weekdays: ['1', '3'] },
    { kind: 'weekly', weekdays: [1, null] },
    { kind: 'weekly', weekdays: { 0: 1 } },
  ];
  for (const repeat of bad) {
    assert.deepEqual(sanitizeReminders([event({ repeat })]), [], JSON.stringify(repeat));
  }
});

test('sanitizeReminders keeps the first of two reminders with the same id', () => {
  const result = sanitizeReminders([
    task({ id: 'same', text: 'First' }),
    event({ id: 'other' }),
    event({ id: 'same', text: 'Second' }),
    task({ id: 'same', text: 'Third' }),
  ]);
  assert.deepEqual(result, [task({ id: 'same', text: 'First' }), event({ id: 'other' })]);

  // An invalid item does not reserve its id.
  assert.deepEqual(sanitizeReminders([task({ id: 'x', text: '' }), event({ id: 'x' })]), [
    event({ id: 'x' }),
  ]);
});

test('sanitizeReminders ignores unknown and prototype keys', () => {
  const stored = JSON.stringify([task({ extra: 'x', notes: { deep: true }, toString: 'nope' })]);
  const polluted = stored.replace('{', '{"__proto__":{"polluted":true,"text":"Injected"},');
  assert.ok(polluted.includes('__proto__'));

  const [reminder] = sanitizeReminders(JSON.parse(polluted));
  assert.deepEqual(reminder, task());
  assert.deepEqual(Object.keys(reminder).sort(), REMINDER_KEYS);
  assert.equal(Object.getPrototypeOf(reminder), Object.prototype);
  assert.equal(Object.hasOwn(reminder, '__proto__'), false);
  assert.equal(reminder.polluted, undefined);
  assert.equal({}.polluted, undefined);

  // Fields that only exist on a prototype are not read.
  assert.deepEqual(sanitizeReminders(JSON.parse(`[{"__proto__":${JSON.stringify(task())}}]`)), []);
  assert.deepEqual(sanitizeReminders([Object.create(task())]), []);
});

test('sanitizeReminders caps the list', () => {
  const many = Array.from({ length: MAX_REMINDERS + 25 }, (_, index) => task({ id: `task-${index}` }));
  const result = sanitizeReminders(many);
  assert.equal(MAX_REMINDERS, 1000);
  assert.equal(result.length, MAX_REMINDERS);
  assert.equal(result[0].id, 'task-0');
  assert.equal(result[MAX_REMINDERS - 1].id, `task-${MAX_REMINDERS - 1}`);
});

test('sanitizeReminders returns new objects and leaves its input alone', () => {
  const repeat = { kind: 'weekly', weekdays: [3, 1] };
  const input = [event({ repeat, nagStartAt: NAG })];
  const snapshot = JSON.stringify(input);
  const [reminder] = sanitizeReminders(input);

  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(reminder, input[0]);
  assert.notEqual(reminder.repeat, repeat);
  assert.deepEqual(reminder.repeat, { kind: 'weekly', weekdays: [1, 3] });
});

// --- sanitizeSettings ------------------------------------------------------------

test('sanitizeSettings returns fresh defaults for anything that is not an object', () => {
  for (const raw of [undefined, null, 0, 1, '', 'settings', true, [], [customSettings()]]) {
    const settings = sanitizeSettings(raw);
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.notEqual(settings, DEFAULT_SETTINGS);
    assert.notEqual(settings.quietHours, DEFAULT_SETTINGS.quietHours);
  }
  assert.notEqual(sanitizeSettings({}), sanitizeSettings({}));
});

test('sanitizeSettings keeps a complete, valid object and copies it', () => {
  const input = customSettings();
  const settings = sanitizeSettings(input);
  assert.deepEqual(settings, customSettings());
  assert.notEqual(settings, input);
  assert.notEqual(settings.quietHours, input.quietHours);
  assert.deepEqual(input, customSettings());
});

test('sanitizeSettings fills in missing fields from the defaults', () => {
  assert.deepEqual(sanitizeSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ hapticsEnabled: false }), {
    ...DEFAULT_SETTINGS,
    hapticsEnabled: false,
  });
  assert.deepEqual(sanitizeSettings({ eventLeadMinutes: 0, hasAskedNotificationPermission: true }), {
    ...DEFAULT_SETTINGS,
    eventLeadMinutes: 0,
    hasAskedNotificationPermission: true,
  });
  // quietHours is merged field by field too.
  assert.deepEqual(sanitizeSettings({ quietHours: { enabled: false } }).quietHours, {
    enabled: false,
    start: '22:00',
    end: '08:00',
  });
  assert.deepEqual(sanitizeSettings({ quietHours: { end: '07:15' } }).quietHours, {
    enabled: true,
    start: '22:00',
    end: '07:15',
  });
});

test('sanitizeSettings replaces invalid fields with the defaults and keeps the valid ones', () => {
  const settings = sanitizeSettings({
    quietHours: { enabled: 'yes', start: '25:00', end: '07:30' },
    eventLeadMinutes: 45,
    nagIntervalMinutes: 30,
    defaultNagStartHours: '3',
    hapticsEnabled: 0,
    hasAskedNotificationPermission: true,
  });
  assert.deepEqual(settings, {
    quietHours: { enabled: true, start: '22:00', end: '07:30' },
    eventLeadMinutes: 30,
    nagIntervalMinutes: 30,
    defaultNagStartHours: 3,
    hapticsEnabled: true,
    hasAskedNotificationPermission: true,
  });

  for (const quietHours of [null, 'off', 7, [], ['22:00', '08:00']]) {
    assert.deepEqual(sanitizeSettings({ quietHours }).quietHours, DEFAULT_SETTINGS.quietHours);
  }
  for (const time of [null, 2200, '', '10pm', '22:60', '24:00', '22:00:00', ' 22:00', '-1:00']) {
    assert.equal(sanitizeSettings({ quietHours: { start: time } }).quietHours.start, '22:00');
    assert.equal(sanitizeSettings({ quietHours: { end: time } }).quietHours.end, '08:00');
  }
  for (const value of [null, '30', 30.5, 5, -15, 1e9, NaN, true, [30], {}]) {
    const result = sanitizeSettings({
      eventLeadMinutes: value,
      nagIntervalMinutes: value,
      defaultNagStartHours: value,
    });
    assert.deepEqual(result, DEFAULT_SETTINGS, String(value));
  }
  for (const value of [null, 'true', 1, 0, [], {}]) {
    const result = sanitizeSettings({
      hapticsEnabled: value,
      hasAskedNotificationPermission: value,
    });
    assert.deepEqual(result, DEFAULT_SETTINGS, String(value));
  }
});

test('sanitizeSettings accepts every option offered in Settings', () => {
  for (const value of [0, 10, 15, 30, 60]) {
    assert.equal(sanitizeSettings({ eventLeadMinutes: value }).eventLeadMinutes, value);
  }
  for (const value of [15, 30, 60, 120]) {
    assert.equal(sanitizeSettings({ nagIntervalMinutes: value }).nagIntervalMinutes, value);
  }
  for (const value of [1, 2, 3, 6]) {
    assert.equal(sanitizeSettings({ defaultNagStartHours: value }).defaultNagStartHours, value);
  }
  // Options of one setting are not valid for another.
  assert.equal(sanitizeSettings({ eventLeadMinutes: 120 }).eventLeadMinutes, 30);
  assert.equal(sanitizeSettings({ nagIntervalMinutes: 10 }).nagIntervalMinutes, 60);
  assert.equal(sanitizeSettings({ defaultNagStartHours: 0 }).defaultNagStartHours, 3);

  for (const time of ['00:00', '08:00', '12:30', '23:59']) {
    const { quietHours } = sanitizeSettings({ quietHours: { start: time, end: time } });
    assert.equal(quietHours.start, time);
    assert.equal(quietHours.end, time);
  }
  // A one-digit hour is stored in the two-digit form the rest of the app writes.
  assert.equal(sanitizeSettings({ quietHours: { start: '7:05' } }).quietHours.start, '07:05');
});

test('sanitizeSettings ignores unknown and prototype keys', () => {
  const stored =
    '{"__proto__":{"hapticsEnabled":false,"polluted":true},' +
    '"quietHours":{"__proto__":{"enabled":false},"start":"21:00","extra":1},' +
    '"nagIntervalMinutes":15,"theme":"dark","constructor":{"prototype":{"polluted":true}}}';
  const settings = sanitizeSettings(JSON.parse(stored));

  assert.deepEqual(settings, {
    ...DEFAULT_SETTINGS,
    quietHours: { enabled: true, start: '21:00', end: '08:00' },
    nagIntervalMinutes: 15,
  });
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.deepEqual(Object.keys(settings.quietHours).sort(), ['enabled', 'end', 'start']);
  assert.equal(Object.getPrototypeOf(settings), Object.prototype);
  assert.equal({}.polluted, undefined);

  // Fields that only exist on a prototype are not read.
  assert.deepEqual(sanitizeSettings(Object.create(customSettings())), DEFAULT_SETTINGS);
});

test('sanitizeSettings never hands out or changes DEFAULT_SETTINGS', () => {
  const before = JSON.stringify(DEFAULT_SETTINGS);
  const settings = sanitizeSettings(undefined);
  settings.hapticsEnabled = false;
  settings.quietHours.start = '01:00';
  assert.equal(JSON.stringify(DEFAULT_SETTINGS), before);
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
});
