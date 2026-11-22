import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatTime,
  formatWhen,
  hhmmToDate,
  intervalLabel,
  leadLabel,
  parseHHmm,
  relativeDay,
  repeatLabel,
  toHHmm,
} from '../../src/lib/format.ts';

// Sat Nov 21 2026, 10:00 AM local — the reference "now" used throughout SPEC.md.
const NOW = new Date(2026, 10, 21, 10, 0, 0, 0);

test('formatTime uses a 12-hour clock with no leading zero', () => {
  assert.equal(formatTime(new Date(2026, 10, 21, 15, 0)), '3:00 PM');
  assert.equal(formatTime(new Date(2026, 10, 21, 9, 30)), '9:30 AM');
  assert.equal(formatTime(new Date(2026, 10, 21, 0, 5)), '12:05 AM');
  assert.equal(formatTime(new Date(2026, 10, 21, 12, 0)), '12:00 PM');
  assert.equal(formatTime(new Date(2026, 10, 21, 23, 59)), '11:59 PM');
});

test('relativeDay names today, tomorrow and yesterday', () => {
  assert.equal(relativeDay(new Date(2026, 10, 21, 23, 59), NOW), 'Today');
  assert.equal(relativeDay(new Date(2026, 10, 22, 0, 0), NOW), 'Tomorrow');
  assert.equal(relativeDay(new Date(2026, 10, 20, 12, 0), NOW), 'Yesterday');
});

test('relativeDay falls back to weekday, month and day, adding the year when it differs', () => {
  assert.equal(relativeDay(new Date(2026, 10, 24, 15, 0), NOW), 'Tue, Nov 24');
  assert.equal(relativeDay(new Date(2026, 10, 19, 15, 0), NOW), 'Thu, Nov 19');
  assert.equal(relativeDay(new Date(2027, 0, 5, 9, 0), NOW), 'Tue, Jan 5, 2027');
});

test('formatWhen joins day and time with a middle dot', () => {
  assert.equal(formatWhen(new Date(2026, 10, 21, 15, 0), NOW), 'Today · 3:00 PM');
  assert.equal(formatWhen(new Date(2026, 10, 22, 9, 30), NOW), 'Tomorrow · 9:30 AM');
  assert.equal(formatWhen(new Date(2026, 10, 24, 15, 0), NOW), 'Tue, Nov 24 · 3:00 PM');
});

test('repeatLabel covers every repeat shape in the spec', () => {
  assert.equal(repeatLabel(null), "Doesn't repeat");
  assert.equal(repeatLabel({ kind: 'daily' }), 'Every day');
  assert.equal(repeatLabel({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }), 'Weekdays');
  assert.equal(repeatLabel({ kind: 'weekly', weekdays: [0, 6] }), 'Weekends');
  assert.equal(repeatLabel({ kind: 'weekly', weekdays: [1] }), 'Every Monday');
  assert.equal(repeatLabel({ kind: 'weekly', weekdays: [1, 3] }), 'Mon & Wed');
  assert.equal(repeatLabel({ kind: 'weekly', weekdays: [1, 3, 5] }), 'Mon, Wed & Fri');
  assert.equal(repeatLabel({ kind: 'weekly', weekdays: [5, 1, 3, 3] }), 'Mon, Wed & Fri');
});

test('intervalLabel and leadLabel match the spec wording', () => {
  assert.equal(intervalLabel(15), '15 min');
  assert.equal(intervalLabel(30), '30 min');
  assert.equal(intervalLabel(60), 'hour');
  assert.equal(intervalLabel(120), '2 hours');
  assert.equal(leadLabel(10), '10 min');
  assert.equal(leadLabel(15), '15 min');
  assert.equal(leadLabel(30), '30 min');
  assert.equal(leadLabel(60), '1 hour');
});

test('HH:mm helpers round-trip and reject bad input', () => {
  for (const value of ['00:00', '08:00', '09:05', '22:00', '23:59']) {
    assert.equal(toHHmm(hhmmToDate(value)), value);
  }
  assert.equal(parseHHmm('22:00'), 22 * 60);
  assert.equal(parseHHmm('08:30'), 8 * 60 + 30);
  assert.equal(parseHHmm('24:00'), null);
  assert.equal(parseHHmm('12:60'), null);
  assert.equal(parseHHmm('nope'), null);
  assert.equal(toHHmm(hhmmToDate('garbage')), '00:00');
});
