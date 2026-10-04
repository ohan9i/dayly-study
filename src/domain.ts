export const LOCAL_KEY = 'dayly.planner.v1';
export const SUBJECTS = ['전공', '수학', '생활', '기록', '기타'] as const;
export type Subject = (typeof SUBJECTS)[number];
export type Task = {
  id: string;
  title: string;
  subject: Subject;
  date: string;
  time: string;
  details: string;
  created_by: string;
  workspace_id?: string;
};
export type StudyLog = {
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
  version: 1;
  tasks: Task[];
  logs: StudyLog[];
  completedTaskIds: string[];
  hasSamples: boolean;
};
export type Workspace = { id: string; name: string; owner_id: string };
export type Member = { id: string; workspace_id: string; email: string; role: 'editor' };
export const emptySnapshot = (): Snapshot => ({
  version: 1,
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
  [...tasks].sort(
    (a, b) =>
      (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title, 'ko'),
  );
export function sampleSnapshot(date = todayKey()): Snapshot {
  const rows: [string, Subject, string][] = [
    ['아침 스트레칭하기', '생활', '07:00'],
    ['물 한 잔 마시기', '생활', '07:30'],
    ['학습 문제 10문제 풀기', '수학', '09:00'],
    ['구조 역학 정리하기', '전공', '11:00'],
    ['점심 먹고 잠깐 산책하기', '생활', '12:30'],
    ['건축계획 문제 풀기', '전공', '14:00'],
    ['오늘 공부한 내용 기록하기', '기록', '22:00'],
  ];
  const tasks = rows.map(([title, subject, time], i) => ({
    id: `sample-${i}`,
    title,
    subject,
    time,
    date,
    details: '',
    created_by: 'local',
  }));
  return {
    version: 1,
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
  const v = value as Snapshot;
  if (
    v.version !== 1 ||
    !Array.isArray(v.tasks) ||
    !Array.isArray(v.logs) ||
    !Array.isArray(v.completedTaskIds) ||
    typeof v.hasSamples !== 'boolean' ||
    v.tasks.length + v.logs.length > 10000
  )
    return fail();
  const base = (x: Task | StudyLog) =>
    x &&
    typeof x.id === 'string' &&
    x.id.length > 0 &&
    typeof x.title === 'string' &&
    x.title.trim().length > 0 &&
    x.title.length <= 150 &&
    SUBJECTS.includes(x.subject) &&
    validDate(x.date) &&
    typeof x.created_by === 'string';
  if (
    !v.tasks.every(
      (x) =>
        base(x) &&
        typeof x.details === 'string' &&
        x.details.length <= 10000 &&
        typeof x.time === 'string' &&
        (x.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time)),
    )
  )
    return fail();
  if (
    !v.logs.every(
      (x) =>
        base(x) &&
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
  return v;
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
      minutes: data.logs.filter((x) => x.date === date).reduce((sum, x) => sum + x.minutes, 0),
    };
  });
}
