import { describe, expect, test } from 'vitest';
import {
  dayProgress,
  encodeTaskProgress,
  emptySnapshot,
  normalizeTask,
  parseSnapshot,
  reconcileCompletion,
  taskProgress,
  progressPercent,
  weeklyStats,
  type Task,
} from '../src/domain';

const parent: Task = {
  id: 'task',
  title: '수학 공부',
  date: '2026-10-05',
  created_by: 'local',
  details: ['순열', '확률', '오답'],
  detailChecks: [
    { id: 'a', completed: true },
    { id: 'b', completed: false },
    { id: 'c', completed: false },
  ],
};

describe('detail completion and progress', () => {
  test('100% appears only when every item is complete', () => {
    expect(progressPercent(199, 200)).toBe(99);
    expect(progressPercent(200, 200)).toBe(100);
  });
  test('each detail and a single task have the intended weight, without NaN for an empty day', () => {
    expect(taskProgress(parent, new Set())).toEqual({ done: 1, total: 3, percent: 33 });
    expect(
      dayProgress(
        [parent, { ...parent, id: 'single', details: [], detailChecks: [] }],
        new Set(['single']),
      ),
    ).toEqual({ done: 2, total: 4, percent: 50 });
    expect(dayProgress([], new Set())).toEqual({ done: 0, total: 0, percent: 0 });
  });
  test('parent completion, calendar and weekly stats agree with the child states', () => {
    const partial = reconcileCompletion({
      ...emptySnapshot(),
      tasks: [parent],
      completedTaskIds: ['task'],
    });
    expect(partial.completedTaskIds).toEqual([]);
    const finished = reconcileCompletion({
      ...partial,
      tasks: [
        {
          ...parent,
          detailChecks: parent.detailChecks!.map((check) => ({ ...check, completed: true })),
        },
      ],
    });
    expect(finished.completedTaskIds).toEqual(['task']);
    expect(weeklyStats(finished, parent.date).at(-1)?.completed).toBe(1);
    expect(taskProgress(finished.tasks[0], new Set())).toEqual({ done: 3, total: 3, percent: 100 });
  });
  test('structured storage round-trips stable IDs, partial checks and duplicate text with or without a native array', () => {
    const duplicate = { ...parent, details: ['같은 내용', '같은 내용', '오답'] };
    const encoded = encodeTaskProgress(duplicate, new Set());
    for (const detail_items of [undefined, duplicate.details]) {
      const decoded = normalizeTask({
        ...duplicate,
        detailChecks: undefined,
        details: encoded,
        detail_items,
      });
      expect(decoded.details).toEqual(duplicate.details);
      expect(decoded.detailChecks).toEqual(parent.detailChecks);
      expect(decoded.completed).toBe(false);
    }
    expect(parseSnapshot({ ...emptySnapshot(), tasks: [duplicate] }).tasks[0].detailChecks).toEqual(
      parent.detailChecks,
    );
  });
  test('legacy incomplete details default to false and legacy completed parents stay completed', () => {
    const raw = { ...parent, detailChecks: undefined };
    const open = parseSnapshot({
      ...emptySnapshot(),
      version: 1,
      tasks: [raw],
      completedTaskIds: [],
    });
    expect(open.tasks[0].detailChecks?.every((check) => !check.completed)).toBe(true);
    const done = parseSnapshot({
      ...emptySnapshot(),
      version: 2,
      tasks: [raw],
      completedTaskIds: ['task'],
    });
    expect(done.tasks[0].detailChecks?.every((check) => check.completed)).toBe(true);
    expect(done.completedTaskIds).toEqual(['task']);
  });
  test('removing a blank or middle row keeps the completion with its own stable ID', () => {
    const raw = {
      ...parent,
      details: ['순열', '   ', '오답'],
      detailChecks: [
        { id: 'a', completed: true },
        { id: 'blank', completed: true },
        { id: 'c', completed: false },
      ],
    };
    const clean = normalizeTask(raw);
    expect(clean.details).toEqual(['순열', '오답']);
    expect(clean.detailChecks).toEqual([
      { id: 'a', completed: true },
      { id: 'c', completed: false },
    ]);
    expect(taskProgress(clean, new Set()).percent).toBe(50);
  });
  test('explicit empty-task completion wins over stale legacy aggregate rows', () => {
    const single = { ...parent, details: [], detailChecks: [], completed: false };
    const encoded = encodeTaskProgress(single, new Set(['task']));
    const task = normalizeTask({ ...single, details: encoded });
    expect(
      reconcileCompletion({ ...emptySnapshot(), tasks: [task], completedTaskIds: ['task'] })
        .completedTaskIds,
    ).toEqual([]);
    expect(taskProgress({ ...task, completed: true }, new Set()).percent).toBe(100);
  });
});
