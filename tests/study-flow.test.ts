import { describe, expect, test } from 'vitest';
import {
  emptySnapshot,
  flowLevel,
  periodDays,
  planDays,
  previousPeriodDays,
  yearWeeks,
  type Task,
} from '../src/domain';

const task = (id: string, date: string, checks: boolean[]): Task => ({
  id,
  title: id,
  date,
  details: checks.map((_, i) => `항목 ${i + 1}`),
  detailChecks: checks.map((completed, i) => ({ id: `${id}-${i}`, completed })),
  created_by: 'me',
});

describe('study flow', () => {
  test('counts plans, not detail items, so a big plan weighs like a small one', () => {
    const days = planDays({
      ...emptySnapshot(),
      tasks: [
        task('big', '2026-10-20', [true, true, true, true, false]),
        task('small', '2026-10-20', [true]),
        task('other', '2026-10-21', []),
      ],
      completedTaskIds: ['other'],
    });
    expect(days.get('2026-10-20')).toEqual({ total: 2, done: 1 });
    expect(days.get('2026-10-21')).toEqual({ total: 1, done: 1 });
  });
  test('levels rise with the share of finished plans', () => {
    expect(flowLevel(undefined)).toBe(0);
    expect(flowLevel({ total: 3, done: 0 })).toBe(0);
    expect(flowLevel({ total: 5, done: 1 })).toBe(1);
    expect(flowLevel({ total: 4, done: 1 })).toBe(2);
    expect(flowLevel({ total: 3, done: 2 })).toBe(3);
    expect(flowLevel({ total: 2, done: 2 })).toBe(4);
  });
  test('the year grid is 53 Sunday-first weeks ending with the selected week', () => {
    const weeks = yearWeeks('2026-10-21');
    expect(weeks).toHaveLength(53);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.at(-1)).toContain('2026-10-21');
    expect(weeks.at(-1)?.[0]).toBe('2026-10-18');
    expect(weeks[0][0]).toBe('2025-10-19');
  });
  test('periods cover the last 7 days or the whole month, and the one before', () => {
    expect(periodDays('2026-10-21', 'week')).toEqual([
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(previousPeriodDays('2026-10-21', 'week').at(-1)).toBe('2026-10-14');
    expect(periodDays('2026-02-10', 'month')).toHaveLength(28);
    expect(periodDays('2026-10-21', 'month').at(-1)).toBe('2026-10-31');
    const january = previousPeriodDays('2026-01-05', 'month');
    expect([january[0], january.length]).toEqual(['2025-12-01', 31]);
  });
});
