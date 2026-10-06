import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Download,
  FileText,
  Image,
  LockKeyhole,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  encodeDetailNote,
  readDetailNote,
  type Task,
  type TaskAttachment,
  type TaskNote,
} from './domain';
import DetailItemsEditor from './DetailItemsEditor';
import { supabase, type Planner } from './planner';
import { FILE_ACCEPT, FILE_BUCKET, MAX_QUEUED_FILES, fileSize, validateFile } from './files';

export function FilePicker({
  files,
  setFiles,
  disabled,
  onChecking,
  label = '파일 첨부',
}: {
  files: File[];
  setFiles: (files: File[]) => void;
  disabled: boolean;
  label?: string;
  onChecking: (checking: boolean) => void;
}) {
  const id = useId(),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(false);
  return (
    <div className="file-picker">
      <div className="attachment-toolbar">
        <label className={`attachment-add ${disabled || checking ? 'disabled' : ''}`} htmlFor={id}>
          <Paperclip size={17} />
          {checking ? '파일 확인 중…' : label}
        </label>
        <input
          id={id}
          className="sr-only"
          type="file"
          aria-label={label}
          accept={FILE_ACCEPT}
          multiple
          disabled={disabled || checking}
          onChange={async (e) => {
            const selected = Array.from(e.target.files || []);
            e.target.value = '';
            setError('');
            if (files.length + selected.length > MAX_QUEUED_FILES) {
              setError('한 번에 5개까지 선택해 주세요.');
              return;
            }
            setChecking(true);
            onChecking(true);
            try {
              for (const f of selected) await validateFile(f);
              setFiles([...files, ...selected]);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setChecking(false);
              onChecking(false);
            }
          }}
        />
        <span>PDF와 사진, 파일당 10MB</span>
      </div>
      {files.length > 0 && (
        <ul className="file-queue">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              <Paperclip size={15} />
              <span title={file.name}>
                {file.name}
                <small>{fileSize(file.size)} / 저장할 때 업로드</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`${file.name} 선택 취소`}
                disabled={disabled}
                onClick={() => setFiles(files.filter((_, index) => index !== i))}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Preview({
  file,
  url,
  onClose,
}: {
  file: TaskAttachment;
  url: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="file-preview"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="file-preview-heading">
        <h2 id={id}>{file.filename}</h2>
        <button className="icon-button" aria-label="파일 미리보기 닫기" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {file.mime_type === 'application/pdf' ? (
        <iframe src={url} title={`${file.filename} PDF 미리보기`} />
      ) : (
        <img src={url} alt={file.filename} />
      )}
      <p>미리보기가 표시되지 않으면 파일 카드의 내려받기를 이용해 주세요.</p>
    </dialog>
  );
}

function FileCard({
  file,
  planner,
  taskAuthor,
  disabled,
}: {
  file: TaskAttachment;
  planner: Planner;
  taskAuthor: string;
  disabled: boolean;
}) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false),
    [working, setWorking] = useState(false);
  const image = file.mime_type.startsWith('image/');
  const canDelete =
    planner.canWrite &&
    (planner.isOwner ||
      file.created_by === planner.session?.user.id ||
      taskAuthor === planner.session?.user.id);
  useEffect(() => {
    if (!supabase || file.state !== 'ready' || !image) return;
    let active = true;
    const load = async () => {
      const result = await supabase!.storage
        .from(FILE_BUCKET)
        .createSignedUrl(file.object_path, 120);
      if (active && !result.error) setUrl(result.data.signedUrl);
    };
    void load();
    const timer = window.setInterval(() => void load(), 100000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [file.object_path, file.state, image]);
  async function action(run: () => Promise<void>) {
    setWorking(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className={`attachment-card ${file.state === 'pending' ? 'pending' : ''}`}>
      <button
        type="button"
        className="attachment-thumbnail"
        aria-label={`${file.filename} 보기`}
        disabled={working || file.state !== 'ready'}
        onClick={() =>
          void action(async () => {
            const result = await supabase!.storage
              .from(FILE_BUCKET)
              .createSignedUrl(file.object_path, 120);
            if (result.error) throw result.error;
            setUrl(result.data.signedUrl);
            setPreview(true);
          })
        }
      >
        {image && url ? (
          <img src={url} alt="" loading="lazy" />
        ) : image ? (
          <Image size={23} />
        ) : (
          <FileText size={23} />
        )}
      </button>
      <div className="attachment-info">
        <strong title={file.filename}>{file.filename}</strong>
        <small>
          {fileSize(file.size_bytes)}
          {file.state === 'pending' ? ' / 업로드 미완료' : image ? ' / 사진' : ' / PDF'}
        </small>
        {file.state === 'pending' && <small>삭제한 뒤 다시 첨부해 주세요.</small>}
      </div>
      <div className="attachment-actions">
        {file.state === 'ready' && (
          <button
            type="button"
            className="icon-button"
            aria-label={`${file.filename} 내려받기`}
            disabled={working}
            onClick={() =>
              void action(async () => {
                const result = await supabase!.storage.from(FILE_BUCKET).download(file.object_path);
                if (result.error) throw result.error;
                const blobUrl = URL.createObjectURL(result.data),
                  anchor = document.createElement('a');
                anchor.href = blobUrl;
                anchor.download = file.filename;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
              })
            }
          >
            <Download size={17} />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="icon-button"
            aria-label={`${file.filename} 삭제`}
            disabled={working || disabled}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="inline-confirm">
          <span>이 파일을 삭제할까요?</span>
          <button
            type="button"
            disabled={working || disabled}
            onClick={() =>
              void action(async () => {
                await planner.deleteAttachment(file);
                setConfirmDelete(false);
              })
            }
          >
            삭제
          </button>
          <button type="button" disabled={working} onClick={() => setConfirmDelete(false)}>
            취소
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && <Preview file={file} url={url} onClose={() => setPreview(false)} />}
    </div>
  );
}

function FileList({
  files,
  planner,
  taskAuthor,
  disabled,
}: {
  files: TaskAttachment[];
  planner: Planner;
  taskAuthor: string;
  disabled: boolean;
}) {
  return files.length ? (
    <div className="attachment-list">
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          planner={planner}
          taskAuthor={taskAuthor}
          disabled={disabled}
        />
      ))}
    </div>
  ) : null;
}

export function NoteCard({
  note,
  planner,
  taskAuthor,
  disabled,
}: {
  note: TaskNote;
  planner: Planner;
  taskAuthor: string;
  disabled: boolean;
}) {
  const content = readDetailNote(note.body);
  const [editing, setEditing] = useState(false),
    [body, setBody] = useState(content.body),
    [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const canEdit =
    planner.canWrite && (planner.isOwner || note.created_by === planner.session?.user.id);
  const files = (planner.data.attachments || []).filter((file) => file.note_id === note.id);
  const author =
    note.created_by === planner.session?.user.id
      ? '나'
      : note.created_by === planner.workspace?.owner_id
        ? '공간 관리자'
        : '함께 쓰는 사람';
  const timestamp = new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(new Date(note.created_at));
  async function action(run: () => Promise<void>) {
    setError('');
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <article className="task-note">
      <div className="note-heading">
        <span>
          <UserMark /> <strong>{author}</strong>
          <time>{timestamp}</time>
        </span>
        {canEdit && (
          <div>
            <button
              type="button"
              className="icon-button"
              aria-label="수행 내용 수정"
              disabled={disabled}
              onClick={() => {
                setBody(content.body);
                setEditing(true);
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="수행 내용 삭제"
              disabled={disabled}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <form
          className="note-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              if (!body.trim() && !files.length)
                throw new Error('수행 내용이나 파일을 남겨 주세요.');
              await planner.saveNote(
                note.task_id,
                note.id,
                content.detailId ? encodeDetailNote(content.detailId, body.trim()) : body.trim(),
                true,
              );
              setEditing(false);
            });
          }}
        >
          <textarea
            aria-label="수행 내용 수정 글"
            rows={3}
            maxLength={content.detailId ? 9000 : 10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={disabled}
          />
          <div className="note-edit-actions">
            <button
              className="text-button"
              type="button"
              disabled={disabled}
              onClick={() => setEditing(false)}
            >
              취소
            </button>
            <button className="soft-button" disabled={disabled}>
              수정 저장
            </button>
          </div>
        </form>
      ) : (
        <>
          {content.body && (
            <p className={`note-body ${expanded ? 'expanded' : ''}`}>{content.body}</p>
          )}
          {content.body.length > 180 && (
            <button
              type="button"
              className="text-button note-expand"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '접기' : '더 보기'}
            </button>
          )}
        </>
      )}
      <FileList files={files} planner={planner} taskAuthor={taskAuthor} disabled={disabled} />
      {!content.body && !files.length && (
        <p className="card-footnote">첨부가 완료되지 않은 수행 내용이에요.</p>
      )}
      {confirmDelete && (
        <div className="inline-confirm">
          <span>수행 내용과 첨부 파일을 삭제할까요?</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void action(() => planner.deleteNote(note.id))}
          >
            삭제
          </button>
          <button type="button" disabled={disabled} onClick={() => setConfirmDelete(false)}>
            취소
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
function UserMark() {
  return <span className="note-author-mark" aria-hidden="true" />;
}

export default function TaskDetail({
  item,
  date,
  planner,
  editable,
  onDone,
  onDelete,
  onLogin,
  onBusyChange,
  onMoved,
}: {
  item?: Task;
  date: string;
  planner: Planner;
  editable: boolean;
  onDone: () => void;
  onDelete?: () => void;
  onLogin?: () => void;
  onBusyChange: (busy: boolean) => void;
  onMoved: (name: string) => void;
}) {
  const id = useRef(item?.id || crypto.randomUUID()),
    persisted = useRef(Boolean(item));
  const [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [checking, setChecking] = useState(false);
  const [moving, setMoving] = useState(false),
    [dirty, setDirty] = useState(false);
  const targets = planner.workspaces
    .filter((space) => space.id !== planner.workspace?.id)
    .sort(
      (a, b) =>
        Number(b.owner_id === planner.session?.user.id) -
        Number(a.owner_id === planner.session?.user.id),
    );
  const [targetId, setTargetId] = useState(targets[0]?.id || '');
  useEffect(() => {
    setTargetId((current) =>
      targets.some((space) => space.id === current) ? current : targets[0]?.id || '',
    );
  }, [planner.workspaces, planner.workspace?.id, planner.session?.user.id]);
  const liveItem = item && planner.data.tasks.find((task) => task.id === item.id);
  const unavailable = Boolean(
    item && (!liveItem || liveItem.workspace_id !== planner.workspace?.id),
  );
  useEffect(() => {
    onBusyChange(working || checking);
  }, [working, checking, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const userId = planner.session?.user.id || 'local',
    taskAuthor = item?.created_by || userId;
  const canContribute = Boolean(planner.session && planner.workspace) && !planner.passwordRecovery;
  const disabled = working || planner.busy || checking || !planner.canWrite || unavailable;
  const attached = (planner.data.attachments || []).filter(
    (file) => file.task_id === id.current && !file.note_id,
  );
  async function upload(queue: File[], update: (files: File[]) => void) {
    for (let i = 0; i < queue.length; i++) {
      setProgress(`파일 ${i + 1}/${queue.length} 올리는 중…`);
      await planner.attachFile(id.current, null, queue[i]);
      update(queue.slice(i + 1));
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const values = new FormData(e.currentTarget);
    const detailIds = values.getAll('detailId').map(String);
    const detailDone = values.getAll('detailComplete').map(String);
    const items = values
      .getAll('detailItem')
      .map((value, index) => ({
        text: String(value).trim(),
        id: detailIds[index],
        completed: detailDone[index] === 'true',
      }))
      .filter((item) => item.text);
    const title = editable ? String(values.get('title') || '').trim() : item?.title || '';
    if (!title) {
      setError('할 일을 적어 주세요.');
      return;
    }
    setWorking(true);
    try {
      for (const file of files) await validateFile(file);
      if (editable) {
        setProgress('할 일 저장 중…');
        await planner.saveTask(
          {
            ...item,
            id: id.current,
            title,
            date: String(values.get('date')),
            details: items.map((item) => item.text),
            detailChecks: items.map(({ id, completed }) => ({ id, completed })),
            completed: planner.data.completedTaskIds.includes(id.current),
            created_by: taskAuthor,
          },
          persisted.current,
        );
        persisted.current = true;
      }
      await upload(files, setFiles);
      onDone();
    } catch (e) {
      setError(`${persisted.current ? '할 일은 저장되어 있어요. ' : ''}${(e as Error).message}`);
    } finally {
      setWorking(false);
      setProgress('');
    }
  }
  return (
    <div className="task-detail">
      {unavailable && (
        <p className="form-error" role="alert">
          이 항목이 이동되거나 삭제되었습니다. 창을 닫고 현재 공간을 확인해 주세요.
        </p>
      )}
      <form onSubmit={submit} className="editor-form" onChange={() => setDirty(true)}>
        <fieldset disabled={disabled}>
          <label className="field">
            <span>할 일</span>
            <input
              name="title"
              required
              maxLength={150}
              defaultValue={item?.title}
              placeholder="예: 구조 역학 3장 연습문제 풀기"
              autoFocus
              readOnly={!editable}
            />
          </label>
          <label className="field">
            <span>날짜</span>
            <input
              name="date"
              type="date"
              required
              defaultValue={item?.date || date}
              readOnly={!editable}
            />
          </label>
          <DetailItemsEditor
            initialItems={item?.details || []}
            initialChecks={item?.detailChecks}
            editable={editable}
            canCheck={planner.canWrite && !disabled}
            onCheckError={setError}
            onToggle={async (detailId) => {
              const stored = planner.data.tasks.find((task) => task.id === id.current);
              if (stored?.detailChecks?.some((check) => check.id === detailId))
                await planner.toggleDetail(id.current, detailId);
              else if (item) throw new Error('새 세부 항목은 먼저 저장한 뒤 완료 체크해 주세요.');
            }}
          />
        </fieldset>
        <FileList files={attached} planner={planner} taskAuthor={taskAuthor} disabled={disabled} />
        {canContribute && (
          <FilePicker
            files={files}
            setFiles={setFiles}
            disabled={disabled}
            onChecking={setChecking}
          />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {editable || (canContribute && files.length > 0) ? (
          <div className="form-actions">
            {onDelete && (
              <button
                className="icon-button delete-button"
                type="button"
                aria-label="이 할 일 삭제"
                onClick={onDelete}
                disabled={disabled}
              >
                <Trash2 size={19} />
              </button>
            )}
            <button className="primary-button" disabled={disabled} type="submit">
              <Check size={17} />
              {disabled ? progress || '저장 중…' : editable ? '할 일 저장' : '파일 올리기'}
            </button>
          </div>
        ) : onLogin ? (
          <button className="soft-button full-width" type="button" onClick={onLogin}>
            <LockKeyhole size={17} />
            로그인하고 편집하기
          </button>
        ) : (
          <p className="card-footnote">
            제목과 세부 항목은 이 할 일의 작성자와 관리자만 수정할 수 있어요.
          </p>
        )}
      </form>
      {item && editable && targets.length > 0 && (
        <div className="task-move">
          {!moving ? (
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => setMoving(true)}
            >
              다른 플래너로 이동
            </button>
          ) : (
            <div className="task-move-picker" role="group" aria-label="다른 플래너로 이동">
              <label className="field">
                <span>이동할 공간</span>
                <select
                  aria-label="이동할 공간"
                  value={targetId}
                  disabled={disabled}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  {targets.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.owner_id === planner.session?.user.id
                        ? `내 플래너 · ${space.name}`
                        : space.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="card-footnote">
                날짜와 기록·첨부를 유지하고 선택한 공간으로 이동합니다.
              </p>
              {(dirty || files.length > 0) && (
                <p className="card-footnote">
                  작성 중인 내용과 첨부를 먼저 저장한 뒤 이동해 주세요.
                </p>
              )}
              <div className="note-edit-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => setMoving(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="soft-button"
                  disabled={
                    disabled ||
                    dirty ||
                    files.length > 0 ||
                    !targets.some((space) => space.id === targetId)
                  }
                  onClick={async () => {
                    setWorking(true);
                    setError('');
                    try {
                      const target = targets.find((space) => space.id === targetId)!;
                      await planner.moveTask(item.id, target.id);
                      onMoved(
                        target.owner_id === planner.session?.user.id ? '내 플래너' : target.name,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setWorking(false);
                    }
                  }}
                >
                  이동
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
