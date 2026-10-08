import { expect, test } from 'vitest';
import {
  duplicateTaskPlan,
  encodeTaskProgress,
  normalizeTask,
  dayProgress,
  type Task,
} from '../src/domain';

const source: Task = {
  id: 'original',
  title: '수학 공부',
  date: '2026-10-06',
  details: ['순열', '같은 내용', '같은 내용'],
  detailChecks: [
    { id: 'a', completed: true, completedBy: 'other', completedAt: '2026-10-06T00:00:00Z' },
    { id: 'b', completed: false },
    { id: 'c', completed: true },
  ],
  completed: false,
  completedBy: 'other',
  completedAt: 'old',
  revision: 55,
  created_by: 'other',
  workspace_id: 'source-space',
  subject: '수학',
  time: '08:00',
};

test('copy resets all progress and audit data, assigns new IDs and author, and round-trips independently', () => {
  const before = structuredClone(source);
  const copy = duplicateTaskPlan(source, '2026-10-09', 'me', 'current-space');
  expect(copy.title).toBe(source.title);
  expect(copy.details).toEqual(source.details);
  expect(copy.date).toBe('2026-10-09');
  expect(copy.created_by).toBe('me');
  expect(copy.workspace_id).toBe('current-space');
  expect(copy.id).not.toBe(source.id);
  const ids = copy.detailChecks!.map((check) => check.id);
  expect(new Set(ids).size).toBe(3);
  expect(ids.some((id) => source.detailChecks!.some((check) => check.id === id))).toBe(false);
  const decoded = normalizeTask({ ...copy, details: encodeTaskProgress(copy, new Set()) });
  expect(dayProgress([decoded], new Set())).toEqual({ total: 3, done: 0, percent: 0 });
  expect(
    decoded.detailChecks!.every(
      (check) => !check.completed && !check.completedBy && !check.completedAt,
    ),
  ).toBe(true);
  for (const key of [
    'completedBy',
    'completedAt',
    'revision',
    'created_at',
    'updated_at',
    'subject',
    'time',
    'notes',
    'attachments',
  ])
    expect(Object.hasOwn(copy, key)).toBe(false);
  copy.details[0] = '새 계획';
  copy.detailChecks![0].completed = true;
  expect(source).toEqual(before);
  source.details[1] = '원본만 수정';
  expect(copy.details[1]).toBe('같은 내용');
  Object.assign(source, before);
});

test('copies of plans without details start as one remaining item even when original was complete', () => {
  const copy = duplicateTaskPlan(
    { ...source, details: [], completed: true },
    '2026-10-09',
    'me',
    'space',
  );
  expect(dayProgress([copy], new Set([source.id]))).toEqual({ total: 1, done: 0, percent: 0 });
});

test('invalid dates are rejected before a plan can be persisted', () => {
  for (const date of ['2026-02-30', '', 'not-a-date'])
    expect(() => duplicateTaskPlan(source, date, 'me', 'space')).toThrow(/날짜/);
});

test('remaining work weights distinct IDs, preserves shared checks and follows completion and undo', () => {
  const math = structuredClone(source);
  const english = {
    ...source,
    id: 'english',
    details: ['단어', '독해'],
    detailChecks: [
      { id: 'd', completed: false },
      { id: 'e', completed: true },
    ],
  };
  math.detailChecks![2].completed = false;
  const remaining = () => {
    const p = dayProgress([math, english], new Set());
    return p.total - p.done;
  };
  expect(remaining()).toBe(3);
  math.detailChecks![1].completed = true;
  expect(remaining()).toBe(2);
  math.detailChecks![1].completed = false;
  expect(remaining()).toBe(3);
  for (const task of [math, english])
    for (const check of task.detailChecks!) check.completed = true;
  expect(remaining()).toBe(0);
  expect(dayProgress([], new Set()).total).toBe(0);
});
