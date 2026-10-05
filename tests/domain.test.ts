import { describe, expect, test } from 'vitest';
import {
  addDays,
  emptySnapshot,
  parseSnapshot,
  sampleSnapshot,
  shiftMonth,
  cleanDetails,
  encodeTaskDetails,
  normalizeTask,
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
  test('detail arrays round-trip and retired fields do not invalidate backups', () => {
    const snapshot = sampleSnapshot('2026-10-04');
    snapshot.tasks[0].subject = '철근콘크리트공학';
    snapshot.tasks[1].subject = '';
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(() => parseSnapshot({ ...snapshot, completedTaskIds: ['missing-task'] })).toThrow();
    expect(() =>
      parseSnapshot({ ...snapshot, tasks: [...snapshot.tasks, snapshot.tasks[0]] }),
    ).toThrow();
    expect(
      parseSnapshot({
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], time: '25:99', subject: '가'.repeat(80) }],
        completedTaskIds: [],
      }).tasks,
    ).toHaveLength(1);
    expect(() =>
      parseSnapshot({
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], details: [123] }],
        completedTaskIds: [],
      }),
    ).toThrow();
    const { subject: _subject, time: _time, ...task } = snapshot.tasks[0];
    expect(parseSnapshot({ ...snapshot, tasks: [task], completedTaskIds: [] }).tasks[0]).toEqual(
      task,
    );
  });
  test('v1 string notes and memo fields migrate without changing task IDs or completion', () => {
    const task = sampleSnapshot('2026-10-04').tasks[0];
    const legacy = {
      ...emptySnapshot(),
      version: 1,
      tasks: [{ ...task, details: '문제집 30페이지까지\n\n 오답 정리 ' }],
      completedTaskIds: [task.id],
    };
    const migrated = parseSnapshot(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.tasks[0].details).toEqual(['문제집 30페이지까지', '오답 정리']);
    expect(migrated.completedTaskIds).toEqual([task.id]);
    expect(normalizeTask({ ...task, details: undefined, memo: '기존 메모' }).details).toEqual([
      '기존 메모',
    ]);
  });
  test('native arrays and structured text preserve order, duplicates and intentional empty lists', () => {
    const task = sampleSnapshot().tasks[0];
    const items = [' 순열 문제 10개 ', '', '   ', '조건부확률 복습', '순열 문제 10개'];
    const cleaned = ['순열 문제 10개', '조건부확률 복습', '순열 문제 10개'];
    expect(cleanDetails(items)).toEqual(cleaned);
    expect(normalizeTask({ ...task, details: encodeTaskDetails(items) }).details).toEqual(cleaned);
    expect(normalizeTask({ ...task, details: '예전 메모', detail_items: [] }).details).toEqual([]);
    expect(
      normalizeTask({ ...task, details: encodeTaskDetails([]), memo: '예전 메모' }).details,
    ).toEqual([]);
    expect(normalizeTask({ ...task, details: '메모', detail_items: null }).details).toEqual([
      '메모',
    ]);
    // A memo that merely resembles JSON must not silently lose its original text.
    expect(normalizeTask({ ...task, details: '["참고 문구"]' }).details).toEqual(['["참고 문구"]']);
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
  });
  test('weekly statistics count detail items in the selected seven days', () => {
    const snapshot = emptySnapshot();
    const task = sampleSnapshot('2026-10-05').tasks[0];
    snapshot.tasks = [
      { ...task, id: 'a', details: ['하나', '둘', '셋'] },
      { ...task, id: 'b', date: '2026-09-29', subject: '건축시공학' },
      { ...task, id: 'c', date: '2026-09-28', subject: '기간 밖' },
      { ...task, id: 'd', date: '2026-10-06', subject: '미래' },
    ];
    snapshot.completedTaskIds = ['a', 'c'];
    const week = weeklyStats(snapshot, '2026-10-05');
    expect(week[0].date).toBe('2026-09-29');
    expect(week.reduce((sum, day) => sum + day.total, 0)).toBe(4);
    expect(week.reduce((sum, day) => sum + day.completed, 0)).toBe(3);
  });
});
