import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import {
  emptySnapshot,
  encodeTaskProgress,
  reconcileCompletion,
  isTaskComplete,
  normalizeTask,
  validDate,
  readLocal,
  type Snapshot,
  type Task,
  type TaskRecord,
  type Workspace,
  type Member,
  type TaskNote,
  type TaskAttachment,
} from './domain';
import { FILE_BUCKET, removeFileRecords, validateFile } from './files';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let configurationError = '';
export const supabase = (() => {
  if (!url || !key) return null;
  try {
    if (key.startsWith('sb_secret_'))
      throw new Error(
        'secret key는 브라우저에서 사용할 수 없습니다. publishable key로 변경해 주세요.',
      );
    if (key.startsWith('eyJ')) {
      const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      if (JSON.parse(atob(encoded)).role === 'service_role')
        throw new Error('service_role key는 사용할 수 없습니다. publishable key로 변경해 주세요.');
    }
    return createClient(url, key);
  } catch (error) {
    configurationError = (error as Error).message;
    return null;
  }
})();
const localInitial = readLocal();
const throwIf = (error: { message: string; code?: string } | null) => {
  if (error) throw Object.assign(new Error(error.message), error);
};
function readError(cause: unknown) {
  const { code, message = '' } = cause as { code?: string; message?: string };
  if (code === '42501')
    return '접근 권한을 확인하지 못했어요. 공유 승인과 서버 권한 설정을 확인해 주세요.';
  if (['PGRST202', 'PGRST204', '42P01', '42703'].includes(code || ''))
    return '서버 업데이트가 필요해요. 관리자에게 데이터베이스 설정 확인을 요청해 주세요.';
  if (code === 'PGRST301' || /jwt|refresh.token|session.*expired/i.test(message))
    return '로그인 확인이 만료됐어요. 계정 화면에서 다시 로그인해 주세요.';
  return '연결을 확인하고 공유 기록 새로고침을 눌러 주세요.';
}
async function readAllRows<T>(
  table: string,
  space: string,
  columns = '*',
  filter?: { column: string; value: string },
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const query = supabase!
      .from(table)
      .select(columns)
      .eq('workspace_id', space)
      .order(table === 'task_completions' ? 'task_id' : 'id')
      .range(start, start + 499);
    const result = await (filter ? query.eq(filter.column, filter.value) : query);
    throwIf(result.error);
    const batch = result.data as T[];
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}

export function usePlanner() {
  const [session, setSession] = useState<Session | null>(null);
  const localData = localInitial.data;
  const [remoteData, setRemoteData] = useState<Snapshot>(emptySnapshot);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(configurationError || localInitial.warning);
  const [notice, setNotice] = useState('');
  const [readiness, setReadiness] = useState({
    core: false,
    records: false,
    members: false,
    complete: false,
  });
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    try {
      return sessionStorage.getItem('dayly.passwordRecovery') === '1';
    } catch {
      return false;
    }
  });
  const completePasswordRecovery = () => {
    try {
      sessionStorage.removeItem('dayly.passwordRecovery');
    } catch {
      /* The in-memory state still clears. */
    }
    setPasswordRecovery(false);
  };
  const activeWorkspace = useRef<Workspace | null>(null);
  const activeSession = useRef<Session | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const provisionedUser = useRef<string | null>(null);
  const nativeDetails = useRef<boolean | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const syncPending = useRef(false);
  const syncReading = useRef(false);
  const foregroundLoading = useRef(false);
  const foregroundToken = useRef(0);
  const ready = useRef(readiness);
  const activitySeen = useRef<{ space: string; revision: number } | null>(null);
  const data = session ? remoteData : localData;
  const isOwner = !session || workspace?.owner_id === session.user.id;
  // Copy revalidates membership and source access on the server. An unrelated
  // completion-list read failure must not also lock this independent action.
  const canDuplicate = !loading && Boolean(session && workspace) && !passwordRecovery;
  const canWrite = canDuplicate && readiness.core;
  const canManageRecords = canWrite && readiness.records;
  const canManageMembers = canWrite && readiness.members;

  const refresh = useCallback(async (user: Session, preferredId?: string, background = false) => {
    if (!supabase) return;
    if (background && foregroundLoading.current) {
      syncPending.current = true;
      return;
    }
    const token = ++generation.current;
    if (!background) {
      foregroundLoading.current = true;
      foregroundToken.current = token;
      setLoading(true);
    }
    try {
      if (provisionedUser.current !== user.user.id) {
        const personal = await supabase.rpc('ensure_personal_workspace');
        throwIf(personal.error);
        provisionedUser.current = user.user.id;
      }
      const result = await supabase
        .from('workspaces')
        .select('id,name,owner_id')
        .order('created_at');
      throwIf(result.error);
      const list = (result.data || []) as Workspace[];
      let remembered = '';
      try {
        remembered = localStorage.getItem(`dayly.workspace.${user.user.id}`) || '';
      } catch {
        /* Optional preference. */
      }
      const wanted = preferredId || activeWorkspace.current?.id || remembered;
      const lostAccess = Boolean(wanted && !list.some((space) => space.id === wanted));
      const selected =
        list.find((x) => x.id === wanted) ||
        list.find((x) => x.owner_id === user.user.id) ||
        list[0] ||
        null;
      let next = emptySnapshot(),
        nextMembers: Member[] = [];
      let revision = -1;
      const warnings: string[] = [];
      let notesLoaded = true,
        filesLoaded = true;
      const previousSpace = activeWorkspace.current?.id;
      const nextReady = { core: false, records: false, members: false, complete: false };
      if (
        lostAccess &&
        token === generation.current &&
        activeSession.current?.user.id === user.user.id
      ) {
        const name = activeWorkspace.current?.name || '이전에 선택한 공간';
        const hadActiveSpace = Boolean(activeWorkspace.current);
        setNotice((previous) =>
          previous && !hadActiveSpace
            ? previous
            : `“${name}”에 접근할 수 없어요. 로그인 계정과 공유 승인을 확인해 주세요.`,
        );
        // Clear inaccessible cached data even if reading the fallback later fails.
        activeWorkspace.current = null;
        setWorkspace(null);
        setRemoteData(emptySnapshot());
        setMembers([]);
        setWorkspaces(list);
        ready.current = nextReady;
        setReadiness(nextReady);
      }
      if (selected) {
        const activity = await supabase
          .from('workspace_activity')
          .select('revision')
          .eq('workspace_id', selected.id)
          .maybeSingle();
        if (activity.error)
          warnings.push(`변경 알림을 불러오지 못했어요. ${readError(activity.error)}`);
        revision = activity.data?.revision ?? 0;
        const results = await Promise.allSettled([
          readAllRows<TaskRecord>('tasks', selected.id),
          readAllRows<{ task_id: string }>('task_completions', selected.id, 'task_id'),
          selected.owner_id === user.user.id
            ? readAllRows<Member>('workspace_members', selected.id)
            : Promise.resolve([] as Member[]),
          readAllRows<TaskNote>('task_notes', selected.id),
          readAllRows<TaskAttachment>('task_attachments', selected.id),
        ]);
        const [taskResult, checkResult, granted, noteResult, fileResult] = results;
        if (taskResult.status === 'rejected') throw taskResult.reason;
        if (checkResult.status === 'rejected') throw checkResult.reason;
        const tasks = taskResult.value;
        const checks = checkResult.value;
        notesLoaded = noteResult.status === 'fulfilled';
        filesLoaded = fileResult.status === 'fulfilled';
        const taskNotes = noteResult.status === 'fulfilled' ? noteResult.value : [];
        const attachments = fileResult.status === 'fulfilled' ? fileResult.value : [];
        for (const [label, result] of [
          ['공유 참여자', granted],
          ['수행 기록', noteResult],
          ['첨부 목록', fileResult],
        ] as const) {
          if (result.status === 'rejected')
            warnings.push(`${label}을 불러오지 못했어요. ${readError(result.reason)}`);
        }
        nextReady.core = true;
        nextReady.records = noteResult.status === 'fulfilled' && fileResult.status === 'fulfilled';
        nextReady.members = granted.status === 'fulfilled';
        nextReady.complete = warnings.length === 0;
        next = reconcileCompletion({
          version: 2,
          tasks: tasks.map((task) =>
            normalizeTask(
              task,
              checks.some((check) => check.task_id === task.id),
            ),
          ),
          logs: [],
          completedTaskIds: checks.map((x) => x.task_id),
          hasSamples: false,
          taskNotes,
          attachments,
        });
        if (tasks.length) nativeDetails.current = Object.hasOwn(tasks[0], 'detail_items');
        nextMembers = granted.status === 'fulfilled' ? granted.value : [];
      }
      if (token !== generation.current || activeSession.current?.user.id !== user.user.id) return;
      setWorkspaces(list);
      setWorkspace(selected);
      activeWorkspace.current = selected;
      activitySeen.current = selected ? { space: selected.id, revision } : null;
      syncPending.current = false;
      try {
        if (selected) localStorage.setItem(`dayly.workspace.${user.user.id}`, selected.id);
      } catch {
        /* Optional preference. */
      }
      setRemoteData((previous) => ({
        ...next,
        taskNotes:
          !notesLoaded && previousSpace === selected?.id && !lostAccess
            ? previous.taskNotes?.filter((note) =>
                next.tasks.some((task) => task.id === note.task_id),
              )
            : next.taskNotes,
        attachments:
          !filesLoaded && previousSpace === selected?.id && !lostAccess
            ? previous.attachments?.filter((file) =>
                next.tasks.some((task) => task.id === file.task_id),
              )
            : next.attachments,
      }));
      setMembers(nextMembers);
      ready.current = nextReady;
      setReadiness(nextReady);
      setError(warnings.join(' '));
      setLastSaved(new Date());
    } catch (e) {
      if (token === generation.current) {
        ready.current = { core: false, records: false, members: false, complete: false };
        setReadiness(ready.current);
        setError(`공유 기록을 불러오지 못했어요. ${readError(e)}`);
      }
      throw e;
    } finally {
      if (foregroundToken.current === token && !background) {
        foregroundLoading.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const update = (next: Session | null) => {
      if (!alive) return;
      const accountChanged = next?.user.id !== activeSession.current?.user.id;
      const ended = Boolean(activeSession.current && !next);
      if (accountChanged) {
        generation.current++;
        foregroundLoading.current = false;
        ready.current = { core: false, records: false, members: false, complete: false };
        setReadiness(ready.current);
        provisionedUser.current = null;
        setRemoteData(emptySnapshot());
        setWorkspace(null);
        activeWorkspace.current = null;
        setMembers([]);
        setWorkspaces([]);
        if (next) setNotice('');
      }
      activeSession.current = next;
      setSession(next);
      if (next) {
        // Supabase can emit SIGNED_IN again when a tab becomes visible.
        // Renew the session without disabling editors or reloading their data.
        if (accountChanged) void refresh(next).catch(() => {});
      } else {
        if (ended)
          setNotice('로그인 세션이 종료됐어요. 기록을 다시 보려면 같은 계정으로 로그인해 주세요.');
        completePasswordRecovery();
        generation.current++;
        setWorkspace(null);
        activeWorkspace.current = null;
        setRemoteData(emptySnapshot());
        setWorkspaces([]);
        setMembers([]);
        setLoading(false);
      }
    };
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!alive) return;
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else update(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') {
        try {
          sessionStorage.setItem('dayly.passwordRecovery', '1');
        } catch {
          /* The current page remains in recovery mode. */
        }
        setPasswordRecovery(true);
      }
      // Database requests run outside the auth callback to avoid auth-client lock contention.
      if (
        event !== 'INITIAL_SESSION' &&
        (event !== 'TOKEN_REFRESHED' || next?.user.id !== activeSession.current?.user.id)
      )
        setTimeout(() => update(next), 0);
      else if (event === 'TOKEN_REFRESHED') {
        activeSession.current = next;
        setSession(next);
      }
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
      generation.current++;
    };
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !session || readiness.complete || passwordRecovery) return;
    let alive = true,
      attempts = 0,
      retrying = false;
    const retry = () => {
      if (
        !alive ||
        retrying ||
        lock.current ||
        foregroundLoading.current ||
        activeSession.current?.user.id !== session.user.id
      )
        return;
      retrying = true;
      void refresh(activeSession.current, activeWorkspace.current?.id, true)
        .catch(() => {})
        .finally(() => {
          retrying = false;
        });
    };
    const timer = window.setInterval(() => {
      if (lock.current || foregroundLoading.current) return;
      if (++attempts <= 3) retry();
      else clearInterval(timer);
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.user.id, readiness.complete, passwordRecovery, refresh]);

  useEffect(() => {
    if (!supabase || !session || !workspace || passwordRecovery) return;
    let alive = true,
      checking = false,
      seen = activitySeen.current?.space === workspace.id ? activitySeen.current.revision : -1;
    const spaceId = workspace.id;
    const synchronize = async () => {
      if (checking || !alive || activeWorkspace.current?.id !== spaceId) return;
      if (lock.current || foregroundLoading.current) {
        syncPending.current = true;
        return;
      }
      checking = true;
      syncReading.current = true;
      try {
        if (activitySeen.current?.space === spaceId)
          seen = Math.max(seen, activitySeen.current.revision);
        const activity = await supabase!
          .from('workspace_activity')
          .select('revision,request_id')
          .eq('workspace_id', spaceId)
          .maybeSingle();
        if (activity.error) throw activity.error;
        if (!alive || lock.current || foregroundLoading.current) {
          syncPending.current = true;
          return;
        }
        if (!activity.data) {
          // A newly provisioned empty space has no activity row yet. Distinguish
          // it from removed membership without repeatedly reloading a draft.
          const access = await supabase!
            .from('workspaces')
            .select('id')
            .eq('id', spaceId)
            .maybeSingle();
          throwIf(access.error);
          if (!alive || lock.current || foregroundLoading.current) {
            syncPending.current = true;
            return;
          }
          if (!access.data) await refresh(activeSession.current!, spaceId, true);
          else {
            seen = 0;
            syncPending.current = false;
          }
        } else if (activity.data.revision !== seen || syncPending.current) {
          const previous = seen;
          seen = activity.data.revision;
          if (
            previous < 0 ||
            activity.data.request_id !== requestId.current ||
            seen - previous > 1 ||
            syncPending.current
          ) {
            syncPending.current = false;
            await refresh(activeSession.current!, spaceId, true);
          }
        }
      } catch {
        // An offline tab keeps its draft and retries on the next heartbeat.
        syncPending.current = true;
      } finally {
        checking = false;
        syncReading.current = false;
      }
    };
    const channel = supabase
      .channel(`dayly-activity-${spaceId}-${requestId.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_activity',
          filter: `workspace_id=eq.${spaceId}`,
        },
        (payload) => {
          const activity = payload.new as { revision?: number; request_id?: string };
          const known =
            activitySeen.current?.space === spaceId
              ? Math.max(seen, activitySeen.current.revision)
              : seen;
          if (activity.revision !== undefined && activity.revision <= known) return;
          if (
            activity.request_id === requestId.current &&
            activity.revision === seen + 1 &&
            !syncPending.current
          ) {
            seen = activity.revision;
            return;
          }
          syncPending.current = true;
          void synchronize();
        },
      )
      .subscribe();
    void synchronize();
    const timer = window.setInterval(() => void synchronize(), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void synchronize();
    };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase!.removeChannel(channel);
    };
  }, [session?.user.id, workspace?.id, passwordRecovery, refresh]);

  async function mutate(
    local: (state: Snapshot) => Snapshot,
    remote: (space: Workspace, user: Session) => Promise<void>,
    optimistic = false,
    requireCore = true,
  ) {
    if (
      lock.current ||
      !(requireCore ? canWrite : canDuplicate) ||
      (requireCore && !ready.current.core) ||
      activeSession.current?.user.id !== session?.user.id ||
      activeWorkspace.current?.id !== workspace?.id
    )
      throw new Error('사용 공간을 확인하고 다시 시도해 주세요.');
    lock.current = true;
    if (syncReading.current) syncPending.current = true;
    generation.current++; // Discard a background read started before this write.
    setBusy(true);
    const previous = remoteData;
    try {
      if (!session || !workspace) throw new Error('로그인하고 사용할 공간을 선택해 주세요.');
      if (optimistic) setRemoteData((state) => local(state));
      await remote(workspace, session);
      if (
        activeSession.current?.user.id !== session.user.id ||
        activeWorkspace.current?.id !== workspace.id
      )
        return;
      if (!optimistic) setRemoteData((state) => local(state));
      if (optimistic) {
        // Completion already has its canonical local state. A full reload here
        // adds a loading banner above the page and moves the cards on every check.
        if (ready.current.complete) setError('');
        setLastSaved(new Date());
      } else {
        // A failed reload must not tell the user that an already committed write failed.
        await refresh(session, workspace.id).catch(() => {});
      }
    } catch (e) {
      if (
        optimistic &&
        activeSession.current?.user.id === session?.user.id &&
        activeWorkspace.current?.id === workspace?.id
      )
        setRemoteData(previous);
      if (
        session &&
        activeSession.current?.user.id === session.user.id &&
        activeWorkspace.current?.id === workspace?.id
      )
        await refresh(session, workspace?.id, optimistic).catch(() => {});
      setError((e as Error).message);
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function insertTask(task: Task, space: Workspace, user: Session, encoded: string) {
    if (encoded.length > 10000)
      throw new Error('세부 항목의 전체 내용이 저장 용량을 초과했어요. 내용을 조금 줄여 주세요.');
    const write = async (details: { details: string; detail_items?: string[] }) =>
      await supabase!.from('tasks').insert({
        title: task.title,
        date: task.date,
        ...details,
        id: task.id,
        workspace_id: space.id,
        created_by: user.user.id,
      });
    let result = await write(
      nativeDetails.current === false
        ? { details: encoded }
        : { details: encoded, detail_items: task.details },
    );
    // Unknown-column failures happen before a write. Never retry permission
    // errors or network failures whose commit status is uncertain.
    if (
      nativeDetails.current !== true &&
      result.error &&
      ['PGRST204', '42703'].includes(result.error.code) &&
      result.error.message.includes('detail_items')
    ) {
      nativeDetails.current = false;
      result = await write({ details: encoded });
    }
    throwIf(result.error);
  }
  function requireRecords() {
    if (!ready.current.records)
      throw new Error(
        '기록과 첨부 목록을 아직 확인하지 못했어요. 공유 기록을 새로고침한 뒤 다시 시도해 주세요.',
      );
  }
  const saveTask = async (value: Task, editing: boolean, optimistic = false) => {
    const completed = new Set(data.completedTaskIds);
    const normalized = normalizeTask(value, completed.has(value.id));
    const task = { ...normalized, completed: isTaskComplete(normalized, completed) };
    const encoded = encodeTaskProgress(task, completed);
    if (encoded.length > 10000)
      throw new Error('세부 항목의 전체 내용이 저장 용량을 초과했어요. 내용을 조금 줄여 주세요.');
    return mutate(
      (state) =>
        reconcileCompletion({
          ...state,
          tasks: editing
            ? state.tasks.map((x) => (x.id === task.id ? task : x))
            : [...state.tasks, task],
        }),
      async (space, user) => {
        if (editing) {
          const result = await supabase!.rpc('update_task_content', {
            p_task_id: task.id,
            p_workspace_id: space.id,
            p_title: task.title,
            p_date: task.date,
            p_items: task.details.map((text, i) => ({ id: task.detailChecks![i].id, text })),
            p_request_id: requestId.current,
          });
          throwIf(result.error);
          return;
        }
        await insertTask(task, space, user, encoded);
      },
      optimistic,
    );
  };
  const duplicateTask = async (taskId: string, date: string) => {
    if (!validDate(date)) throw new Error('복제할 날짜를 확인해 주세요.');
    let copy: Task | undefined;
    await mutate(
      (state) => reconcileCompletion({ ...state, tasks: [...state.tasks, copy!] }),
      async (space, user) => {
        // The RPC checks confirmed membership, reads the latest active source,
        // resets progress and inserts atomically. It never needs source edit rights.
        const result = await supabase!.rpc('duplicate_task', {
          p_task_id: taskId,
          p_workspace_id: space.id,
          p_date: date,
          p_request_id: requestId.current,
        });
        if (result.error?.code === '42501')
          throw new Error(
            '이 공간의 복제 권한을 확인하지 못했어요. 공유 승인과 원본 계획을 확인하고 공유 기록을 새로고침해 주세요.',
          );
        if (result.error?.code === 'PGRST202')
          throw new Error('복제 기능의 서버 업데이트가 필요해요. 관리자에게 확인해 주세요.');
        throwIf(result.error);
        const record = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!record || record.workspace_id !== space.id || record.created_by !== user.user.id)
          throw new Error('복제 결과를 확인하지 못했어요. 공유 기록을 새로고침해 주세요.');
        copy = normalizeTask(record as TaskRecord);
      },
      false,
      false, // The RPC revalidates access even if a previous core read failed.
    );
    return copy!;
  };
  // Plans are inserted one by one in a single write, then read back once.
  const importTasks = async (plans: Task[]) => {
    const added: Task[] = [];
    await mutate(
      (state) => reconcileCompletion({ ...state, tasks: [...state.tasks, ...added] }),
      async (space, user) => {
        for (const plan of plans) {
          const task = { ...plan, workspace_id: space.id, created_by: user.user.id };
          try {
            await insertTask(task, space, user, encodeTaskProgress(task, new Set()));
          } catch (e) {
            throw new Error(
              `${added.length ? `계획 ${added.length}개는 가져왔어요. ` : ''}“${task.title}”에서 멈췄어요. ${(e as Error).message}`,
            );
          }
          added.push(task);
        }
      },
    );
    return added.length;
  };
  const checkTask = async (taskId: string, detailId: string | null) => {
    const task = data.tasks.find((task) => task.id === taskId);
    if (!task) throw new Error('할 일을 찾지 못했습니다.');
    const check = detailId ? task.detailChecks?.find((item) => item.id === detailId) : undefined;
    if (detailId && !check) throw new Error('세부 항목을 찾지 못했습니다.');
    const next = !(detailId
      ? check!.completed
      : isTaskComplete(task, new Set(data.completedTaskIds)));
    const optimisticTask = {
      ...task,
      completed: detailId ? task.completed : next,
      detailChecks: task.detailChecks?.map((item) =>
        !detailId || item.id === detailId ? { ...item, completed: next } : item,
      ),
    };
    await mutate(
      (state) =>
        reconcileCompletion({
          ...state,
          tasks: state.tasks.map((item) => (item.id === taskId ? optimisticTask : item)),
        }),
      async (space) => {
        const result = await supabase!.rpc('set_task_completion', {
          p_task_id: taskId,
          p_workspace_id: space.id,
          p_completed: next,
          p_detail_id: detailId,
          p_request_id: requestId.current,
        });
        throwIf(result.error);
        if (activeWorkspace.current?.id === space.id) {
          // Table-valued RPC responses may be wrapped in a one-row array.
          const record = Array.isArray(result.data) ? result.data[0] : result.data;
          if (!record || record.id !== taskId) throw new Error('완료 결과를 다시 확인해 주세요.');
          const canonical = normalizeTask(record as TaskRecord);
          setRemoteData((state) =>
            reconcileCompletion({
              ...state,
              tasks: state.tasks.map((item) => (item.id === taskId ? canonical : item)),
            }),
          );
        }
      },
      true,
    );
  };
  const toggleTask = (id: string) => checkTask(id, null);
  const toggleDetail = (taskId: string, detailId: string) => checkTask(taskId, detailId);
  const moveTask = async (taskId: string, targetId: string) => {
    if (!workspaces.some((space) => space.id === targetId) || targetId === workspace?.id)
      throw new Error('이동할 다른 공간을 선택해 주세요.');
    await mutate(
      (state) =>
        reconcileCompletion({
          ...state,
          tasks: state.tasks.filter((task) => task.id !== taskId),
          taskNotes: state.taskNotes?.filter((note) => note.task_id !== taskId),
          attachments: state.attachments?.filter((file) => file.task_id !== taskId),
        }),
      async (space) => {
        const result = await supabase!.rpc('move_task', {
          p_task_id: taskId,
          p_workspace_id: space.id,
          p_target_workspace_id: targetId,
          p_request_id: requestId.current,
        });
        throwIf(result.error);
      },
    );
    // Show the destination immediately, using the same progress/calendar data.
    if (activeSession.current) await refresh(activeSession.current, targetId);
  };
  const deleteTask = (id: string) =>
    mutate(
      (state) =>
        reconcileCompletion({ ...state, tasks: state.tasks.filter((task) => task.id !== id) }),
      async (space) => {
        const result = await supabase!.rpc('archive_task', {
          p_task_id: id,
          p_workspace_id: space.id,
          p_request_id: requestId.current,
        });
        throwIf(result.error);
      },
    );
  const restoreTask = (id: string) =>
    mutate(
      (state) => state,
      async (space) => {
        const result = await supabase!.rpc('restore_task', {
          p_task_id: id,
          p_workspace_id: space.id,
          p_request_id: requestId.current,
        });
        throwIf(result.error);
      },
    );
  const saveNote = (taskId: string, id: string, body: string, editing: boolean) =>
    mutate(
      (state) => state,
      async (space, user) => {
        requireRecords();
        const result = editing
          ? await supabase!
              .from('task_notes')
              .update({ body })
              .eq('id', id)
              .eq('workspace_id', space.id)
              .select('id')
              .single()
          : await supabase!.from('task_notes').insert({
              id,
              workspace_id: space.id,
              task_id: taskId,
              created_by: user.user.id,
              body,
            });
        throwIf(result.error);
      },
    );
  const deleteNote = async (_id: string): Promise<void> => {
    throw new Error('저장된 수행 기록은 삭제할 수 없어요.');
  };
  const deleteAttachment = (file: TaskAttachment) =>
    mutate(
      (state) => state,
      async (space) => {
        requireRecords();
        await requireDeletionAudit(space.id);
        // A stale pending card must never delete an already completed upload.
        const current = await supabase!
          .from('task_attachments')
          .select('*')
          .eq('id', file.id)
          .eq('workspace_id', space.id)
          .single();
        throwIf(current.error);
        if (current.data?.state !== 'pending')
          throw new Error('저장된 첨부파일은 삭제할 수 없어요.');
        await removeFileRecords(supabase!, [current.data as TaskAttachment], space.id);
      },
    );
  async function requireDeletionAudit(space: string) {
    const result = await supabase!.rpc('assert_deletion_audit', { p_workspace_id: space });
    if (result.error)
      throw new Error(
        '삭제 이력을 확인하지 못해 삭제를 중단했어요. 관리자에게 보호 기능 설정을 확인해 주세요.',
      );
  }
  const attachFile = async (taskId: string, noteId: string | null, file: File) => {
    const mime = await validateFile(file);
    await mutate(
      (state) => state,
      async (space, user) => {
        requireRecords();
        const id = crypto.randomUUID(),
          path = `${space.id}/${taskId}/${id}`;
        const inserted = await supabase!.from('task_attachments').insert({
          id,
          workspace_id: space.id,
          task_id: taskId,
          note_id: noteId,
          created_by: user.user.id,
          filename: file.name,
          mime_type: mime,
          size_bytes: file.size,
          object_path: path,
          state: 'pending',
        });
        throwIf(inserted.error);
        try {
          const upload = await supabase!.storage
            .from(FILE_BUCKET)
            .upload(path, file, { contentType: mime, upsert: false });
          throwIf(upload.error);
          const ready = await supabase!
            .from('task_attachments')
            .update({ state: 'ready' })
            .eq('id', id)
            .select('id')
            .single();
          throwIf(ready.error);
        } catch (e) {
          // A timed-out response may follow a committed ready update. Never
          // remove the original until the server confirms it is still pending.
          const current = await supabase!
            .from('task_attachments')
            .select('state')
            .eq('id', id)
            .eq('workspace_id', space.id)
            .single();
          if (!current.error && current.data?.state === 'ready') return;
          if (!current.error && current.data?.state === 'pending') {
            const cleanup = await supabase!.storage.from(FILE_BUCKET).remove([path]);
            if (!cleanup.error)
              await supabase!.from('task_attachments').delete().eq('id', id).eq('state', 'pending');
          }
          await refresh(user, space.id).catch(() => {});
          throw new Error(
            `“${file.name}”을 올리지 못했어요. 다시 시도해 주세요. ${(e as Error).message}`,
          );
        }
      },
    );
  };
  async function createWorkspace(name: string) {
    if (!supabase || !session || lock.current || passwordRecovery) return;
    setBusy(true);
    lock.current = true;
    try {
      const result = await supabase
        .from('workspaces')
        .insert({ name, owner_id: session.user.id })
        .select()
        .single();
      throwIf(result.error);
      await refresh(session, result.data.id);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function grantMember(email: string) {
    if (!workspace || !supabase || !session || !canManageMembers || !isOwner)
      throw new Error('관리자로 로그인해 주세요.');
    if (email.trim().toLowerCase() === session.user.email?.toLowerCase())
      throw new Error('본인은 이미 이 공간의 관리자입니다.');
    const result = await supabase
      .from('workspace_members')
      .insert({ workspace_id: workspace.id, email: email.trim().toLowerCase(), role: 'editor' });
    if (result.error?.code === '23505') throw new Error('이미 승인된 이메일입니다.');
    throwIf(result.error);
    await refresh(session);
  }
  const renameWorkspace = (name: string) =>
    mutate(
      (state) => state,
      async (space, user) => {
        if (space.owner_id !== user.user.id) throw new Error('내 공간의 이름만 변경할 수 있어요.');
        const result = await supabase!
          .from('workspaces')
          .update({ name: name.trim() })
          .eq('id', space.id)
          .select('id')
          .single();
        throwIf(result.error);
      },
    );
  async function revokeMember(id: string) {
    if (!supabase || !session || !workspace || !canManageMembers || !isOwner)
      throw new Error('관리자로 로그인해 주세요.');
    const result = await supabase
      .from('workspace_members')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspace.id)
      .select('id')
      .single();
    throwIf(result.error);
    await refresh(session);
  }
  return {
    data,
    session,
    workspace,
    workspaces,
    members,
    loading,
    busy,
    error,
    setError,
    notice,
    setNotice,
    isOwner,
    canWrite,
    canDuplicate,
    canManageRecords,
    canManageMembers,
    lastSaved,
    saveTask,
    duplicateTask,
    importTasks,
    toggleTask,
    toggleDetail,
    moveTask,
    deleteTask,
    restoreTask,
    saveNote,
    deleteNote,
    attachFile,
    deleteAttachment,
    passwordRecovery,
    completePasswordRecovery,
    createWorkspace,
    grantMember,
    renameWorkspace,
    revokeMember,
    refresh: () => (session ? refresh(session) : Promise.resolve()),
    selectWorkspace: (id: string) => (session ? refresh(session, id) : Promise.resolve()),
  };
}
export type Planner = ReturnType<typeof usePlanner>;
