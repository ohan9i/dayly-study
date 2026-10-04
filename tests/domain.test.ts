import { describe, expect, test } from 'vitest';
import {
  addDays,
  emptySnapshot,
  parseSnapshot,
  sampleSnapshot,
  shiftMonth,
  SUBJECT_MAX_LENGTH,
  subjectStats,
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
  test('custom and blank subjects round-trip while invalid backups are rejected', () => {
    const snapshot = sampleSnapshot('2026-10-04');
    snapshot.tasks[0].subject = '철근콘크리트공학';
    snapshot.tasks[1].subject = '';
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(() => parseSnapshot({ ...snapshot, completedTaskIds: ['missing-task'] })).toThrow();
    expect(() =>
      parseSnapshot({ ...snapshot, tasks: [...snapshot.tasks, snapshot.tasks[0]] }),
    ).toThrow();
    expect(() =>
      parseSnapshot({ ...snapshot, tasks: [{ ...snapshot.tasks[0], time: '25:99' }] }),
    ).toThrow();
    expect(() =>
      parseSnapshot({
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], subject: '가'.repeat(SUBJECT_MAX_LENGTH + 1) }],
      }),
    ).toThrow();
  });
  test('old study logs remain in backups without appearing in task statistics', () => {
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
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot))).logs).toEqual(snapshot.logs);
    expect(
      weeklyStats(snapshot, '2026-10-04').every((day) => day.total === 0 && day.completed === 0),
    ).toBe(true);
    expect(subjectStats(snapshot, '2026-10-04')).toEqual([]);
  });
  test('weekly and custom-subject statistics include only the selected seven days', () => {
    const snapshot = emptySnapshot();
    const task = sampleSnapshot('2026-10-05').tasks[0];
    snapshot.tasks = [
      { ...task, id: 'a', subject: '건축시공학' },
      { ...task, id: 'b', date: '2026-09-29', subject: '건축시공학' },
      { ...task, id: 'c', date: '2026-09-28', subject: '기간 밖' },
      { ...task, id: 'd', date: '2026-10-06', subject: '미래' },
    ];
    snapshot.completedTaskIds = ['a', 'c'];
    const week = weeklyStats(snapshot, '2026-10-05');
    expect(week[0].date).toBe('2026-09-29');
    expect(week.reduce((sum, day) => sum + day.total, 0)).toBe(2);
    expect(week.reduce((sum, day) => sum + day.completed, 0)).toBe(1);
    expect(subjectStats(snapshot, '2026-10-05')).toEqual([
      { subject: '건축시공학', total: 2, completed: 1 },
    ]);
  });
});
