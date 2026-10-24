import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { encodeDetailNote, readDetailNote, type Task } from './domain';
import { type Planner } from './planner';
import { validateFile } from './files';
import { FilePicker, NoteCard } from './TaskDetail';
import { updateRecordDraft, useRecordDraft } from './recordDrafts';

export default function DetailRecord({
  task,
  detailId,
  planner,
  onLogin,
  onConfirmDiscard,
}: {
  task: Task;
  detailId: string;
  planner: Planner;
  onLogin: () => void;
  /** Asks the planner's own confirmation screen before a draft is thrown away. */
  onConfirmDiscard: (discard: () => void) => void;
}) {
  const key = `${planner.session?.user.id || 'guest'}:${planner.workspace?.id || 'local'}:${task.id}:${detailId}`;
  const draft = useRecordDraft(key);
  const { body, files, working, adding, pendingId, error, message } = draft;
  const update = (patch: Parameters<typeof updateRecordDraft>[1]) => updateRecordDraft(key, patch);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const notes = (planner.data.taskNotes || [])
    .filter((note) => note.task_id === task.id && readDetailNote(note.body).detailId === detailId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  // A background permission/read check must not remove the active editor.
  const canContribute =
    Boolean(planner.session) && (planner.canManageRecords || adding) && !planner.passwordRecovery;
  const disabled = checking || working || planner.busy || !planner.canManageRecords;
  useEffect(() => {
    if (canContribute && notes.length === 0 && !adding) updateRecordDraft(key, { adding: true });
  }, [key, canContribute, notes.length, adding]);

  useEffect(() => {
    if (adding) input.current?.focus({ preventScroll: true });
  }, [adding]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => updateRecordDraft(key, { message: '' }), 3000);
    return () => window.clearTimeout(timer);
  }, [key, message]);
  useEffect(() => {
    if (!body && !files.length && !working) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [body, files.length, working]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (!body.trim() && !files.length) {
      update({ error: '짧은 글이나 파일을 남겨 주세요.' });
      return;
    }
    update({ working: true, error: '', message: '' });
    try {
      for (const file of files) await validateFile(file);
      const id = pendingId || crypto.randomUUID();
      // Keep the request identity even if the server commits but its response is lost.
      update({ pendingId: id });
      await planner.saveNote(
        task.id,
        id,
        encodeDetailNote(detailId, body.trim()),
        notes.some((note) => note.id === id),
      );
      for (let index = 0; index < files.length; index++) {
        await planner.attachFile(task.id, id, files[index]);
        update({ files: files.slice(index + 1) });
      }
      update({ pendingId: null, body: '', files: [], adding: false, message: '저장됨' });
    } catch (cause) {
      update({
        error:
          (cause as Error).message ||
          '기록을 저장하지 못했어요. 아래 저장 버튼으로 다시 시도해 주세요.',
      });
    } finally {
      update({ working: false });
    }
  }
  return (
    <div className="detail-record-panel">
      {!planner.canManageRecords && planner.session && (
        <p className="card-footnote">
          기록과 첨부를 불러오지 못했어요. 공유 기록을 새로고침해 주세요.
        </p>
      )}
      {notes.length > 0 ? (
        <div className="detail-record-notes">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              planner={planner}
              taskAuthor={task.created_by}
              disabled={disabled}
            />
          ))}
        </div>
      ) : (
        <p className="detail-record-empty">아직 남긴 기록이 없어요.</p>
      )}
      {!planner.session && (
        <div className="record-login">
          <p>로그인하면 공부 기록을 남길 수 있어요.</p>
          <Button variant="secondary" size="sm" onClick={onLogin}>
            로그인
          </Button>
        </div>
      )}
      {canContribute && !adding && (
        <Button
          variant="ghost"
          size="sm"
          className="detail-record-add"
          onClick={() => update({ adding: true, message: '' })}
        >
          <Plus size={14} />
          기록 작성
        </Button>
      )}
      {canContribute && adding && (
        <form onSubmit={(event) => void submit(event)} className="detail-record-form">
          <textarea
            ref={input}
            aria-label={`${task.title} ${task.details[task.detailChecks?.findIndex((check) => check.id === detailId) ?? -1]} 수행 내용`}
            placeholder="오늘 어떻게 공부했나요?"
            rows={3}
            maxLength={9000}
            value={body}
            onChange={(event) => update({ body: event.target.value })}
            disabled={disabled}
          />
          <p className="card-footnote">
            접기, 날짜, 공간 이동 후에도 초안을 유지해요. 글은 이 탭에서 복원되며, 선택 파일은
            새로고침하면 다시 첨부해야 해요.
          </p>
          <FilePicker
            files={files}
            setFiles={(next) => update({ files: next })}
            disabled={disabled}
            onChecking={setChecking}
            label="수행 파일 첨부"
          />
          <div className="detail-record-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                const discard = () =>
                  update({ body: '', files: [], pendingId: null, adding: false, error: '' });
                if (body || files.length) onConfirmDiscard(discard);
                else discard();
              }}
            >
              취소
            </Button>
            <Button
              variant="default"
              size="sm"
              className="detail-record-save"
              disabled={disabled}
              type="submit"
            >
              <Check size={14} />
              {working ? '저장 중…' : error ? '다시 저장' : '기록 저장'}
            </Button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {message && (
        <p className="detail-record-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
