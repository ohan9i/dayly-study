import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase, type Planner } from './planner';

type Change = {
  id: string;
  operation: string;
  changed_at: string;
  changed_by: string | null;
  target_workspace_id: string | null;
  before_record: { date?: string } | null;
  after_record: { title: string; date: string };
};
const format = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export default function TaskHistory({ planner }: { planner: Planner }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const space = planner.workspace?.id,
    user = planner.session?.user.id;
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    if (!supabase || !space || !user) {
      setLoading(false);
      setError('로그인과 사용 공간을 확인해 주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await supabase
        .from('task_change_history')
        .select('id,operation,changed_at,changed_by,target_workspace_id,before_record,after_record')
        .or(`workspace_id.eq.${space},target_workspace_id.eq.${space}`)
        .order('changed_at', { ascending: false })
        .limit(50);
      if (token !== generation.current) return;
      if (result.error) throw result.error;
      setChanges((result.data || []) as Change[]);
    } catch {
      if (token === generation.current) {
        setChanges([]);
        setError(
          '변경 이력을 불러오지 못했어요. 접근 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.',
        );
      }
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [space, user]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return (
    <section className="task-history" aria-label="계획 변경 내역">
      <p className="card-footnote">
        생성·수정·삭제·복원·공간 이동·날짜 변경을 확인할 수 있어요. 기록 기능 적용 전의 변경은
        표시되지 않습니다.
      </p>
      <button className="soft-button" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw size={16} />
        이력 새로고침
      </button>
      {loading && (
        <p role="status" className="setting-description">
          변경 이력을 불러오는 중이에요.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && !error && changes.length === 0 && (
        <p className="setting-description">아직 기록된 계획 변경이 없어요.</p>
      )}
      <ul className="deletion-list change-list">
        {changes.map((change) => (
          <li key={change.id}>
            <div>
              <strong>{change.after_record.title}</strong>
              <small>
                {(
                  {
                    create: '생성',
                    archive: '휴지통으로 삭제',
                    restore: '복원',
                    move: '공간 이동',
                    date_change: '날짜 변경',
                    update: '수정',
                  } as Record<string, string>
                )[change.operation] || change.operation}{' '}
                · {format(change.changed_at)}
              </small>
              <small>
                처리 계정:{' '}
                {change.changed_by === user
                  ? '나'
                  : change.changed_by
                    ? '다른 참여자'
                    : '서버 관리 작업'}
              </small>
              {change.operation === 'date_change' && (
                <small>
                  {change.before_record?.date} → {change.after_record.date}
                </small>
              )}
              {change.operation === 'move' && (
                <small>
                  이동 대상:{' '}
                  {planner.workspaces.find((w) => w.id === change.target_workspace_id)?.name ||
                    '현재 접근할 수 없는 공간'}
                </small>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
