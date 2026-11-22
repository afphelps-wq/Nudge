import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  ACTION_VERBS,
  EVENT_KEYWORDS,
  MAX_CAPTURE_LENGTH,
  cleanCaptureText,
  encodeCaptureParam,
  parseCapture,
} from '../../src/lib/parse.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/types.ts';

// Sat Nov 21 2026, 10:00 AM local — the reference "now" in SPEC.md.
const NOW = new Date(2026, 10, 21, 10, 0, 0, 0);

const parse = (text, now = NOW, settings = DEFAULT_SETTINGS) => parseCapture(text, now, settings);

/** Asserts on local date fields, so the tests pass in any time zone. */
function assertLocal(date, year, month, day, hour, minute, label = 'date') {
  assert.ok(date instanceof Date, `${label} should be a Date`);
  assert.deepEqual(
    [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()],
    [year, month, day, hour, minute],
    label
  );
  assert.equal(date.getSeconds(), 0, `${label} seconds`);
  assert.equal(date.getMilliseconds(), 0, `${label} milliseconds`);
}

function single(text, now = NOW) {
  const drafts = parse(text, now);
  assert.equal(drafts.length, 1, `"${text}" should give one reminder`);
  return drafts[0];
}

// --- the SPEC.md "Expected examples" table ------------------------------------

test('spec: "dentist next Tuesday at 3" is an event on Tuesday at 3 PM', () => {
  const d = single('dentist next Tuesday at 3');
  assert.equal(d.type, 'event');
  assert.equal(d.text, 'Dentist');
  assert.equal(d.needsTime, false);
  assertLocal(d.dueAt, 2026, 11, 24, 15, 0);
  assert.equal(d.nagStartAt, null);
  assert.equal(d.repeat, null);
});

test('spec: "finish my essay by 5pm" is a task due today 5 PM, nagging from 2 PM', () => {
  const d = single('finish my essay by 5pm');
  assert.equal(d.type, 'task');
  assert.equal(d.text, 'Finish my essay');
  assert.equal(d.needsTime, false);
  assertLocal(d.dueAt, 2026, 11, 21, 17, 0);
  assertLocal(d.nagStartAt, 2026, 11, 21, 14, 0, 'nagStartAt');
  assert.equal(d.repeat, null);
});

test('spec: "call mom" is a task that asks for a time, preset to the next full hour', () => {
  const d = single('call mom');
  assert.equal(d.type, 'task');
  assert.equal(d.text, 'Call mom');
  assert.equal(d.needsTime, true);
  assert.equal(d.dueAt, null);
  assert.equal(d.nagStartAt, null);
  assertLocal(d.pickerPreset, 2026, 11, 21, 11, 0, 'pickerPreset');
});

test('spec: "call mom and buy milk tomorrow" splits into two tasks', () => {
  const drafts = parse('call mom and buy milk tomorrow');
  assert.equal(drafts.length, 2);
  const [mom, milk] = drafts;
  assert.equal(mom.type, 'task');
  assert.equal(mom.text, 'Call mom');
  assert.equal(mom.needsTime, true);
  assert.equal(mom.dueAt, null);
  assert.equal(milk.type, 'task');
  assert.equal(milk.text, 'Buy milk');
  assert.equal(milk.needsTime, true);
  assert.equal(milk.dueAt, null);
  assertLocal(milk.pickerPreset, 2026, 11, 22, 9, 0, 'pickerPreset');
  assert.notEqual(mom.key, milk.key);
});

test('spec: "dinner with Sam and Alex at 7" stays one event, today at 7 PM', () => {
  const d = single('dinner with Sam and Alex at 7');
  assert.equal(d.type, 'event');
  assert.equal(d.text, 'Dinner with Sam and Alex');
  assert.equal(d.needsTime, false);
  assertLocal(d.dueAt, 2026, 11, 21, 19, 0);
});

test('spec: "gym every Monday at 7am" repeats weekly on Monday', () => {
  const d = single('gym every Monday at 7am');
  assert.equal(d.type, 'event');
  assert.equal(d.text, 'Gym');
  assert.deepEqual(d.repeat, { kind: 'weekly', weekdays: [1] });
  assertLocal(d.dueAt, 2026, 11, 23, 7, 0);
  assert.equal(d.needsTime, false);
});

test('spec: "take meds every day at 9pm" repeats daily, today at 9 PM', () => {
  const d = single('take meds every day at 9pm');
  assert.equal(d.type, 'event');
  assert.equal(d.text, 'Take meds');
  assert.deepEqual(d.repeat, { kind: 'daily' });
  assertLocal(d.dueAt, 2026, 11, 21, 21, 0);
});

test('spec: "meeting with Prof Lee Tuesday" is an event that asks for a time, preset Tue 9 AM', () => {
  const d = single('meeting with Prof Lee Tuesday');
  assert.equal(d.type, 'event');
  assert.equal(d.text, 'Meeting with Prof Lee');
  assert.equal(d.needsTime, true);
  assert.equal(d.dueAt, null);
  assertLocal(d.pickerPreset, 2026, 11, 24, 9, 0, 'pickerPreset');
});

test('spec: "remind me to submit hw due Sunday 11:59pm" is a task with a deadline', () => {
  const d = single('remind me to submit hw due Sunday 11:59pm');
  assert.equal(d.type, 'task');
  assert.equal(d.text, 'Submit hw');
  assert.equal(d.needsTime, false);
  assertLocal(d.dueAt, 2026, 11, 22, 23, 59);
  assertLocal(d.nagStartAt, 2026, 11, 22, 20, 59, 'nagStartAt');
});

// --- step 1: normalise ----------------------------------------------------------

test('empty and whitespace-only text give no reminders', () => {
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse('   \n\t '), []);
});

test('one leading phrase is removed, case-insensitively', () => {
  const cases = [
    ['Remind me to call mom', 'Call mom'],
    ['remind me call mom', 'Call mom'],
    ['nudge me to call mom', 'Call mom'],
    ["don't forget to call mom", 'Call mom'],
    ['dont forget to call mom', 'Call mom'],
    ['I need to call mom', 'Call mom'],
    ['i have to call mom', 'Call mom'],
    ['I should call mom', 'Call mom'],
    ['please call mom', 'Call mom'],
  ];
  for (const [input, title] of cases) {
    assert.equal(single(input).text, title, input);
  }
});

test('whitespace is collapsed', () => {
  assert.equal(single('  call    mom  ').text, 'Call mom');
});

// --- step 2: splitting ------------------------------------------------------------

test('a separator only splits when an action verb follows', () => {
  assert.equal(parse('dinner with Sam and Alex').length, 1);
  assert.equal(parse('call mom and buy milk').length, 2);
  assert.equal(parse('call mom; text dad').length, 2);
  assert.equal(parse('call mom, then email boss').length, 2);
  assert.equal(parse('call mom and then email boss').length, 2);
  assert.equal(parse('call mom and also email boss').length, 2);
  assert.equal(parse('buy apples, oranges and pears').length, 1);
});

test('at most five reminders come from one sentence; extras merge into the fifth', () => {
  const drafts = parse('call mom, text dad, email boss, buy milk, pay rent, book flight, cancel gym');
  assert.equal(drafts.length, 5);
  assert.deepEqual(
    drafts.slice(0, 4).map((d) => d.text),
    ['Call mom', 'Text dad', 'Email boss', 'Buy milk']
  );
  assert.match(drafts[4].text, /^Pay rent/);
  assert.match(drafts[4].text, /cancel gym$/);
  assert.equal(new Set(drafts.map((d) => d.key)).size, 5);
});

test('the verb and keyword lists are exactly the ones written in SPEC.md', () => {
  const spec = readFileSync(new URL('../../SPEC.md', import.meta.url), 'utf8');
  // Each list is one back-quoted, comma-separated line in the spec.
  const listStartingWith = (firstWords) => {
    const match = new RegExp('`(' + firstWords + '[^`]*)`').exec(spec);
    assert.ok(match, `list starting "${firstWords}" not found in SPEC.md`);
    return match[1].split(',').map((item) => item.trim());
  };
  assert.deepEqual([...ACTION_VERBS], listStartingWith('call, text, email'));
  assert.deepEqual([...EVENT_KEYWORDS], listStartingWith('meeting, meet, appointment'));
});

// --- step 3: repeats ----------------------------------------------------------------

test('daily phrases', () => {
  for (const phrase of ['every day', 'everyday', 'daily', 'each day']) {
    const d = single(`take meds ${phrase} at 9pm`);
    assert.deepEqual(d.repeat, { kind: 'daily' }, phrase);
    assert.equal(d.type, 'event', phrase);
    assert.equal(d.text, 'Take meds', phrase);
  }
});

test('weekday and weekend phrases', () => {
  for (const phrase of ['every weekday', 'on weekdays', 'weekdays']) {
    const d = single(`standup ${phrase} at 10am`);
    assert.deepEqual(d.repeat, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, phrase);
    assert.equal(d.type, 'event', phrase);
  }
  for (const phrase of ['every weekend', 'on weekends', 'weekends']) {
    const d = single(`long run ${phrase} at 8am`);
    assert.deepEqual(d.repeat, { kind: 'weekly', weekdays: [0, 6] }, phrase);
    assert.equal(d.type, 'event', phrase);
  }
});

test('named days, full or three-letter, single or several', () => {
  const both = single('gym every Monday and Wednesday at 6pm');
  assert.deepEqual(both.repeat, { kind: 'weekly', weekdays: [1, 3] });
  assert.equal(both.text, 'Gym');
  assertLocal(both.dueAt, 2026, 11, 23, 18, 0);

  assert.deepEqual(single('yoga every tue at 7am').repeat, { kind: 'weekly', weekdays: [2] });
  assert.deepEqual(single('class on Mondays and Fridays at 10am').repeat, {
    kind: 'weekly',
    weekdays: [1, 5],
  });
});

test('"weekly" uses the weekday of the parsed date, or of now', () => {
  // No date said: today is Saturday.
  assert.deepEqual(single('yoga weekly at 6pm').repeat, { kind: 'weekly', weekdays: [6] });
  assert.deepEqual(single('call grandma every week').repeat, { kind: 'weekly', weekdays: [6] });
});

// --- steps 4–7: dates, deadlines, type ------------------------------------------------

test('course numbers and bare durations are not mistaken for times', () => {
  const exam = single('study for 15-113 exam');
  assert.equal(exam.text, 'Study for 15-113 exam');
  assert.equal(exam.dueAt, null);
  assert.equal(exam.needsTime, true);

  const hours = single('study for 2 hours');
  assert.equal(hours.text, 'Study for 2 hours');
  assert.equal(hours.dueAt, null);
  assert.equal(hours.needsTime, true);
});

test('a date with an implied time of day keeps that hour in the preset', () => {
  const d = single('movie tonight');
  assert.equal(d.type, 'event');
  assert.equal(d.text, 'Movie');
  assert.equal(d.needsTime, true);
  assert.equal(d.dueAt, null);
  assertLocal(d.pickerPreset, 2026, 11, 21, 22, 0, 'pickerPreset');
});

test('a preset that would be in the past becomes the next full hour', () => {
  const d = single('clean room today');
  assert.equal(d.needsTime, true);
  assertLocal(d.pickerPreset, 2026, 11, 21, 11, 0, 'pickerPreset');
});

test('hours 1–7 without am/pm are PM; others are left alone', () => {
  assertLocal(single('lunch at 1').dueAt, 2026, 11, 21, 13, 0);
  assertLocal(single('dinner at 7').dueAt, 2026, 11, 21, 19, 0);
  // 8 is not shifted, and 8 AM today has passed, so it rolls to tomorrow.
  assertLocal(single('breakfast at 8').dueAt, 2026, 11, 22, 8, 0);
  assertLocal(single('lunch at noon').dueAt, 2026, 11, 21, 12, 0);
});

test('chrono-resolved evenings and mornings are not shifted twice', () => {
  assertLocal(single('take out trash at 8 tonight').dueAt, 2026, 11, 21, 20, 0);
  assertLocal(single('breakfast tomorrow morning at 7').dueAt, 2026, 11, 22, 7, 0);
});

test('a time that has already passed today rolls to tomorrow', () => {
  const at3pm = new Date(2026, 10, 21, 15, 0, 0, 0);
  assertLocal(single('dinner at 2pm', at3pm).dueAt, 2026, 11, 22, 14, 0);
  // "at 7" read as 7 PM is still ahead at 3 PM.
  assertLocal(single('dinner at 7', at3pm).dueAt, 2026, 11, 21, 19, 0);
});

test('deadline words make a task and are removed from the title', () => {
  for (const [input, title] of [
    ['finish essay by 5pm', 'Finish essay'],
    ['finish essay before 5pm', 'Finish essay'],
    ['finish essay due 5pm', 'Finish essay'],
    ['finish essay until 5pm', 'Finish essay'],
    ['finish essay no later than 5pm', 'Finish essay'],
  ]) {
    const d = single(input);
    assert.equal(d.type, 'task', input);
    assert.equal(d.text, title, input);
    assertLocal(d.dueAt, 2026, 11, 21, 17, 0, input);
  }
});

test('a deadline word overrides event keywords', () => {
  const d = single('prepare for the meeting by 5pm');
  assert.equal(d.type, 'task');
  assertLocal(d.dueAt, 2026, 11, 21, 17, 0);
});

test('event keywords and "with <Name>" make events; everything else is a task', () => {
  assert.equal(single('dentist at 3pm').type, 'event');
  assert.equal(single('office hours at 2pm').type, 'event');
  assert.equal(single('study with Sam at 4pm').type, 'event');
  assert.equal(single('study with friends at 4pm').type, 'task');
  assert.equal(single('buy milk at 4pm').type, 'task');
  // "final" is a keyword only as a whole word.
  assert.equal(single('finalize report at 4pm').type, 'task');
});

test('an event with no date at all asks for a time, preset to the next full hour', () => {
  const d = single('dinner with Sam and Alex');
  assert.equal(d.type, 'event');
  assert.equal(d.needsTime, true);
  assert.equal(d.dueAt, null);
  assertLocal(d.pickerPreset, 2026, 11, 21, 11, 0, 'pickerPreset');
});

test('a task deadline closer than the default lead starts nagging now', () => {
  const d = single('submit form by 11am');
  assertLocal(d.dueAt, 2026, 11, 21, 11, 0);
  assert.equal(d.nagStartAt.getTime(), NOW.getTime());
});

test('the default nag start follows the setting', () => {
  const settings = { ...DEFAULT_SETTINGS, defaultNagStartHours: 1 };
  const [d] = parseCapture('finish my essay by 5pm', NOW, settings);
  assertLocal(d.nagStartAt, 2026, 11, 21, 16, 0, 'nagStartAt');
});

// --- step 8: titles ---------------------------------------------------------------------

test('titles lose dangling words and trailing punctuation, and are capitalised', () => {
  assert.equal(single('Call mom tomorrow at 5pm.').text, 'Call mom');
  assert.equal(single('pick up package on Friday at 2pm!').text, 'Pick up package');
  assert.equal(single('émile birthday party at 6pm').text, 'Émile birthday party');
});

test('a title that would be empty falls back to the text', () => {
  const d = single('tomorrow at 5pm');
  assert.ok(d.text.length > 0);
});

test('titles never exceed the card limit', () => {
  const d = single(`buy ${'very '.repeat(60)}long list`);
  assert.ok(d.text.length <= 120);
});

// --- robustness ------------------------------------------------------------------------

test('every draft is well-formed for any input', () => {
  const inputs = [
    'call mom',
    '!!!',
    'at',
    'by',
    'every',
    '5',
    '🎉 party 🎉 at 8pm',
    'a'.repeat(300),
    'and and and',
    'by by by 5pm',
    'every monday every tuesday',
    '<script>alert(1)</script> at 5pm',
    '__proto__ constructor toString',
  ];
  for (const input of inputs) {
    const drafts = parse(input);
    assert.ok(drafts.length >= 1 && drafts.length <= 5, input);
    for (const d of drafts) {
      assert.ok(typeof d.key === 'string' && d.key.length > 0, input);
      assert.ok(typeof d.text === 'string' && d.text.trim().length > 0, input);
      assert.ok(d.type === 'event' || d.type === 'task', input);
      assert.ok(d.pickerPreset instanceof Date && !Number.isNaN(d.pickerPreset.getTime()), input);
      assert.ok(d.dueAt === null || !Number.isNaN(d.dueAt.getTime()), input);
      assert.ok(d.nagStartAt === null || !Number.isNaN(d.nagStartAt.getTime()), input);
      if (d.type === 'task') assert.equal(d.repeat, null, input);
      if (d.type === 'event') assert.equal(d.nagStartAt, null, input);
      if (d.needsTime) assert.equal(d.dueAt, null, input);
    }
  }
});

test('parsing does not change the "now" it is given', () => {
  const now = new Date(NOW);
  parse('dentist next Tuesday at 3', now);
  parse('call mom', now);
  assert.equal(now.getTime(), NOW.getTime());
});

// --- route-param helpers ------------------------------------------------------------------

test('encodeCaptureParam escapes percent signs so text survives the double decode', () => {
  assert.equal(encodeCaptureParam('50% off sale'), '50%25 off sale');
  assert.equal(decodeURIComponent(encodeCaptureParam('literal %41 here')), 'literal %41 here');
  assert.equal(encodeCaptureParam('plain text'), 'plain text');
});

test('cleanCaptureText treats the param as untrusted', () => {
  assert.equal(cleanCaptureText(undefined), '');
  assert.equal(cleanCaptureText(['first', 'second']), 'first');
  assert.equal(cleanCaptureText([]), '');
  assert.equal(cleanCaptureText('  call\u0000 mom\n\ttomorrow  '), 'call mom tomorrow');
  assert.equal(cleanCaptureText('x'.repeat(1000)).length, MAX_CAPTURE_LENGTH);
  assert.equal(cleanCaptureText(42), '');
});
