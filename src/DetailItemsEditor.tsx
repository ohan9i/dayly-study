import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { progressPercent, type DetailCheck } from './domain';
import { TaskProgress } from './TaskProgress';

type Row = { id: string; text: string; completed: boolean };
const makeRow = (text = ''): Row => ({ id: crypto.randomUUID(), text, completed: false });

export default function DetailItemsEditor({
  initialItems,
  initialChecks,
  editable,
  canCheck,
  onToggle,
  onCheckError,
}: {
  initialItems: string[];
  initialChecks?: DetailCheck[];
  editable: boolean;
  canCheck: boolean;
  onToggle?: (id: string) => Promise<void>;
  onCheckError: (message: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialItems.length
      ? initialItems.map((text, index) => ({
          ...makeRow(text),
          ...initialChecks?.[index],
        }))
      : [makeRow()],
  );
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const composing = useRef(new Set<string>());

  useEffect(() => {
    if (!pendingFocus.current) return;
    const input = inputs.current.get(pendingFocus.current);
    if (input) input.focus();
    else addButton.current?.focus();
    pendingFocus.current = null;
  }, [rows]);

  function addAfter(index: number) {
    const row = makeRow();
    pendingFocus.current = row.id;
    setRows((current) => [...current.slice(0, index + 1), row, ...current.slice(index + 1)]);
  }

  function remove(index: number) {
    pendingFocus.current = rows[index - 1]?.id || rows[index + 1]?.id || 'add';
    composing.current.delete(rows[index].id);
    setRows((current) => current.filter((_, i) => i !== index));
  }
  async function toggle(row: Row) {
    setRows((current) =>
      current.map((item) => (item.id === row.id ? { ...item, completed: !item.completed } : item)),
    );
    try {
      await onToggle?.(row.id);
    } catch (error) {
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, completed: row.completed } : item)),
      );
      onCheckError((error as Error).message);
    }
  }
  const filled = rows.filter((row) => row.text.trim());
  const done = filled.filter((row) => row.completed).length;

  function handleKey(e: KeyboardEvent<HTMLInputElement>, row: Row, index: number) {
    if (
      e.nativeEvent.isComposing ||
      e.nativeEvent.keyCode === 229 ||
      composing.current.has(row.id)
    ) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (row.text.trim()) addAfter(index);
    } else if (e.key === 'Backspace' && row.text === '' && index > 0) {
      e.preventDefault();
      const previous = inputs.current.get(rows[index - 1].id);
      previous?.focus();
      previous?.setSelectionRange(previous.value.length, previous.value.length);
      // Keep the empty row: Backspace changes focus, never deletes another item.
    }
  }

  return (
    <div className="detail-items-editor" role="group" aria-label="세부 항목">
      <div className="detail-items-label">
        <span>세부 항목</span>
        <small>선택</small>
      </div>
      <div className="detail-input-list">
        {rows.map((row, index) => (
          <div
            className={`detail-input-row ${row.completed ? 'detail-is-complete' : ''}`}
            key={row.id}
          >
            <button
              className="detail-checkbox"
              type="button"
              role="checkbox"
              aria-label={`세부 항목 ${index + 1} 완료`}
              aria-checked={row.completed}
              disabled={!canCheck || !row.text.trim()}
              onClick={() => void toggle(row)}
            >
              {row.completed && <Check size={11} />}
            </button>
            <input type="hidden" name="detailId" value={row.id} />
            <input type="hidden" name="detailComplete" value={String(row.completed)} />
            <input
              ref={(input) => {
                if (input) inputs.current.set(row.id, input);
                else inputs.current.delete(row.id);
              }}
              type="text"
              name="detailItem"
              aria-label={`세부 항목 ${index + 1}`}
              placeholder={
                index === 0 ? '예: 순열 문제 10개 풀기' : '이어서 할 내용을 적어 주세요.'
              }
              value={row.text}
              maxLength={10000}
              onChange={(e) =>
                setRows((current) =>
                  current.map((item) =>
                    item.id === row.id ? { ...item, text: e.target.value } : item,
                  ),
                )
              }
              onCompositionStart={() => composing.current.add(row.id)}
              onCompositionEnd={() => composing.current.delete(row.id)}
              onKeyDown={(e) => handleKey(e, row, index)}
            />
            {editable && (
              <button
                className="detail-remove-button"
                type="button"
                aria-label={`세부 항목 ${index + 1} 삭제`}
                onClick={() => remove(index)}
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {filled.length > 0 && (
        <TaskProgress
          progress={{
            total: filled.length,
            done,
            percent: progressPercent(done, filled.length),
          }}
          label="세부 항목 진행률"
        />
      )}
      {editable && (
        <button
          ref={addButton}
          className="detail-add-button"
          type="button"
          onClick={() => addAfter(rows.length - 1)}
        >
          <Plus size={16} /> 한 줄 추가
        </button>
      )}
    </div>
  );
}
