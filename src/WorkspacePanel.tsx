import { Check, Home, Users } from 'lucide-react';
import { useState } from 'react';
import type { Planner } from './planner';

export default function WorkspacePanel({
  planner,
  compact = false,
}: {
  planner: Planner;
  compact?: boolean;
}) {
  const mine = planner.workspaces.filter((space) => space.owner_id === planner.session?.user.id);
  const approved = planner.workspaces.filter(
    (space) => space.owner_id !== planner.session?.user.id,
  );
  const select = (id: string) => {
    void planner.selectWorkspace(id).catch(() => {});
  };
  if (compact)
    return (
      <div className="workspace-bar">
        {planner.isOwner ? <Home size={16} /> : <Users size={16} />}
        <span>{planner.isOwner ? '내 공간' : '승인받은 공간'}</span>
        <select
          aria-label="사용 공간 선택"
          value={planner.workspace?.id || ''}
          disabled={planner.busy || planner.loading}
          onChange={(e) => select(e.target.value)}
        >
          <optgroup label="내 공간">
            {mine.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </optgroup>
          {approved.length > 0 && (
            <optgroup label="승인받은 공간">
              {approved.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    );
  return (
    <div className="workspace-groups">
      {[
        {
          label: '내 공간',
          description: '내가 관리하고 사람을 승인하는 공간이에요.',
          spaces: mine,
          Icon: Home,
        },
        {
          label: '승인받은 공간',
          description: '다른 사람이 참여를 허락한 공간이에요.',
          spaces: approved,
          Icon: Users,
        },
      ].map(({ label, description, spaces, Icon }) => (
        <section className="workspace-group" key={label}>
          <h3>
            <Icon size={17} />
            {label}
          </h3>
          <p>{description}</p>
          {spaces.length ? (
            <div className="workspace-options">
              {spaces.map((space) => (
                <button
                  type="button"
                  key={space.id}
                  className={planner.workspace?.id === space.id ? 'selected' : ''}
                  aria-pressed={planner.workspace?.id === space.id}
                  disabled={planner.busy || planner.loading}
                  onClick={() => select(space.id)}
                >
                  <span>
                    {space.name}
                    <small>
                      {space.owner_id === planner.session?.user.id ? '관리자' : '작성자로 참여'}
                    </small>
                  </span>
                  {planner.workspace?.id === space.id && <Check size={17} />}
                </button>
              ))}
            </div>
          ) : (
            <p className="workspace-empty">
              {label === '내 공간'
                ? '로그인 후 자동으로 준비됩니다.'
                : '아직 승인받은 공간이 없어요. 등록한 이메일과 로그인 이메일이 같은지 확인해 주세요.'}
            </p>
          )}
        </section>
      ))}
      {planner.isOwner && planner.workspace && (
        <SpaceName key={planner.workspace.id} planner={planner} />
      )}
    </div>
  );
}
function SpaceName({ planner }: { planner: Planner }) {
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="workspace-name-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get('name') || '').trim();
        setError('');
        setSaved(false);
        if (!name) {
          setError('공간 이름을 적어 주세요.');
          return;
        }
        try {
          await planner.renameWorkspace(name);
          setSaved(true);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label className="field">
        <span>내 공간 이름</span>
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={planner.workspace?.name}
          disabled={!planner.canWrite || planner.busy}
        />
      </label>
      <p>함께 쓰는 사람이 알아보기 쉬운 이름으로 바꿀 수 있어요.</p>
      <button className="soft-button" disabled={!planner.canWrite || planner.busy}>
        공간 이름 저장
      </button>
      {saved && <span role="status">이름을 저장했어요.</span>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
