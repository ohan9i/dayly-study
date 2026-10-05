export const LOCAL_KEY = 'dayly.planner.v1';
export const SUBJECT_MAX_LENGTH = 40;
export type Subject = string;
export type Task = {
  id: string;
  title: string;
  // Retired fields are optional and retained only for existing records/backups.
  subject?: Subject;
  date: string;
  time?: string;
  details: string[];
  created_by: string;
  workspace_id?: string;
};
export type TaskRecord = Omit<Task, 'details'> & {
  details?: unknown;
  memo?: unknown;
  detail_items?: unknown;
};
// The existing database has a text column. A versioned JSON envelope keeps each
// item independent until the optional native text[] column is installed.
export const DETAILS_PREFIX = 'dayly:details:v2:';
export const cleanDetails = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
export const encodeTaskDetails = (items: string[]) =>
  DETAILS_PREFIX + JSON.stringify(cleanDetails(items));
export function readTaskDetails(
  task: Pick<TaskRecord, 'details' | 'memo' | 'detail_items'>,
): string[] {
  for (const value of [task.detail_items, task.details]) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
      return cleanDetails(value);
  }
  const value =
    typeof task.details === 'string' && task.details.trim()
      ? task.details
      : typeof task.memo === 'string'
        ? task.memo
        : '';
  if (value.startsWith(DETAILS_PREFIX)) {
    try {
      const items: unknown = JSON.parse(value.slice(DETAILS_PREFIX.length));
      if (Array.isArray(items) && items.every((item) => typeof item === 'string'))
        return cleanDetails(items);
    } catch {
      // A malformed envelope remains readable as legacy text rather than disappearing.
    }
  }
  return cleanDetails(value.split(/\r\n|\r|\n/));
}
export const normalizeTask = (task: TaskRecord): Task => {
  const { detail_items: _items, memo: _memo, ...fields } = task;
  return { ...fields, details: readTaskDetails(task) };
};
// Preserve old journals in local backups without exposing the removed feature.
type LegacyStudyLog = {
  id: string;
  title: string;
  subject: Subject;
  date: string;
  content: string;
  minutes: number;
  created_by: string;
  workspace_id?: string;
};
export type Snapshot = {
  version: 2;
  tasks: Task[];
  logs: LegacyStudyLog[];
  completedTaskIds: string[];
  hasSamples: boolean;
  taskNotes?: TaskNote[];
  attachments?: TaskAttachment[];
};
export type Workspace = { id: string; name: string; owner_id: string };
export type Member = { id: string; workspace_id: string; email: string; role: 'editor' };
export type TaskNote = {
  id: string;
  workspace_id: string;
  task_id: string;
  created_by: string;
  body: string;
  created_at: string;
  updated_at: string;
};
export type TaskAttachment = {
  id: string;
  workspace_id: string;
  task_id: string;
  note_id: string | null;
  created_by: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  object_path: string;
  state: 'pending' | 'ready';
  created_at: string;
};
export const emptySnapshot = (): Snapshot => ({
  version: 2,
  tasks: [],
  logs: [],
  completedTaskIds: [],
  hasSamples: false,
});
export const todayKey = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const dateObject = (date: string) => new Date(`${date}T12:00:00Z`);
export function addDays(date: string, days: number) {
  const value = dateObject(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function shiftMonth(date: string, step: number) {
  const value = dateObject(date);
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + step);
  return value.toISOString().slice(0, 10);
}
export const formatDate = (date: string, full = false) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    year: 'numeric',
    month: full ? 'long' : 'numeric',
    day: 'numeric',
    weekday: 'long',
  }).format(dateObject(date));
export const validDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(dateObject(value).getTime()) &&
  dateObject(value).toISOString().slice(0, 10) === value;
export const sortedTasks = (tasks: Task[]) =>
  [...tasks].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
export function sampleSnapshot(date = todayKey()): Snapshot {
  const rows: [string, string[]][] = [
    ['아침 스트레칭하기', []],
    ['물 한 잔 마시기', []],
    ['수학 공부', ['순열 문제 10개 풀기', '조건부확률 복습', '오답노트 정리']],
    ['구조 역학 정리하기', ['전단력·휨모멘트도 그리기', '연습문제 풀이 다시 확인']],
    ['점심 먹고 잠깐 산책하기', []],
    ['건축계획 문제 풀기', []],
    ['건축시공학 노트 복습하기', []],
  ];
  const tasks = rows.map(([title, details], i) => ({
    id: `sample-${i}`,
    title,
    date,
    details,
    created_by: 'local',
  }));
  return {
    version: 2,
    tasks,
    logs: [],
    completedTaskIds: tasks.slice(0, 5).map((x) => x.id),
    hasSamples: true,
  };
}
export function parseSnapshot(value: unknown): Snapshot {
  const fail = () => {
    throw new Error('Dayly 백업 파일의 형식이 올바르지 않습니다.');
  };
  if (!value || typeof value !== 'object') return fail();
  const v = value as Omit<Snapshot, 'version' | 'tasks'> & { version: number; tasks: TaskRecord[] };
  if (
    (v.version !== 1 && v.version !== 2) ||
    !Array.isArray(v.tasks) ||
    !Array.isArray(v.logs) ||
    !Array.isArray(v.completedTaskIds) ||
    typeof v.hasSamples !== 'boolean' ||
    v.tasks.length + v.logs.length > 10000
  )
    return fail();
  const base = (x: TaskRecord | LegacyStudyLog) =>
    x &&
    typeof x.id === 'string' &&
    x.id.length > 0 &&
    typeof x.title === 'string' &&
    x.title.trim().length > 0 &&
    x.title.length <= 150 &&
    validDate(x.date) &&
    typeof x.created_by === 'string';
  if (
    !v.tasks.every(
      (x) =>
        base(x) &&
        [x.details, x.detail_items, x.memo].every(
          (value) =>
            value == null ||
            (typeof value === 'string' && value.length <= 10000) ||
            (Array.isArray(value) &&
              value.every((item) => typeof item === 'string') &&
              value.reduce((size, item) => size + item.length, 0) <= 10000),
        ),
    )
  )
    return fail();
  if (
    !v.logs.every(
      (x) =>
        base(x) &&
        typeof x.subject === 'string' &&
        x.subject.length <= SUBJECT_MAX_LENGTH &&
        typeof x.content === 'string' &&
        x.content.length <= 10000 &&
        Number.isInteger(x.minutes) &&
        x.minutes >= 0 &&
        x.minutes <= 1440,
    )
  )
    return fail();
  const ids = new Set(v.tasks.map((x) => x.id));
  if (
    ids.size !== v.tasks.length ||
    new Set(v.logs.map((x) => x.id)).size !== v.logs.length ||
    new Set(v.completedTaskIds).size !== v.completedTaskIds.length ||
    !v.completedTaskIds.every((x) => typeof x === 'string' && ids.has(x))
  )
    return fail();
  return { ...v, version: 2, tasks: v.tasks.map(normalizeTask) };
}
export function readLocal(): { data: Snapshot; warning: string } {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return { data: raw ? parseSnapshot(JSON.parse(raw)) : sampleSnapshot(), warning: '' };
  } catch {
    return {
      data: emptySnapshot(),
      warning:
        '저장된 기록을 읽지 못했습니다. 기존 저장 데이터는 유지했습니다. 브라우저의 저장 권한을 확인해 주세요.',
    };
  }
}
export function writeLocal(value: Snapshot) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
  } catch {
    throw new Error(
      '이 브라우저에 기록을 저장하지 못했습니다. 저장 공간과 브라우저 권한을 확인해 주세요.',
    );
  }
}
export function weeklyStats(data: Snapshot, end: string) {
  const completed = new Set(data.completedTaskIds);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(end, i - 6),
      tasks = data.tasks.filter((x) => x.date === date);
    return {
      date,
      total: tasks.length,
      completed: tasks.filter((x) => completed.has(x.id)).length,
    };
  });
}
