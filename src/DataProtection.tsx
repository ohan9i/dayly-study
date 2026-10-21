import { Button } from '@/components/ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase, type Planner } from './planner';

type DeletedPlan = { id: string; title: string; date: string; deleted_at: string };
type Deletion = {
  id: string;
  entity_type: 'task' | 'note' | 'attachment';
  task_title: string;
  deleted_at: string;
  deleted_by: string | null;
  actor_role: string;
};
const format = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export default function DataProtection({
  planner,
  onOpenHistory,
}: {
  planner: Planner;
  onOpenHistory: () => void;
}) {
  const [trash, setTrash] = useState<DeletedPlan[]>([]);
  const [restoring, setRestoring] = useState('');
  const [events, setEvents] = useState<Deletion[]>([]);
  const [retained, setRetained] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const space = planner.workspace?.id;
  const user = planner.session?.user.id;
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!supabase || !space || !user) return;
    const token = ++generation.current;
    setLoading(true);
    setRetained(false);
    setTrash([]);
    try {
      const [history, status, retention, deleted] = await Promise.all([
        supabase
          .from('task_deletion_history')
          .select('id,entity_type,task_title,deleted_at,deleted_by,actor_role')
          .eq('workspace_id', space)
          .order('deleted_at', { ascending: false })
          .limit(50),
        supabase.rpc('get_workspace_backup_status', { p_workspace_id: space }),
        supabase.rpc('get_planner_retention_status', { p_workspace_id: space }),
        supabase.rpc('get_deleted_tasks', { p_workspace_id: space }),
      ]);
      if (token !== generation.current) return;
      setRetained(
        !retention.error && retention.data?.version === 2 && retention.data?.enabled === true,
      );
      if (history.error || status.error || deleted.error) {
        setError('보호 기능 정보를 불러오지 못했어요. 관리자에게 서버 설정을 확인해 주세요.');
      } else {
        setEvents(history.data as Deletion[]);
        setTrash((deleted.data || []) as DeletedPlan[]);
        setCompletedAt(status.data?.last_completed_at || null);
        setError('');
      }
    } catch {
      if (token === generation.current)
        setError('보호 기능 정보를 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
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
  async function download(event: Deletion) {
    if (!supabase || !space) return;
    setDownloading(event.id);
    try {
      const result = await supabase
        .from('task_deletion_history')
        .select('*')
        .eq('workspace_id', space)
        .eq('id', event.id)
        .single();
      if (result.error) throw result.error;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `dayly-deletion-${event.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('삭제 이력을 내려받지 못했어요. 접근 권한을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setDownloading('');
    }
  }
  const stale = completedAt && Date.now() - new Date(completedAt).getTime() > 26 * 60 * 60 * 1000;
  return (
    <section className="glass-card settings-card data-protection">
      <h2>
        <ShieldCheck size={19} />
        기록 보호
      </h2>
      <p
        className={
          loading || retained
            ? 'retention-status setting-description'
            : 'retention-status form-error'
        }
        role="status"
      >
        {loading
          ? '서버 보존 보호 확인 중…'
          : retained
            ? '복구 보호 적용됨: 승인된 참여자는 계획을 삭제하거나 이동할 수 있고, 삭제한 계획은 휴지통에서 복원할 수 있습니다.'
            : '서버 보존 보호를 확인하지 못했어요. 서버 설정 적용 또는 연결 확인이 필요합니다.'}
      </p>
      <p className="setting-description">
        정기 백업은 매일 새벽 3시경 실행하며, 암호화된 파일을 30일 보관합니다.
      </p>
      <p className="backup-status">
        {completedAt
          ? `마지막 백업 성공: ${format(completedAt)}`
          : '아직 성공한 정기 백업이 확인되지 않았어요.'}
      </p>
      {stale && (
        <p className="form-error">
          최근 백업이 오래됐어요. 관리자에게 백업 실행 상태를 확인해 주세요.
        </p>
      )}
      <Button
        variant="secondary"
        size="default"
        className="soft-button"
        disabled={loading}
        onClick={() => void refresh()}
      >
        <RefreshCw size={16} />
        {loading ? '확인 중…' : '보호 상태 새로고침'}
      </Button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="protection-section">
        <h3>휴지통, 삭제한 계획 복원</h3>
        <p className="card-footnote">
          계획을 삭제해도 기록과 첨부 원본을 보관합니다. 원래 공간과 날짜로 복원할 수 있어요.
        </p>
        {!loading && !error && trash.length === 0 && (
          <p className="setting-description">휴지통이 비어 있어요.</p>
        )}
        <ul className="deletion-list trash-list">
          {trash.map((plan) => (
            <li key={plan.id}>
              <div>
                <strong>{plan.title}</strong>
                <small>
                  계획 날짜: {plan.date}, 삭제: {format(plan.deleted_at)}
                </small>
              </div>
              <Button
                variant="secondary"
                size="default"
                className="soft-button"
                disabled={Boolean(restoring) || planner.busy}
                aria-label={`${plan.title} 복원`}
                onClick={async () => {
                  setRestoring(plan.id);
                  setError('');
                  try {
                    await planner.restoreTask(plan.id);
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setRestoring('');
                  }
                }}
              >
                {restoring === plan.id ? '복원 중…' : '복원'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div className="protection-section">
        <h3>계획 변경 이력</h3>
        <p className="card-footnote">계획의 생성과 수정, 이동 내역을 필요할 때 확인하세요.</p>
        <Button
          variant="secondary"
          size="default"
          className="soft-button"
          aria-haspopup="dialog"
          onClick={onOpenHistory}
        >
          <History size={16} />
          계획 변경 이력 보기
        </Button>
      </div>
      <div className="protection-section">
        <h3>삭제 이력, 백업 내려받기</h3>
        <p className="card-footnote">
          현재 공간에서 열람할 수 있는 최근 삭제 50건입니다. 새 삭제는 휴지통에 보관합니다. 이전
          버전에서 이미 삭제된 파일 원본은 삭제 전 백업이 필요합니다.
        </p>
        {!loading && !error && events.length === 0 && (
          <p className="setting-description">보호 기능 적용 후 기록된 삭제 이력이 없어요.</p>
        )}
        <ul className="deletion-list">
          {events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{event.task_title}</strong>
                <small>
                  {{ task: '계획', note: '수행 기록', attachment: '첨부' }[event.entity_type]},{' '}
                  {format(event.deleted_at)}
                </small>
                <small title={event.deleted_by || event.actor_role}>
                  삭제:{' '}
                  {event.deleted_by === user
                    ? '나'
                    : event.deleted_by === planner.workspace?.owner_id
                      ? '공간 관리자'
                      : event.deleted_by
                        ? '다른 참여자'
                        : '서버 관리 작업'}
                </small>
              </div>
              <Button
                variant="secondary"
                size="default"
                className="soft-button"
                aria-label={`${event.task_title} 삭제 이력 내려받기`}
                disabled={Boolean(downloading)}
                onClick={() => void download(event)}
              >
                <Download size={15} />
                {downloading === event.id ? '내려받는 중…' : '이력 내려받기'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
