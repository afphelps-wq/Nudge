import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeTaskCount,
  applyMaintenance,
  applyMarkDone,
  applyToggleDone,
  buildSections,
  defaultNagStart,
  draftToPatch,
  draftToReminder,
  emptyTaskDraft,
  getNagChoice,
  getRepeatChoice,
  isCompletedToday,
  isDraftValid,
  isOverdue,
  newReminderId,
  nextFullHour,
  pickerValue,
  reminderSubtitle,
  reminderToDraft,
  repeatForChoice,
  setDraftDueAt,
  setDraftNagChoice,
  setDraftNagStart,
  setDraftNotSure,
  setDraftRepeat,
  setDraftType,
  whenChipLabel,
} from '../../src/lib/reminders.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/types.ts';

// Sat Nov 21 2026, 10:00 AM local — the reference "now" in SPEC.md.
const NOW = new Date(2026, 10, 21, 10, 0, 0, 0);
const S = DEFAULT_SETTINGS;

const at = (day, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute, 0, 0);
const iso = (day, hour = 0, minute = 0) => at(day, hour, minute).toISOString();

function task(overrides = {}) {
  return {
    id: 't1',
    text: 'Finish essay',
    type: 'task',
    dueAt: null,
    nagStartAt: iso(21, 9),
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

function draft(overrides = {}) {
  return {
    key: 'k1',
    text: 'Call mom',
    type: 'task',
    dueAt: null,
    needsTime: false,
    pickerPreset: at(21, 11),
    nagStartAt: null,
    repeat: null,
    ...overrides,
  };
}

// --- time helpers ---------------------------------------------------------------

test('nextFullHour is strictly after now', () => {
  assert.equal(nextFullHour(at(21, 10, 0)).getTime(), at(21, 11).getTime());
  assert.equal(nextFullHour(at(21, 10, 20)).getTime(), at(21, 11).getTime());
  assert.equal(nextFullHour(at(21, 23, 30)).getTime(), at(22, 0).getTime());
});

test('defaultNagStart is the default lead before the deadline, never before now', () => {
  assert.equal(defaultNagStart(at(21, 17), NOW, S).getTime(), at(21, 14).getTime());
  assert.equal(defaultNagStart(at(21, 11), NOW, S).getTime(), NOW.getTime());
  assert.equal(defaultNagStart(null, NOW, S).getTime(), NOW.getTime());
  const sixHours = { ...S, defaultNagStartHours: 6 };
  assert.equal(defaultNagStart(at(22, 9), NOW, sixHours).getTime(), at(22, 3).getTime());
});

test('newReminderId gives distinct base-36 ids', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newReminderId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-z]+$/);
});

// --- validity ---------------------------------------------------------------------

test('isDraftValid follows the card rules', () => {
  assert.equal(isDraftValid(draft(), NOW), true, 'task with no deadline');
  assert.equal(isDraftValid(draft({ text: '   ' }), NOW), false, 'empty title');
  assert.equal(isDraftValid(draft({ needsTime: true }), NOW), false, 'needs a time');
  assert.equal(isDraftValid(draft({ dueAt: at(20, 9) }), NOW), true, 'task with a past deadline');
  assert.equal(isDraftValid(draft({ type: 'event', dueAt: at(21, 15) }), NOW), true, 'future event');
  assert.equal(isDraftValid(draft({ type: 'event', dueAt: at(21, 9) }), NOW), false, 'past event');
  assert.equal(isDraftValid(draft({ type: 'event', dueAt: null }), NOW), false, 'event, no time');
  assert.equal(
    isDraftValid(draft({ type: 'event', dueAt: new Date(NOW) }), NOW),
    false,
    'event exactly now is not in the future'
  );
});

test('emptyTaskDraft is a task that asks for a time', () => {
  const d = emptyTaskDraft('  something  ', NOW);
  assert.equal(d.type, 'task');
  assert.equal(d.text, 'something');
  assert.equal(d.needsTime, true);
  assert.equal(d.dueAt, null);
  assert.equal(d.nagStartAt, null);
  assert.equal(d.repeat, null);
  assert.equal(d.pickerPreset.getTime(), at(21, 11).getTime());
  assert.notEqual(emptyTaskDraft('a', NOW).key, emptyTaskDraft('a', NOW).key);
});

// --- draft <-> reminder ---------------------------------------------------------------

test('draftToReminder builds an active task and clamps the nag start', () => {
  const chosen = draftToReminder(
    draft({ text: '  Finish essay ', dueAt: at(21, 17), nagStartAt: at(21, 14) }),
    NOW,
    S
  );
  assert.equal(chosen.text, 'Finish essay');
  assert.equal(chosen.type, 'task');
  assert.equal(chosen.dueAt, iso(21, 17));
  assert.equal(chosen.nagStartAt, iso(21, 14));
  assert.equal(chosen.repeat, null);
  assert.equal(chosen.status, 'active');
  assert.equal(chosen.completedAt, null);
  assert.equal(chosen.createdAt, NOW.toISOString());
  assert.ok(chosen.id.length > 0);

  const inPast = draftToReminder(draft({ dueAt: at(21, 17), nagStartAt: at(21, 8) }), NOW, S);
  assert.equal(inPast.nagStartAt, NOW.toISOString(), 'a start in the past becomes now');

  const afterDue = draftToReminder(draft({ dueAt: at(21, 17), nagStartAt: at(21, 19) }), NOW, S);
  assert.equal(afterDue.nagStartAt, iso(21, 17), 'a start after the deadline becomes the deadline');

  const noChoice = draftToReminder(draft({ dueAt: at(21, 17) }), NOW, S);
  assert.equal(noChoice.nagStartAt, iso(21, 14), 'no choice uses the default lead');

  const noDeadline = draftToReminder(draft(), NOW, S);
  assert.equal(noDeadline.dueAt, null);
  assert.equal(noDeadline.nagStartAt, NOW.toISOString());

  const overdue = draftToReminder(draft({ dueAt: at(20, 9), nagStartAt: at(20, 6) }), NOW, S);
  assert.equal(overdue.nagStartAt, NOW.toISOString(), 'a deadline in the past nags from now');

  const stray = draftToReminder(draft({ repeat: { kind: 'daily' } }), NOW, S);
  assert.equal(stray.repeat, null, 'tasks never repeat');
});

test('draftToReminder builds an event with no nag start and a normalised repeat', () => {
  const r = draftToReminder(
    draft({
      type: 'event',
      text: 'Gym',
      dueAt: at(23, 7),
      nagStartAt: at(22, 7),
      repeat: { kind: 'weekly', weekdays: [3, 1, 1] },
    }),
    NOW,
    S
  );
  assert.equal(r.type, 'event');
  assert.equal(r.dueAt, iso(23, 7));
  assert.equal(r.nagStartAt, null);
  assert.deepEqual(r.repeat, { kind: 'weekly', weekdays: [1, 3] });
});

test('reminderToDraft prefills a card and survives damaged dates', () => {
  const d = reminderToDraft(task({ dueAt: iso(21, 17), nagStartAt: iso(21, 14) }), NOW);
  assert.equal(d.key, 't1');
  assert.equal(d.text, 'Finish essay');
  assert.equal(d.type, 'task');
  assert.equal(d.dueAt.getTime(), at(21, 17).getTime());
  assert.equal(d.nagStartAt.getTime(), at(21, 14).getTime());
  assert.equal(d.needsTime, false);
  assert.equal(d.repeat, null);

  const e = reminderToDraft(event({ repeat: { kind: 'daily' } }), NOW);
  assert.equal(e.nagStartAt, null);
  assert.deepEqual(e.repeat, { kind: 'daily' });

  const damaged = reminderToDraft(task({ dueAt: 'not a date', nagStartAt: 'nope' }), NOW);
  assert.equal(damaged.dueAt, null);
  assert.equal(damaged.nagStartAt, null);
  assert.ok(!Number.isNaN(damaged.pickerPreset.getTime()));
});

test('draftToPatch returns only what changed', () => {
  const original = task({ dueAt: iso(21, 17), nagStartAt: iso(21, 14) });
  const unchanged = reminderToDraft(original, NOW);
  assert.deepEqual(draftToPatch(unchanged, original, NOW, S), {});

  assert.deepEqual(draftToPatch({ ...unchanged, text: ' New title ' }, original, NOW, S), {
    text: 'New title',
  });
});

test('draftToPatch does not restart a nag that is already running', () => {
  const original = task({ dueAt: iso(21, 17), nagStartAt: iso(21, 8) }); // nagging since 8 AM
  const renamed = { ...reminderToDraft(original, NOW), text: 'Finish the essay' };
  assert.deepEqual(draftToPatch(renamed, original, NOW, S), { text: 'Finish the essay' });
});

test('draftToPatch re-activates a done reminder when its time or type changes', () => {
  const done = event({ dueAt: iso(21, 9), status: 'done', completedAt: iso(21, 9) });
  const moved = { ...reminderToDraft(done, NOW), dueAt: at(22, 9) };
  const patch = draftToPatch(moved, done, NOW, S);
  assert.equal(patch.dueAt, iso(22, 9));
  assert.equal(patch.status, 'active');
  assert.equal(patch.completedAt, null);

  const renamedOnly = { ...reminderToDraft(done, NOW), text: 'Dentist visit' };
  const renamePatch = draftToPatch(renamedOnly, done, NOW, S);
  assert.deepEqual(renamePatch, { text: 'Dentist visit' }, 'a rename keeps it done');
});

test('draftToPatch handles a type change in both directions', () => {
  const original = event({ repeat: { kind: 'daily' } });
  const asTask = setDraftType(reminderToDraft(original, NOW), 'task', NOW, S);
  const toTask = draftToPatch(asTask, original, NOW, S);
  assert.equal(toTask.type, 'task');
  assert.equal(toTask.repeat, null);
  assert.equal(typeof toTask.nagStartAt, 'string');

  const originalTask = task({ dueAt: iso(24, 15), nagStartAt: iso(24, 12) });
  const asEvent = setDraftType(reminderToDraft(originalTask, NOW), 'event', NOW, S);
  const toEvent = draftToPatch(asEvent, originalTask, NOW, S);
  assert.equal(toEvent.type, 'event');
  assert.equal(toEvent.nagStartAt, null);
});

// --- card editing rules ---------------------------------------------------------------------

test('setDraftType: to event clears the nag start and asks for a time when there is none', () => {
  const noDeadline = draft({ nagStartAt: new Date(NOW) });
  const asEvent = setDraftType(noDeadline, 'event', NOW, S);
  assert.equal(asEvent.type, 'event');
  assert.equal(asEvent.nagStartAt, null);
  assert.equal(asEvent.needsTime, true);
  assert.equal(noDeadline.type, 'task', 'the input draft is not mutated');

  const withDeadline = draft({ dueAt: at(21, 17), nagStartAt: at(21, 14) });
  const eventWithTime = setDraftType(withDeadline, 'event', NOW, S);
  assert.equal(eventWithTime.needsTime, false);
  assert.equal(eventWithTime.dueAt.getTime(), at(21, 17).getTime());
});

test('setDraftType: to task drops the repeat and applies the default nag start', () => {
  const e = draft({ type: 'event', dueAt: at(21, 17), repeat: { kind: 'daily' } });
  const asTask = setDraftType(e, 'task', NOW, S);
  assert.equal(asTask.type, 'task');
  assert.equal(asTask.repeat, null);
  assert.equal(asTask.nagStartAt.getTime(), at(21, 14).getTime());

  const stillAsking = setDraftType(
    draft({ type: 'event', needsTime: true, dueAt: null }),
    'task',
    NOW,
    S
  );
  assert.equal(stillAsking.needsTime, true);
  assert.equal(stillAsking.nagStartAt, null);
});

test('setDraftDueAt clears needsTime and zeroes the seconds', () => {
  const picked = new Date(2026, 10, 21, 17, 0, 42, 500);
  const d = setDraftDueAt(draft({ needsTime: true }), picked, NOW, S);
  assert.equal(d.needsTime, false);
  assert.equal(d.dueAt.getTime(), at(21, 17).getTime());
  assert.equal(d.nagStartAt.getTime(), at(21, 14).getTime(), 'default lead for a new deadline');
});

test('setDraftDueAt keeps the chosen "hours before" when the deadline moves', () => {
  const oneHourBefore = draft({ dueAt: at(21, 17), nagStartAt: at(21, 16) });
  const moved = setDraftDueAt(oneHourBefore, at(22, 9), NOW, S);
  assert.equal(moved.nagStartAt.getTime(), at(22, 8).getTime());

  const custom = draft({ dueAt: at(21, 17), nagStartAt: at(21, 12, 45) });
  const later = setDraftDueAt(custom, at(22, 9), NOW, S);
  assert.equal(later.nagStartAt.getTime(), at(21, 12, 45).getTime(), 'a custom time is kept');
  const earlier = setDraftDueAt(custom, at(21, 12), NOW, S);
  assert.equal(earlier.nagStartAt.getTime(), at(21, 12).getTime(), 'but never after the deadline');
});

test('setDraftDueAt on an event moves a single-day weekly repeat with the date', () => {
  const monday = draft({
    type: 'event',
    dueAt: at(23, 7),
    repeat: { kind: 'weekly', weekdays: [1] },
  });
  const tuesday = setDraftDueAt(monday, at(24, 7), NOW, S);
  assert.deepEqual(tuesday.repeat, { kind: 'weekly', weekdays: [2] });
  assert.equal(tuesday.nagStartAt, null);

  const multi = draft({
    type: 'event',
    dueAt: at(23, 7),
    repeat: { kind: 'weekly', weekdays: [1, 3] },
  });
  assert.deepEqual(setDraftDueAt(multi, at(24, 7), NOW, S).repeat, {
    kind: 'weekly',
    weekdays: [1, 3],
  });
});

test('setDraftNotSure makes a no-deadline task that nags from now', () => {
  const d = setDraftNotSure(
    draft({ type: 'event', needsTime: true, repeat: { kind: 'daily' } }),
    NOW
  );
  assert.equal(d.type, 'task');
  assert.equal(d.dueAt, null);
  assert.equal(d.needsTime, false);
  assert.equal(d.nagStartAt.getTime(), NOW.getTime());
  assert.equal(d.repeat, null);
});

test('pickerValue always gives a usable date', () => {
  assert.equal(pickerValue(draft({ dueAt: at(21, 17) }), NOW).getTime(), at(21, 17).getTime());
  assert.equal(
    pickerValue(draft({ needsTime: true, pickerPreset: at(24, 9) }), NOW).getTime(),
    at(24, 9).getTime()
  );
  assert.equal(
    pickerValue(draft({ needsTime: true, pickerPreset: at(21, 9) }), NOW).getTime(),
    at(21, 11).getTime(),
    'a stale preset becomes the next full hour'
  );
  const pastEvent = pickerValue(draft({ type: 'event', dueAt: at(21, 9) }), NOW);
  assert.ok(pastEvent.getTime() >= NOW.getTime(), 'an event picker never starts in the past');
  const broken = pickerValue(draft({ needsTime: true, pickerPreset: new Date(NaN) }), NOW);
  assert.ok(!Number.isNaN(broken.getTime()));
});

test('whenChipLabel covers the four chip states', () => {
  assert.equal(whenChipLabel(draft({ needsTime: true }), NOW), 'Pick a time');
  assert.equal(whenChipLabel(draft(), NOW), 'No deadline');
  assert.equal(whenChipLabel(draft({ dueAt: at(21, 17) }), NOW), 'Due Today · 5:00 PM');
  assert.equal(
    whenChipLabel(draft({ type: 'event', dueAt: at(24, 15) }), NOW),
    'Tue, Nov 24 · 3:00 PM'
  );
});

test('getNagChoice is derived from the draft', () => {
  const due = at(21, 17);
  assert.equal(getNagChoice(draft({ dueAt: due, nagStartAt: new Date(NOW) }), NOW), 'now');
  assert.equal(getNagChoice(draft({ dueAt: due, nagStartAt: at(21, 9) }), NOW), 'now');
  assert.equal(getNagChoice(draft({ dueAt: due, nagStartAt: at(21, 16) }), NOW), 1);
  assert.equal(getNagChoice(draft({ dueAt: due, nagStartAt: at(21, 14) }), NOW), 3);
  assert.equal(getNagChoice(draft({ dueAt: due, nagStartAt: at(21, 11) }), NOW), 6);
  assert.equal(getNagChoice(draft({ dueAt: due, nagStartAt: at(21, 15) }), NOW), 'custom');
  assert.equal(getNagChoice(draft(), NOW), 'now');
});

test('setDraftNagChoice and setDraftNagStart stay inside [now, deadline]', () => {
  const d = draft({ dueAt: at(21, 17), nagStartAt: at(21, 14) });
  assert.equal(setDraftNagChoice(d, 1, NOW).nagStartAt.getTime(), at(21, 16).getTime());
  assert.equal(setDraftNagChoice(d, 6, NOW).nagStartAt.getTime(), at(21, 11).getTime());
  assert.equal(setDraftNagChoice(d, 'now', NOW).nagStartAt.getTime(), NOW.getTime());

  const soon = draft({ dueAt: at(21, 12), nagStartAt: new Date(NOW) });
  const sixBefore = setDraftNagChoice(soon, 6, NOW);
  assert.equal(sixBefore.nagStartAt.getTime(), NOW.getTime(), '"6 hrs before" in the past is now');
  assert.equal(getNagChoice(sixBefore, NOW), 'now');

  const picked = new Date(2026, 10, 21, 13, 30, 20, 0);
  assert.equal(setDraftNagStart(d, picked, NOW).nagStartAt.getTime(), at(21, 13, 30).getTime());
  assert.equal(setDraftNagStart(d, at(21, 8), NOW).nagStartAt.getTime(), NOW.getTime());
  assert.equal(setDraftNagStart(d, at(21, 20), NOW).nagStartAt.getTime(), at(21, 17).getTime());
});

test('repeat pills map to repeat values and back', () => {
  const monday = at(23, 7);
  assert.equal(getRepeatChoice(null, monday), 'never');
  assert.equal(getRepeatChoice({ kind: 'daily' }, monday), 'daily');
  assert.equal(getRepeatChoice({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, monday), 'weekdays');
  assert.equal(getRepeatChoice({ kind: 'weekly', weekdays: [0, 6] }, monday), 'weekends');
  assert.equal(getRepeatChoice({ kind: 'weekly', weekdays: [1] }, monday), 'weekly');
  assert.equal(getRepeatChoice({ kind: 'weekly', weekdays: [2] }, monday), 'custom');
  assert.equal(getRepeatChoice({ kind: 'weekly', weekdays: [1, 3] }, monday), 'custom');

  assert.equal(repeatForChoice('never', monday), null);
  assert.deepEqual(repeatForChoice('daily', monday), { kind: 'daily' });
  assert.deepEqual(repeatForChoice('weekdays', monday), { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] });
  assert.deepEqual(repeatForChoice('weekends', monday), { kind: 'weekly', weekdays: [0, 6] });
  assert.deepEqual(repeatForChoice('weekly', monday), { kind: 'weekly', weekdays: [1] });

  const e = draft({ type: 'event', dueAt: monday });
  assert.deepEqual(setDraftRepeat(e, { kind: 'weekly', weekdays: [5, 1, 5] }).repeat, {
    kind: 'weekly',
    weekdays: [1, 5],
  });
  assert.equal(e.repeat, null, 'the input draft is not mutated');
});

// --- reducers -----------------------------------------------------------------------------------

test('applyToggleDone completes a task or a one-off event', () => {
  const list = [task(), event()];
  const doneTask = applyToggleDone(list, 't1', NOW);
  assert.notEqual(doneTask, list);
  assert.equal(doneTask[0].status, 'done');
  assert.equal(doneTask[0].completedAt, NOW.toISOString());
  assert.equal(doneTask[1], list[1], 'other reminders keep their identity');
  assert.equal(list[0].status, 'active', 'the input is not mutated');

  const doneEvent = applyToggleDone(list, 'e1', NOW);
  assert.equal(doneEvent[1].status, 'done');
  assert.equal(doneEvent[1].completedAt, NOW.toISOString());
});

test('applyToggleDone skips one occurrence of a repeating event instead of completing it', () => {
  const daily = event({ dueAt: iso(21, 21), repeat: { kind: 'daily' } });
  const [skipped] = applyToggleDone([daily], 'e1', NOW);
  assert.equal(skipped.status, 'active');
  assert.equal(skipped.completedAt, null);
  assert.equal(skipped.dueAt, iso(22, 21));

  const mondays = event({ dueAt: iso(23, 7), repeat: { kind: 'weekly', weekdays: [1] } });
  assert.equal(applyToggleDone([mondays], 'e1', NOW)[0].dueAt, iso(30, 7));
});

test('applyToggleDone un-completes, restarting a task nag from now', () => {
  const done = task({ status: 'done', completedAt: iso(21, 9, 30), nagStartAt: iso(21, 8) });
  const [active] = applyToggleDone([done], 't1', NOW);
  assert.equal(active.status, 'active');
  assert.equal(active.completedAt, null);
  assert.equal(active.nagStartAt, NOW.toISOString());

  const future = task({ status: 'done', completedAt: iso(21, 9, 30), nagStartAt: iso(21, 14) });
  assert.equal(applyToggleDone([future], 't1', NOW)[0].nagStartAt, iso(21, 14));
});

test('reducers return the same array when nothing changes', () => {
  const list = [task(), event()];
  assert.equal(applyToggleDone(list, 'missing', NOW), list);
  assert.equal(applyMarkDone(list, 'missing', NOW), list);
  assert.equal(applyMaintenance(list, NOW), list);
  const done = [task({ status: 'done', completedAt: iso(21, 9) })];
  assert.equal(applyMarkDone(done, 't1', NOW), done, 'already done is ignored');
});

test('applyMarkDone completes an active reminder', () => {
  const [done] = applyMarkDone([task()], 't1', NOW);
  assert.equal(done.status, 'done');
  assert.equal(done.completedAt, NOW.toISOString());
});

test('applyMaintenance auto-completes past one-off events at their own time', () => {
  const past = event({ dueAt: iso(21, 9) });
  const exactlyNow = event({ id: 'e2', dueAt: NOW.toISOString() });
  const future = event({ id: 'e3', dueAt: iso(21, 15) });
  const result = applyMaintenance([past, exactlyNow, future], NOW);
  assert.equal(result[0].status, 'done');
  assert.equal(result[0].completedAt, iso(21, 9));
  assert.equal(result[1].status, 'done', 'dueAt <= now counts as past');
  assert.equal(result[2], future);
});

test('applyMaintenance advances repeating events past now and leaves tasks alone', () => {
  const daily = event({ dueAt: iso(19, 21), repeat: { kind: 'daily' } });
  const overdueTask = task({ dueAt: iso(20, 9) });
  const result = applyMaintenance([daily, overdueTask], NOW);
  assert.equal(result[0].status, 'active');
  assert.equal(result[0].dueAt, iso(21, 21), 'the next occurrence after now, not after dueAt');
  assert.equal(result[1], overdueTask);

  const mondays = event({ dueAt: iso(16, 7), repeat: { kind: 'weekly', weekdays: [1] } });
  assert.equal(applyMaintenance([mondays], NOW)[0].dueAt, iso(23, 7));
});

test('applyMaintenance removes items completed more than 30 days ago', () => {
  const day = 86_400_000;
  const old = task({ status: 'done', completedAt: new Date(NOW.getTime() - 31 * day).toISOString() });
  const recent = task({
    id: 't2',
    status: 'done',
    completedAt: new Date(NOW.getTime() - 29 * day).toISOString(),
  });
  const result = applyMaintenance([old, recent], NOW);
  assert.deepEqual(
    result.map((r) => r.id),
    ['t2']
  );
});

test('reducers tolerate damaged dates', () => {
  const damaged = [
    event({ dueAt: 'garbage' }),
    task({ id: 't9', status: 'done', completedAt: 'garbage' }),
  ];
  assert.doesNotThrow(() => applyMaintenance(damaged, NOW));
  assert.doesNotThrow(() => applyToggleDone(damaged, 'e1', NOW));
  assert.doesNotThrow(() => buildSections(damaged, NOW));
  assert.doesNotThrow(() => reminderSubtitle(damaged[0], NOW, S));
});

// --- lists ------------------------------------------------------------------------------------

test('isCompletedToday, isOverdue and activeTaskCount', () => {
  assert.equal(isCompletedToday(task({ status: 'done', completedAt: iso(21, 0, 5) }), NOW), true);
  assert.equal(isCompletedToday(task({ status: 'done', completedAt: iso(20, 23, 59) }), NOW), false);
  assert.equal(isCompletedToday(task(), NOW), false);

  assert.equal(isOverdue(task({ dueAt: iso(21, 9) }), NOW), true);
  assert.equal(isOverdue(task({ dueAt: iso(21, 11) }), NOW), false);
  assert.equal(isOverdue(task(), NOW), false, 'no deadline is never overdue');
  assert.equal(isOverdue(task({ dueAt: iso(21, 9), status: 'done', completedAt: iso(21, 9) }), NOW), false);
  assert.equal(isOverdue(event({ dueAt: iso(21, 9) }), NOW), false, 'events are not overdue');

  assert.equal(
    activeTaskCount([
      task(),
      task({ id: 't2', status: 'done', completedAt: iso(21, 9) }),
      event(),
      task({ id: 't3' }),
    ]),
    2
  );
});

test('buildSections sorts and filters both lists', () => {
  const reminders = [
    task({ id: 'noDeadlineNew', createdAt: iso(21, 8) }),
    task({ id: 'dueLater', dueAt: iso(22, 9) }),
    task({ id: 'doneEarlier', status: 'done', completedAt: iso(21, 7) }),
    task({ id: 'overdueOld', dueAt: iso(20, 9) }),
    task({ id: 'dueSoon', dueAt: iso(21, 12) }),
    task({ id: 'noDeadlineOld', createdAt: iso(19, 8) }),
    task({ id: 'doneLater', status: 'done', completedAt: iso(21, 9) }),
    task({ id: 'doneYesterday', status: 'done', completedAt: iso(20, 9) }),
    task({ id: 'overdueRecent', dueAt: iso(21, 9) }),
    event({ id: 'eventLater', dueAt: iso(25, 9) }),
    event({ id: 'eventDoneToday', dueAt: iso(21, 9), status: 'done', completedAt: iso(21, 9) }),
    event({ id: 'eventSoon', dueAt: iso(21, 15) }),
    event({ id: 'eventDoneLastWeek', dueAt: iso(14, 9), status: 'done', completedAt: iso(14, 9) }),
  ];
  const { todo, comingUp } = buildSections(reminders, NOW);
  assert.deepEqual(
    todo.map((r) => r.id),
    [
      'overdueOld',
      'overdueRecent',
      'dueSoon',
      'dueLater',
      'noDeadlineOld',
      'noDeadlineNew',
      'doneLater',
      'doneEarlier',
    ]
  );
  assert.deepEqual(
    comingUp.map((r) => r.id),
    ['eventSoon', 'eventLater', 'eventDoneToday']
  );
  assert.deepEqual(buildSections([], NOW), { todo: [], comingUp: [] });
});

test('reminderSubtitle matches every row of the spec table', () => {
  assert.equal(reminderSubtitle(event({ dueAt: iso(21, 15) }), NOW, S), 'Today · 3:00 PM');
  assert.equal(reminderSubtitle(event({ dueAt: iso(22, 9, 30) }), NOW, S), 'Tomorrow · 9:30 AM');
  assert.equal(reminderSubtitle(event({ dueAt: iso(25, 15) }), NOW, S), 'Wed, Nov 25 · 3:00 PM');
  assert.equal(
    reminderSubtitle(event({ dueAt: iso(23, 19), repeat: { kind: 'weekly', weekdays: [1] } }), NOW, S),
    'Every Monday · 7:00 PM'
  );
  assert.equal(
    reminderSubtitle(event({ dueAt: iso(21, 9), status: 'done', completedAt: iso(21, 9) }), NOW, S),
    'Done · Today · 9:00 AM'
  );
  assert.equal(
    reminderSubtitle(task({ dueAt: iso(21, 17), nagStartAt: iso(21, 14) }), NOW, S),
    'Due Today · 5:00 PM · nags from 2:00 PM'
  );
  assert.equal(
    reminderSubtitle(task({ dueAt: iso(21, 17), nagStartAt: iso(21, 9) }), NOW, S),
    'Due Today · 5:00 PM · nagging every hour'
  );
  assert.equal(
    reminderSubtitle(task({ dueAt: iso(20, 17), nagStartAt: iso(20, 14) }), NOW, S),
    'Overdue · was due Yesterday · 5:00 PM'
  );
  assert.equal(reminderSubtitle(task(), NOW, S), 'No deadline · nagging every hour');
  assert.equal(
    reminderSubtitle(task(), NOW, { ...S, nagIntervalMinutes: 15 }),
    'No deadline · nagging every 15 min'
  );
  assert.equal(
    reminderSubtitle(task({ status: 'done', completedAt: iso(21, 9) }), NOW, S),
    'Done ✓'
  );
});
