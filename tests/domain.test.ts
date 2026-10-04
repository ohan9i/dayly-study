import { describe, expect, test } from 'vitest';
import {
  addDays,
  emptySnapshot,
  parseSnapshot,
  sampleSnapshot,
  shiftMonth,
  validDate,
  weeklyStats,
} from '../src/domain';

describe('dates and backups', () => {
  test('handles leap years and month boundaries without time-zone drift', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(validDate('2026-02-29')).toBe(false);
  });
  test('valid backup round-trips and invalid references cannot be imported', () => {
    const snapshot = sampleSnapshot('2026-10-04');
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(() => parseSnapshot({ ...snapshot, completedTaskIds: ['missing-task'] })).toThrow();
    expect(() =>
      parseSnapshot({ ...snapshot, tasks: [...snapshot.tasks, snapshot.tasks[0]] }),
    ).toThrow();
    expect(() =>
      parseSnapshot({ ...snapshot, tasks: [{ ...snapshot.tasks[0], time: '25:99' }] }),
    ).toThrow();
  });
  test('weekly stats include only the selected seven days', () => {
    const snapshot = emptySnapshot();
    snapshot.logs = [
      {
        id: 'a',
        title: '구조',
        subject: '전공',
        date: '2026-10-04',
        content: '',
        minutes: 40,
        created_by: 'local',
      },
      {
        id: 'b',
        title: '구조',
        subject: '전공',
        date: '2026-09-27',
        content: '',
        minutes: 80,
        created_by: 'local',
      },
    ];
    const week = weeklyStats(snapshot, '2026-10-04');
    expect(week[0].date).toBe('2026-09-28');
    expect(week.reduce((s, x) => s + x.minutes, 0)).toBe(40);
  });
});
