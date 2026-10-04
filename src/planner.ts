import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import {
  emptySnapshot,
  readLocal,
  type Snapshot,
  type Task,
  type Workspace,
  type Member,
} from './domain';

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
const throwIf = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
async function readAllRows<T>(table: string, space: string, columns = '*'): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await supabase!
      .from(table)
      .select(columns)
      .eq('workspace_id', space)
      .order(table === 'task_completions' ? 'task_id' : 'id')
      .range(start, start + 499);
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
  const data = session ? remoteData : localData;
  const isOwner = !session || workspace?.owner_id === session.user.id;
  const canWrite = !loading && Boolean(session && workspace) && !passwordRecovery;

  const refresh = useCallback(async (user: Session, preferredId?: string) => {
    if (!supabase) return;
    const token = ++generation.current;
    setLoading(true);
    try {
      const result = await supabase
        .from('workspaces')
        .select('id,name,owner_id')
        .order('created_at');
      throwIf(result.error);
      const list = (result.data || []) as Workspace[];
      const selected =
        list.find((x) => x.id === (preferredId || activeWorkspace.current?.id)) || list[0] || null;
      let next = emptySnapshot(),
        nextMembers: Member[] = [];
      if (selected) {
        const [tasks, checks, granted] = await Promise.all([
          readAllRows<Task>('tasks', selected.id),
          readAllRows<{ task_id: string }>('task_completions', selected.id, 'task_id'),
          selected.owner_id === user.user.id
            ? readAllRows<Member>('workspace_members', selected.id)
            : Promise.resolve([] as Member[]),
        ]);
        next = {
          version: 1,
          tasks,
          logs: [],
          completedTaskIds: checks.map((x) => x.task_id),
          hasSamples: false,
        };
        nextMembers = granted;
      }
      if (token !== generation.current || activeSession.current?.user.id !== user.user.id) return;
      setWorkspaces(list);
      setWorkspace(selected);
      activeWorkspace.current = selected;
      setRemoteData(next);
      setMembers(nextMembers);
      setError('');
      setLastSaved(new Date());
    } catch (e) {
      if (token === generation.current)
        setError(`공유 기록을 불러오지 못했습니다. ${(e as Error).message}`);
      throw e;
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const update = (next: Session | null) => {
      if (!alive) return;
      if (next?.user.id !== activeSession.current?.user.id) {
        setRemoteData(emptySnapshot());
        setWorkspace(null);
        activeWorkspace.current = null;
        setMembers([]);
      }
      activeSession.current = next;
      setSession(next);
      if (next) {
        void refresh(next).catch(() => {});
      } else {
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
    if (!session) return;
    const onFocus = () => {
      if (!lock.current && activeSession.current)
        void refresh(activeSession.current).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, refresh]);

  async function mutate(
    local: (state: Snapshot) => Snapshot,
    remote: (space: Workspace, user: Session) => Promise<void>,
  ) {
    if (lock.current || !canWrite) throw new Error('잠시 후 다시 시도해 주세요.');
    lock.current = true;
    setBusy(true);
    try {
      if (!session || !workspace) throw new Error('로그인하고 사용할 공간을 선택해 주세요.');
      await remote(workspace, session);
      setRemoteData((state) => local(state));
      // A failed reload must not tell the user that an already committed write failed.
      await refresh(session, workspace.id).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const saveTask = (task: Task, editing: boolean) =>
    mutate(
      (state) => ({
        ...state,
        tasks: editing
          ? state.tasks.map((x) => (x.id === task.id ? task : x))
          : [...state.tasks, task],
      }),
      async (space, user) => {
        const fields = {
          title: task.title,
          subject: task.subject,
          date: task.date,
          time: task.time,
          details: task.details,
        };
        const result = editing
          ? await supabase!
              .from('tasks')
              .update(fields)
              .eq('id', task.id)
              .eq('workspace_id', space.id)
              .select('id')
              .single()
          : await supabase!
              .from('tasks')
              .insert({ ...fields, id: task.id, workspace_id: space.id, created_by: user.user.id });
        throwIf(result.error);
      },
    );
  const toggleTask = (id: string) =>
    mutate(
      (state) => ({
        ...state,
        completedTaskIds: state.completedTaskIds.includes(id)
          ? state.completedTaskIds.filter((x) => x !== id)
          : [...state.completedTaskIds, id],
      }),
      async (space, user) => {
        const result = data.completedTaskIds.includes(id)
          ? await supabase!
              .from('task_completions')
              .delete()
              .eq('task_id', id)
              .eq('workspace_id', space.id)
              .select('task_id')
              .single()
          : await supabase!
              .from('task_completions')
              .insert({ task_id: id, workspace_id: space.id, completed_by: user.user.id });
        throwIf(result.error);
      },
    );
  const deleteTask = (id: string) =>
    mutate(
      (state) => ({
        ...state,
        tasks: state.tasks.filter((x) => x.id !== id),
        completedTaskIds: state.completedTaskIds.filter((x) => x !== id),
      }),
      async (space) => {
        const result = await supabase!
          .from('tasks')
          .delete()
          .eq('id', id)
          .eq('workspace_id', space.id)
          .select('id')
          .single();
        throwIf(result.error);
      },
    );
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
    if (!workspace || !supabase || !session || !canWrite || !isOwner)
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
  async function revokeMember(id: string) {
    if (!supabase || !session || !workspace || !canWrite || !isOwner)
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
    isOwner,
    canWrite,
    lastSaved,
    saveTask,
    toggleTask,
    deleteTask,
    passwordRecovery,
    completePasswordRecovery,
    createWorkspace,
    grantMember,
    revokeMember,
    refresh: () => (session ? refresh(session) : Promise.resolve()),
    selectWorkspace: (id: string) => (session ? refresh(session, id) : Promise.resolve()),
  };
}
