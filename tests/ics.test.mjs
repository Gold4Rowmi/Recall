// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, occurrences } from '../ui/js/ics.js';

const feed = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const week = text => occurrences(parseICS(text), '2026-11-02', '2026-11-08'); // Mon 2 to Sun 8 Nov, in daylight time (UTC+11)
const at = (e, date, minute) => e.find(x => x.date === date && x.start_minute === minute);

test('a UTC meeting lands in Melbourne time', () => {
  const [e] = week(feed(ev('UID:a', 'SUMMARY:Standup', 'DTSTART:20261102T000000Z', 'DTEND:20261102T003000Z')));
  assert.deepEqual([e.date, e.start_minute, e.duration_minutes, e.title], ['2026-11-02', 660, 30, 'Standup']);
});
test('a zoned meeting keeps its wall-clock time', () => {
  const [e] = week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261103T140000', 'DTEND;TZID=Australia/Melbourne:20261103T150000')));
  assert.deepEqual([e.date, e.start_minute, e.duration_minutes], ['2026-11-03', 840, 60]);
});
test('a Windows zone name is understood', () => {
  const [e] = week(feed(ev('UID:a', 'DTSTART;TZID=AUS Eastern Standard Time:20261103T090000', 'DTEND;TZID=AUS Eastern Standard Time:20261103T093000')));
  assert.equal(e.start_minute, 540);
});
test('a duration stands in for an end', () => {
  const [e] = week(feed(ev('UID:a', 'DTSTART:20261104T020000Z', 'DURATION:PT1H30M')));
  assert.equal(e.duration_minutes, 90);
});
test('folded lines and escaped titles are read', () => {
  const [e] = week(feed(ev('UID:a', 'SUMMARY:Plan\\, review', ' and more', 'DTSTART:20261104T020000Z', 'DTEND:20261104T030000Z')));
  assert.equal(e.title, 'Plan, reviewand more');
});
test('all-day, free, cancelled and zero-length events are skipped', () => {
  const out = week(feed(ev('UID:1', 'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104'), ev('UID:2', 'TRANSP:TRANSPARENT', 'DTSTART:20261104T020000Z', 'DTEND:20261104T030000Z'),
    ev('UID:3', 'STATUS:CANCELLED', 'DTSTART:20261104T020000Z', 'DTEND:20261104T030000Z'), ev('UID:4', 'DTSTART:20261104T020000Z', 'DTEND:20261104T020000Z')));
  assert.deepEqual(out, []);
});
test('a weekly rule repeats on its days', () => {
  const out = week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261012T100000', 'DTEND;TZID=Australia/Melbourne:20261012T103000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE')));
  assert.deepEqual(out.map(e => e.date), ['2026-11-02', '2026-11-04']);
});
test('an interval skips weeks', () => {
  const rule = 'RRULE:FREQ=WEEKLY;INTERVAL=2';
  assert.equal(week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261019T100000', 'DTEND;TZID=Australia/Melbourne:20261019T110000', rule))).length, 1); // 19 Oct, 2 Nov
  assert.equal(week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261026T100000', 'DTEND;TZID=Australia/Melbourne:20261026T110000', rule))).length, 0);
});
test('COUNT and UNTIL end a series', () => {
  const base = ['UID:a', 'DTSTART;TZID=Australia/Melbourne:20261029T100000', 'DTEND;TZID=Australia/Melbourne:20261029T110000'];
  assert.deepEqual(week(feed(ev(...base, 'RRULE:FREQ=DAILY;COUNT=5'))).map(e => e.date), ['2026-11-02']); // 29, 30, 31 Oct, 1 and 2 Nov
  assert.deepEqual(week(feed(ev(...base, 'RRULE:FREQ=DAILY;UNTIL=20261103'))).map(e => e.date), ['2026-11-02', '2026-11-03']);
});
test('EXDATE removes one occurrence', () => {
  const out = week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261102T100000', 'DTEND;TZID=Australia/Melbourne:20261102T110000', 'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;TZID=Australia/Melbourne:20261103T100000')));
  assert.deepEqual(out.map(e => e.date), ['2026-11-02', '2026-11-04']);
});
test('a moved occurrence replaces the series one', () => {
  const out = week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261102T100000', 'DTEND;TZID=Australia/Melbourne:20261102T110000', 'RRULE:FREQ=DAILY;COUNT=2'),
    ev('UID:a', 'RECURRENCE-ID;TZID=Australia/Melbourne:20261103T100000', 'DTSTART;TZID=Australia/Melbourne:20261103T150000', 'DTEND;TZID=Australia/Melbourne:20261103T160000')));
  assert.deepEqual(out.map(e => [e.date, e.start_minute]), [['2026-11-02', 600], ['2026-11-03', 900]]);
});
test('a cancelled occurrence leaves the series alone otherwise', () => {
  const out = week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261102T100000', 'DTEND;TZID=Australia/Melbourne:20261102T110000', 'RRULE:FREQ=DAILY;COUNT=3'),
    ev('UID:a', 'RECURRENCE-ID;TZID=Australia/Melbourne:20261103T100000', 'STATUS:CANCELLED', 'DTSTART;TZID=Australia/Melbourne:20261103T100000', 'DTEND;TZID=Australia/Melbourne:20261103T110000')));
  assert.deepEqual(out.map(e => e.date), ['2026-11-02', '2026-11-04']);
});
test('a monthly rule can mean the first Monday', () => {
  const out = occurrences(parseICS(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20260907T100000', 'DTEND;TZID=Australia/Melbourne:20260907T110000', 'RRULE:FREQ=MONTHLY;BYDAY=1MO'))), '2026-10-01', '2026-11-30');
  assert.deepEqual(out.map(e => e.date), ['2026-10-05', '2026-11-02']);
});
test('a series keeps its local hour across the daylight change', () => {
  const out = occurrences(parseICS(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20260901T090000', 'DTEND;TZID=Australia/Melbourne:20260901T100000', 'RRULE:FREQ=WEEKLY;BYDAY=TU'))), '2026-09-29', '2026-10-13');
  assert.ok(out.length >= 3 && out.every(e => e.start_minute === 540)); // daylight time starts 4 Oct
});
test('a meeting in another zone is converted for Melbourne', () => {
  const [e] = week(feed(ev('UID:a', 'DTSTART;TZID=America/New_York:20261102T100000', 'DTEND;TZID=America/New_York:20261102T110000'))); // 10:00 EST is 15:00 UTC
  assert.deepEqual([e.date, e.start_minute], ['2026-11-03', 120]);
});
test('a meeting over midnight is split by day', () => {
  const out = week(feed(ev('UID:a', 'DTSTART;TZID=Australia/Melbourne:20261103T233000', 'DTEND;TZID=Australia/Melbourne:20261104T003000')));
  assert.deepEqual(out.map(e => [e.date, e.start_minute, e.duration_minutes]), [['2026-11-03', 1410, 30], ['2026-11-04', 0, 30]]);
});
test('an unknown zone reads as Melbourne and junk does not throw', () => {
  const [e] = week(feed(ev('UID:a', 'DTSTART;TZID=Customized Time Zone:20261103T090000', 'DTEND;TZID=Customized Time Zone:20261103T093000'), ev('UID:b', 'DTSTART:nonsense')));
  assert.equal(e.start_minute, 540);
  assert.deepEqual(week(''), []);
});
