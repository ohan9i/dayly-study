import { expect, test } from 'vitest';
import { emptySnapshot, importablePlans, parseSnapshot, type Task } from '../src/domain';

const plan = (id: string, title: string, date: string, details: string[] = []): Task => ({
  id,
  title,
  date,
  details,
  detailChecks: details.map((_, i) => ({ id: `${id}-${i}`, completed: true })),
  completed: true,
  created_by: 'someone',
  workspace_id: 'old-space',
});

test('imported plans are new plans of the current space without progress', () => {
  const backup = parseSnapshot({
    ...emptySnapshot(),
    tasks: [plan('a', '수학', '2026-10-01', ['순열', '조합'])],
    completedTaskIds: ['a'],
  });
  const { plans, skipped } = importablePlans(backup, [], 'me', 'space');
  expect(skipped).toBe(0);
  expect(plans).toHaveLength(1);
  const [copy] = plans;
  expect(copy.id).not.toBe('a');
  expect(copy).toMatchObject({
    title: '수학',
    date: '2026-10-01',
    details: ['순열', '조합'],
    completed: false,
    created_by: 'me',
    workspace_id: 'space',
  });
  expect(copy.detailChecks!.every((check) => !check.completed)).toBe(true);
});

test('plans already in the space, or repeated in the file, are skipped', () => {
  const backup = parseSnapshot({
    ...emptySnapshot(),
    tasks: [
      plan('a', '수학', '2026-10-01', ['순열']),
      plan('b', '수학', '2026-10-01', ['순열']),
      plan('c', '수학', '2026-10-02', ['순열']),
      plan('d', '영어', '2026-10-01'),
    ],
  });
  const existing = [plan('x', '영어 ', '2026-10-01')];
  const { plans, skipped } = importablePlans(backup, existing, 'me', 'space');
  expect(skipped).toBe(2);
  expect(plans.map((task) => [task.title, task.date])).toEqual([
    ['수학', '2026-10-01'],
    ['수학', '2026-10-02'],
  ]);
});
