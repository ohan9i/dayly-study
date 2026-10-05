import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { encodeDetailNote, readDetailNote, type Task } from './domain';
import { type Planner } from './planner';
import { validateFile } from './files';
import { FilePicker, NoteCard } from './TaskDetail';

export default function DetailRecord({
  task,
  detailId,
  planner,
}: {
  task: Task;
  detailId: string;
  planner: Planner;
}) {
  const notes = (planner.data.taskNotes || [])
    .filter((note) => note.task_id === task.id && readDetailNote(note.body).detailId === detailId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const pendingId = useRef<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const canContribute = planner.canWrite && !planner.passwordRecovery;
  const disabled = checking || working || planner.busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() && !files.length) {
      setError('짧은 글이나 파일을 남겨 주세요.');
      return;
    }
    setWorking(true);
    setAdding(true);
    setError('');
    setMessage('');
    try {
      for (const file of files) await validateFile(file);
      const id = pendingId.current || crypto.randomUUID();
      await planner.saveNote(
        task.id,
        id,
        encodeDetailNote(detailId, body.trim()),
        Boolean(pendingId.current),
      );
      pendingId.current = id;
      for (const file of files) {
        await planner.attachFile(task.id, id, file);
        setFiles((queue) => queue.slice(1));
      }
      pendingId.current = null;
      setBody('');
      setFiles([]);
      setAdding(false);
      setMessage('기록을 저장했어요.');
    } catch (cause) {
      setError((cause as Error).message || '기록을 저장하지 못했어요.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="detail-record-panel">
      {notes.length > 0 && (
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
      )}
      {canContribute && notes.length > 0 && !adding && (
        <button
          type="button"
          className="detail-record-add"
          onClick={() => {
            setAdding(true);
            setMessage('');
          }}
        >
          기록 더하기
        </button>
      )}
      {canContribute && (notes.length === 0 || adding) ? (
        <form onSubmit={(event) => void submit(event)} className="detail-record-form">
          <textarea
            aria-label={`${task.title} ${task.details[task.detailChecks?.findIndex((check) => check.id === detailId) ?? -1]} 수행 내용`}
            placeholder="오늘 어떻게 공부했나요?"
            rows={notes.length ? 2 : 3}
            maxLength={9000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={disabled}
          />
          <div className="detail-record-actions">
            <FilePicker
              files={files}
              setFiles={setFiles}
              disabled={disabled}
              onChecking={setChecking}
              label="수행 파일 첨부"
            />
            <button className="detail-record-save" disabled={disabled} type="submit">
              <Check size={14} />
              기록 저장
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : notes.length === 0 ? (
        <p className="detail-record-empty">아직 남긴 기록이 없어요.</p>
      ) : null}
      {message && (
        <p className="detail-record-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
