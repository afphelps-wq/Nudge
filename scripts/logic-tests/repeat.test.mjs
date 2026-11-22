import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WEEKDAYS,
  WEEKENDS,
  alignToRepeat,
  matchesRepeat,
  nextOccurrence,
  normalizeRepeat,
  normalizeWeekdays,
  occurrencesUntil,
  repeatsEqual,
} from '../../src/lib/repeat.ts';

// Sat Nov 21 2026, 10:00 AM local — the reference "now" used throughout SPEC.md.
// Nov 2026: 16 = Mon, 21 = Sat, 22 = Sun, 23 = Mon, 24 = Tue, 25 = Wed, 30 = Mon.
const NOW = new Date(2026, 10, 21, 10, 0, 0, 0);

const DAILY = { kind: 'daily' };
const weekly = (...weekdays) => ({ kind: 'weekly', weekdays });

/** A local date in November 2026. */
const nov = (day, hours = 0, minutes = 0, seconds = 0, ms = 0) =>
  new Date(2026, 10, day, hours, minutes, seconds, ms);

/** Local calendar fields, so assertions never depend on the UTC offset. */
const fields = (date) => [
  date.getFullYear(),
  date.getMonth() + 1,
  date.getDate(),
  date.getHours(),
  date.getMinutes(),
  date.getSeconds(),
  date.getMilliseconds(),
];

function assertLocal(actual, year, month, day, hours, minutes) {
  assert.deepEqual(fields(actual), [year, month, day, hours, minutes, 0, 0]);
}

// getTimezoneOffset() in mid-January and mid-July 2026, used to confirm that a
// zone really took effect before a daylight-saving test relies on it.
const ZONE_OFFSETS = {
  'America/New_York': [300, 240], // DST 2026: Mar 8 02:00 → 03:00, Nov 1 02:00 → 01:00
  'Europe/London': [0, -60], // DST 2026: Mar 29 01:00 → 02:00, Oct 25 02:00 → 01:00
  'Australia/Lord_Howe': [-660, -630], // 30-minute DST: Apr 5 02:00 → 01:30, Oct 4 02:00 → 02:30
  'Asia/Kolkata': [-330, -330], // no DST, half-hour offset
};

/**
 * Runs `fn` with the process time zone set to `zone`, then restores it. This is
 * what makes the daylight-saving tests independent of the machine's own zone.
 */
function withZone(t, zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    const [january, july] = ZONE_OFFSETS[zone];
    const applied =
      new Date(2026, 0, 15, 12).getTimezoneOffset() === january &&
      new Date(2026, 6, 15, 12).getTimezoneOffset() === july;
    if (!applied) {
      t.skip(`time zone ${zone} is not available in this runtime`);
      return;
    }
    fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

// --- constants and normalisation ----------------------------------------------

test('WEEKDAYS and WEEKENDS use Date.getDay() numbering', () => {
  assert.deepEqual([...WEEKDAYS], [1, 2, 3, 4, 5]);
  assert.deepEqual([...WEEKENDS], [0, 6]);
});

test('normalizeWeekdays sorts, de-duplicates and drops anything that is not 0–6', () => {
  assert.deepEqual(normalizeWeekdays([5, 1, 3, 3, 1]), [1, 3, 5]);
  assert.deepEqual(normalizeWeekdays([6, 0]), [0, 6]);
  assert.deepEqual(normalizeWeekdays([7, -1, 1.5, NaN, Infinity, 2]), [2]);
  assert.deepEqual(normalizeWeekdays([]), []);
});

test('normalizeWeekdays does not change the array it is given', () => {
  const input = [5, 1, 3, 3];
  normalizeWeekdays(input);
  assert.deepEqual(input, [5, 1, 3, 3]);
});

test('normalizeRepeat gives the canonical form of every repeat shape', () => {
  assert.equal(normalizeRepeat(null), null);
  assert.deepEqual(normalizeRepeat({ kind: 'daily' }), { kind: 'daily' });
  assert.deepEqual(normalizeRepeat(weekly(3, 1, 3)), weekly(1, 3));
  assert.equal(normalizeRepeat(weekly()), null);
  assert.equal(normalizeRepeat(weekly(9, -2)), null);
});

test('normalizeRepeat returns new objects and leaves its input alone', () => {
  const daily = { kind: 'daily' };
  assert.notEqual(normalizeRepeat(daily), daily);
  const rule = weekly(3, 1);
  const result = normalizeRepeat(rule);
  assert.notEqual(result, rule);
  assert.deepEqual(rule.weekdays, [3, 1]);
});

test('repeatsEqual compares rules, not object identity or weekday order', () => {
  assert.equal(repeatsEqual(null, null), true);
  assert.equal(repeatsEqual({ kind: 'daily' }, { kind: 'daily' }), true);
  assert.equal(repeatsEqual(weekly(1, 3), weekly(3, 1, 1)), true);
  assert.equal(repeatsEqual(null, weekly()), true);

  assert.equal(repeatsEqual(null, { kind: 'daily' }), false);
  assert.equal(repeatsEqual({ kind: 'daily' }, null), false);
  assert.equal(repeatsEqual({ kind: 'daily' }, weekly(0, 1, 2, 3, 4, 5, 6)), false);
  assert.equal(repeatsEqual(weekly(1, 3), weekly(1, 4)), false);
  assert.equal(repeatsEqual(weekly(1, 3), weekly(1)), false);
  assert.equal(repeatsEqual(weekly(1), null), false);
});

test('matchesRepeat checks the local weekday', () => {
  assert.equal(matchesRepeat(DAILY, nov(21, 9)), true);
  assert.equal(matchesRepeat(weekly(6), nov(21, 9)), true); // Saturday
  assert.equal(matchesRepeat(weekly(1, 2, 3, 4, 5), nov(21, 9)), false);
  assert.equal(matchesRepeat(weekly(1, 2, 3, 4, 5), nov(23, 9)), true); // Monday
  assert.equal(matchesRepeat(weekly(0, 6), nov(22, 23, 59)), true); // Sunday
  // A weekly rule with no usable days is treated as daily so it can never loop forever.
  assert.equal(matchesRepeat(weekly(), nov(21, 9)), true);
});

// --- nextOccurrence: daily ----------------------------------------------------

test('daily: the occurrence after dueAt is the next day at the same time', () => {
  assertLocal(nextOccurrence(DAILY, nov(21, 21, 0), nov(21, 21, 0)), 2026, 11, 22, 21, 0);
  assertLocal(nextOccurrence(DAILY, nov(21, 7, 45), nov(21, 7, 45)), 2026, 11, 22, 7, 45);
});

test('daily: the result is strictly after `after`', () => {
  const due = nov(18, 9, 0);
  // Later today when today's time is still ahead…
  assertLocal(nextOccurrence(DAILY, due, nov(21, 8, 59)), 2026, 11, 21, 9, 0);
  // …tomorrow when it is exactly now or already past.
  assertLocal(nextOccurrence(DAILY, due, nov(21, 9, 0)), 2026, 11, 22, 9, 0);
  assertLocal(nextOccurrence(DAILY, due, NOW), 2026, 11, 22, 9, 0);
  // One millisecond before the time still counts as "ahead".
  assertLocal(nextOccurrence(DAILY, due, nov(21, 8, 59, 59, 999)), 2026, 11, 21, 9, 0);
});

test('daily: the hour and minute come from dueAt, never from `after`', () => {
  const result = nextOccurrence(DAILY, nov(10, 6, 5), nov(21, 13, 37, 42, 123));
  assertLocal(result, 2026, 11, 22, 6, 5);
});

test('daily: seconds and milliseconds of dueAt are dropped', () => {
  const result = nextOccurrence(DAILY, nov(21, 9, 0, 30, 500), nov(21, 9, 0, 30, 500));
  assertLocal(result, 2026, 11, 22, 9, 0);
});

test('daily: rolls over the end of a month and of a year', () => {
  assertLocal(nextOccurrence(DAILY, nov(30, 23, 30), nov(30, 23, 30)), 2026, 12, 1, 23, 30);
  const newYearsEve = new Date(2026, 11, 31, 8, 15);
  assertLocal(nextOccurrence(DAILY, newYearsEve, newYearsEve), 2027, 1, 1, 8, 15);
  const leapDayEve = new Date(2028, 1, 28, 12, 0);
  assertLocal(nextOccurrence(DAILY, leapDayEve, leapDayEve), 2028, 2, 29, 12, 0);
});

test('daily: midnight events stay at midnight', () => {
  assertLocal(nextOccurrence(DAILY, nov(21, 0, 0), nov(21, 0, 0)), 2026, 11, 22, 0, 0);
  assertLocal(nextOccurrence(DAILY, nov(21, 0, 0), nov(21, 23, 59)), 2026, 11, 22, 0, 0);
});

// --- nextOccurrence: weekly ---------------------------------------------------

test('weekly: a single weekday repeats seven days later', () => {
  const monday = nov(23, 7, 0);
  assertLocal(nextOccurrence(weekly(1), monday, monday), 2026, 11, 30, 7, 0);
});

test('weekly: several weekdays step to the next listed day', () => {
  const rule = weekly(1, 3); // Mon & Wed
  const monday = nov(23, 19, 0);
  const wednesday = nextOccurrence(rule, monday, monday);
  assertLocal(wednesday, 2026, 11, 25, 19, 0);
  assertLocal(nextOccurrence(rule, wednesday, wednesday), 2026, 11, 30, 19, 0);
});

test('weekly: today counts when its time is still ahead, and not when it has passed', () => {
  const rule = weekly(6); // Saturday
  const due = nov(14, 20, 0);
  assertLocal(nextOccurrence(rule, due, NOW), 2026, 11, 21, 20, 0);
  assertLocal(nextOccurrence(rule, due, nov(21, 20, 0)), 2026, 11, 28, 20, 0);
  assertLocal(nextOccurrence(rule, due, nov(21, 20, 1)), 2026, 11, 28, 20, 0);
});

test('weekly: a dueAt whose weekday is not in the set moves onto the set', () => {
  // Saturday with a Weekdays rule → Monday.
  const saturday = nov(21, 15, 0);
  assertLocal(nextOccurrence(weekly(...WEEKDAYS), saturday, saturday), 2026, 11, 23, 15, 0);
  // Tuesday with a Weekends rule → Saturday.
  const tuesday = nov(24, 8, 30);
  assertLocal(nextOccurrence(weekly(...WEEKENDS), tuesday, tuesday), 2026, 11, 28, 8, 30);
});

test('weekly: Weekdays skips the weekend, Weekends skips the week', () => {
  const friday = nov(27, 9, 0);
  assertLocal(nextOccurrence(weekly(...WEEKDAYS), friday, friday), 2026, 11, 30, 9, 0);
  const sunday = nov(22, 9, 0);
  assertLocal(nextOccurrence(weekly(...WEEKENDS), sunday, sunday), 2026, 11, 28, 9, 0);
  const saturday = nov(21, 9, 0);
  assertLocal(nextOccurrence(weekly(...WEEKENDS), saturday, saturday), 2026, 11, 22, 9, 0);
});

test('weekly: every weekday is reachable from every starting day', () => {
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    for (let startDay = 15; startDay <= 21; startDay += 1) {
      const start = nov(startDay, 12, 0);
      const result = nextOccurrence(weekly(weekday), start, start);
      assert.equal(result.getDay(), weekday);
      assert.equal(result.getHours(), 12);
      assert.equal(result.getMinutes(), 0);
      const days = Math.round((result.getTime() - start.getTime()) / 86_400_000);
      assert.ok(days >= 1 && days <= 7, `weekday ${weekday} from Nov ${startDay}: ${days} days`);
    }
  }
});

test('weekly: unsorted or duplicated weekdays behave like the clean rule', () => {
  const monday = nov(23, 19, 0);
  assertLocal(nextOccurrence(weekly(3, 1, 3), monday, monday), 2026, 11, 25, 19, 0);
});

test('weekly: a rule with no usable days behaves like daily instead of looping', () => {
  assertLocal(nextOccurrence(weekly(), nov(21, 9, 0), nov(21, 9, 0)), 2026, 11, 22, 9, 0);
});

// --- nextOccurrence: robustness -----------------------------------------------

test('alignToRepeat keeps an allowed day and moves any other to the next allowed day', () => {
  const day = (date, hour = 9, minute = 0) => new Date(2026, 10, date, hour, minute, 0, 0);
  const weekdays = weekly(...WEEKDAYS);
  const weekends = weekly(...WEEKENDS);

  // Allowed days come back as the very same Date.
  const monday = day(23);
  assert.equal(alignToRepeat(monday, weekdays), monday);
  const sunday = day(22);
  assert.equal(alignToRepeat(sunday, weekends), sunday);
  assert.equal(alignToRepeat(sunday, DAILY), sunday, 'daily allows every day');
  assert.equal(alignToRepeat(sunday, weekly()), sunday, 'a rule with no usable days is not applied');

  // Other days move forward, never back, and keep the hour and minute.
  assert.equal(alignToRepeat(day(21, 9, 30), weekdays).getTime(), day(23, 9, 30).getTime());
  assert.equal(alignToRepeat(day(22, 9, 30), weekdays).getTime(), day(23, 9, 30).getTime());
  assert.equal(alignToRepeat(day(23, 19, 45), weekends).getTime(), day(28, 19, 45).getTime());
  assert.equal(alignToRepeat(day(24), weekly(1)).getTime(), day(30).getTime());

  // The given date is not modified, and an invalid one is handed back as it is.
  assert.equal(sunday.getTime(), day(22).getTime());
  const invalid = new Date(NaN);
  assert.equal(alignToRepeat(invalid, weekdays), invalid);
});

test('nextOccurrence does not modify the dates it is given', () => {
  const due = nov(21, 9, 0, 12, 345);
  const after = nov(24, 18, 30, 1, 2);
  const dueBefore = due.getTime();
  const afterBefore = after.getTime();
  nextOccurrence(DAILY, due, after);
  nextOccurrence(weekly(1), due, after);
  assert.equal(due.getTime(), dueBefore);
  assert.equal(after.getTime(), afterBefore);
});

test('nextOccurrence returns an Invalid Date, without throwing, for invalid input', () => {
  const invalid = new Date(NaN);
  assert.ok(Number.isNaN(nextOccurrence(DAILY, invalid, NOW).getTime()));
  assert.ok(Number.isNaN(nextOccurrence(DAILY, NOW, invalid).getTime()));
  assert.ok(Number.isNaN(nextOccurrence(weekly(1), invalid, invalid).getTime()));
});

// --- occurrencesUntil ---------------------------------------------------------

test('occurrencesUntil starts with dueAt and includes an occurrence exactly at `until`', () => {
  const list = occurrencesUntil(DAILY, nov(21, 21, 0), nov(24, 21, 0));
  assert.deepEqual(
    list.map((date) => [date.getDate(), date.getHours(), date.getMinutes()]),
    [
      [21, 21, 0],
      [22, 21, 0],
      [23, 21, 0],
      [24, 21, 0],
    ]
  );
  const oneShort = occurrencesUntil(DAILY, nov(21, 21, 0), nov(24, 20, 59));
  assert.equal(oneShort.length, 3);
});

test('occurrencesUntil covers a seven-day window of a weekly rule', () => {
  const list = occurrencesUntil(weekly(1, 3), nov(23, 19, 0), nov(30, 19, 0));
  assert.deepEqual(
    list.map((date) => date.getDate()),
    [23, 25, 30]
  );
  assert.ok(list.every((date) => date.getHours() === 19 && date.getMinutes() === 0));
});

test('occurrencesUntil keeps dueAt first even when its weekday is not in the set', () => {
  const list = occurrencesUntil(weekly(...WEEKDAYS), nov(21, 15, 0), nov(25, 23, 0));
  assert.deepEqual(
    list.map((date) => date.getDate()),
    [21, 23, 24, 25]
  );
});

test('occurrencesUntil is empty when dueAt is after `until` or invalid', () => {
  assert.deepEqual(occurrencesUntil(DAILY, nov(22, 9, 0), nov(21, 9, 0)), []);
  assert.deepEqual(occurrencesUntil(DAILY, new Date(NaN), nov(21, 9, 0)), []);
  assert.deepEqual(occurrencesUntil(DAILY, nov(21, 9, 0), new Date(NaN)), []);
});

test('occurrencesUntil never returns more than `max` dates', () => {
  const farAway = new Date(2030, 0, 1);
  assert.equal(occurrencesUntil(DAILY, nov(21, 9, 0), farAway, 5).length, 5);
  assert.equal(occurrencesUntil(DAILY, nov(21, 9, 0), farAway).length, 64);
  assert.equal(occurrencesUntil(DAILY, nov(21, 9, 0), farAway, 0).length, 0);
});

test('occurrencesUntil returns a copy of dueAt, not the same object', () => {
  const due = nov(21, 9, 0);
  const [first] = occurrencesUntil(DAILY, due, nov(21, 9, 0));
  assert.notEqual(first, due);
  assert.equal(first.getTime(), due.getTime());
});

// --- daylight saving ----------------------------------------------------------

/**
 * Walks a whole year one occurrence at a time and checks, using local calendar
 * fields only, that every step lands on the next calendar day at the wall-clock
 * time JS itself gives for "that day at that time".
 */
function assertDailyWalkKeepsWallClock(hours, minutes) {
  let current = new Date(2026, 0, 1, hours, minutes);
  for (let step = 0; step < 366; step += 1) {
    const next = nextOccurrence(DAILY, new Date(2026, 0, 1, hours, minutes), current);
    const expected = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
      hours,
      minutes
    );
    assert.equal(
      next.getTime(),
      expected.getTime(),
      `step ${step}: after ${current} expected ${expected} but got ${next}`
    );
    assert.ok(next.getTime() > current.getTime());
    current = next;
  }
}

test('daily: a year of occurrences keeps the wall-clock time in the machine time zone', () => {
  for (const [hours, minutes] of [
    [0, 0],
    [1, 30],
    [2, 30],
    [9, 0],
    [23, 59],
  ]) {
    assertDailyWalkKeepsWallClock(hours, minutes);
  }
});

for (const zone of Object.keys(ZONE_OFFSETS)) {
  test(`daily: a year of occurrences keeps the wall-clock time in ${zone}`, (t) => {
    withZone(t, zone, () => {
      for (const [hours, minutes] of [
        [0, 0],
        [1, 30],
        [2, 15],
        [2, 30],
        [9, 0],
        [23, 59],
      ]) {
        assertDailyWalkKeepsWallClock(hours, minutes);
      }
    });
  });
}

test('DST spring forward (New York): 9:00 AM stays 9:00 AM although the day has 23 hours', (t) => {
  withZone(t, 'America/New_York', () => {
    const saturday = new Date(2026, 2, 7, 9, 0);
    const sunday = nextOccurrence(DAILY, saturday, saturday);
    const monday = nextOccurrence(DAILY, sunday, sunday);
    assertLocal(sunday, 2026, 3, 8, 9, 0);
    assertLocal(monday, 2026, 3, 9, 9, 0);
    // Proof that the zone change is real: the wall clock moved 24 h, the timeline only 23 h.
    assert.equal(sunday.getTime() - saturday.getTime(), 23 * 3_600_000);
    assert.equal(monday.getTime() - sunday.getTime(), 24 * 3_600_000);
  });
});

test('DST fall back (New York): 9:00 AM stays 9:00 AM although the day has 25 hours', (t) => {
  withZone(t, 'America/New_York', () => {
    const saturday = new Date(2026, 9, 31, 9, 0);
    const sunday = nextOccurrence(DAILY, saturday, saturday);
    const monday = nextOccurrence(DAILY, sunday, sunday);
    assertLocal(sunday, 2026, 11, 1, 9, 0);
    assertLocal(monday, 2026, 11, 2, 9, 0);
    assert.equal(sunday.getTime() - saturday.getTime(), 25 * 3_600_000);
  });
});

test('DST (New York): a weekly rule keeps its weekday and time across both changes', (t) => {
  withZone(t, 'America/New_York', () => {
    const rule = weekly(0); // Sundays
    const marchFirst = new Date(2026, 2, 1, 10, 0);
    const marchEighth = nextOccurrence(rule, marchFirst, marchFirst);
    assertLocal(marchEighth, 2026, 3, 8, 10, 0);
    assertLocal(nextOccurrence(rule, marchEighth, marchEighth), 2026, 3, 15, 10, 0);

    const octoberLast = new Date(2026, 9, 25, 10, 0);
    const novemberFirst = nextOccurrence(rule, octoberLast, octoberLast);
    assertLocal(novemberFirst, 2026, 11, 1, 10, 0);
    assertLocal(nextOccurrence(rule, novemberFirst, novemberFirst), 2026, 11, 8, 10, 0);
  });
});

test('DST gap (New York): a 2:30 AM event runs at 3:30 on the short day only', (t) => {
  withZone(t, 'America/New_York', () => {
    const due = new Date(2026, 2, 6, 2, 30);
    // 2:30 AM does not exist on Mar 8, so that day's occurrence is 3:30 AM.
    const gapDay = nextOccurrence(DAILY, due, new Date(2026, 2, 7, 2, 30));
    assertLocal(gapDay, 2026, 3, 8, 3, 30);
    // Regression: asking from later on the short day must give 2:30 on Mar 9, not 3:30.
    assertLocal(nextOccurrence(DAILY, due, new Date(2026, 2, 8, 4, 0)), 2026, 3, 9, 2, 30);
    assertLocal(nextOccurrence(DAILY, due, gapDay), 2026, 3, 9, 2, 30);
    // Before the gap on the short day, the occurrence is still that day's (shifted) one.
    assertLocal(nextOccurrence(DAILY, due, new Date(2026, 2, 8, 1, 0)), 2026, 3, 8, 3, 30);
  });
});

test('DST gap (New York): occurrencesUntil returns to 2:30 AM after the short day', (t) => {
  withZone(t, 'America/New_York', () => {
    const list = occurrencesUntil(DAILY, new Date(2026, 2, 6, 2, 30), new Date(2026, 2, 11, 12, 0));
    assert.deepEqual(
      list.map((date) => [date.getDate(), date.getHours(), date.getMinutes()]),
      [
        [6, 2, 30],
        [7, 2, 30],
        [8, 3, 30],
        [9, 2, 30],
        [10, 2, 30],
        [11, 2, 30],
      ]
    );
  });
});

test('DST repeated hour (New York): a 1:30 AM event happens once per calendar day', (t) => {
  withZone(t, 'America/New_York', () => {
    const due = new Date(2026, 9, 30, 1, 30);
    const list = occurrencesUntil(DAILY, due, new Date(2026, 10, 3, 12, 0));
    assert.deepEqual(
      list.map((date) => [date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]),
      [
        [10, 30, 1, 30],
        [10, 31, 1, 30],
        [11, 1, 1, 30],
        [11, 2, 1, 30],
        [11, 3, 1, 30],
      ]
    );
    // From the second 1:15 AM on Nov 1 (after the first 1:30 has passed) the next one is Nov 2.
    const firstPass = new Date(2026, 10, 1, 1, 15);
    const secondPass = new Date(firstPass.getTime() + 3_600_000);
    assert.equal(secondPass.getHours(), 1);
    assertLocal(nextOccurrence(DAILY, due, secondPass), 2026, 11, 2, 1, 30);
  });
});

test('DST (London): 1:30 AM is skipped forward on Mar 29 and comes back the next day', (t) => {
  withZone(t, 'Europe/London', () => {
    const due = new Date(2026, 2, 27, 1, 30);
    const list = occurrencesUntil(DAILY, due, new Date(2026, 2, 31, 12, 0));
    assert.deepEqual(
      list.map((date) => [date.getDate(), date.getHours(), date.getMinutes()]),
      [
        [27, 1, 30],
        [28, 1, 30],
        [29, 2, 30],
        [30, 1, 30],
        [31, 1, 30],
      ]
    );
    const evening = new Date(2026, 9, 24, 18, 0);
    assertLocal(nextOccurrence(DAILY, evening, evening), 2026, 10, 25, 18, 0);
  });
});

test('DST (Lord Howe, 30-minute shift): the wall-clock time is kept across both changes', (t) => {
  withZone(t, 'Australia/Lord_Howe', () => {
    const autumn = new Date(2026, 3, 4, 7, 45);
    const afterAutumn = nextOccurrence(DAILY, autumn, autumn);
    assertLocal(afterAutumn, 2026, 4, 5, 7, 45);
    assert.equal(afterAutumn.getTime() - autumn.getTime(), 24.5 * 3_600_000);

    const spring = new Date(2026, 9, 3, 7, 45);
    const afterSpring = nextOccurrence(DAILY, spring, spring);
    assertLocal(afterSpring, 2026, 10, 4, 7, 45);
    assert.equal(afterSpring.getTime() - spring.getTime(), 23.5 * 3_600_000);
  });
});
