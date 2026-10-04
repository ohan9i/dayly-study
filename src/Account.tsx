import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, Eye, EyeOff, LockKeyhole, LogIn, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from './planner';

type Mode = 'login' | 'signup' | 'reset' | 'password';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function PasswordField({
  label,
  name,
  fresh = false,
}: {
  label: string;
  name: string;
  fresh?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label}>
      <div className="password-input">
        <input
          aria-label={label}
          name={name}
          type={visible ? 'text' : 'password'}
          required
          minLength={fresh ? 8 : undefined}
          maxLength={128}
          autoComplete={fresh ? 'new-password' : 'current-password'}
          placeholder={fresh ? '8자 이상 입력해 주세요' : '계정 비밀번호'}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${label} ${visible ? '숨기기' : '표시'}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
    </Field>
  );
}
function authMessage(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === 'invalid_credentials' || (error as Error).message === 'Invalid login credentials')
    return '이메일 또는 비밀번호를 확인해 주세요.';
  if (code === 'email_not_confirmed') return '가입한 이메일의 확인 링크를 먼저 눌러 주세요.';
  if (code === 'weak_password')
    return '더 긴 비밀번호를 사용해 주세요. 프로젝트의 비밀번호 조건도 확인해 주세요.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit')
    return '요청이 많아요. 잠시 뒤 다시 시도해 주세요.';
  return (error as Error).message || '계정 요청을 처리하지 못했어요. 다시 시도해 주세요.';
}
const returnUrl = () => window.location.origin + window.location.pathname;

export default function Account({
  sessionEmail,
  recovery,
  onRecoveryDone,
  onDone,
  onToast,
}: {
  sessionEmail?: string;
  recovery: boolean;
  onRecoveryDone: () => void;
  onDone: () => void;
  onToast: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(recovery ? 'password' : 'login');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<'signup' | 'reset' | null>(null);
  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setSent(null);
  }
  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      onRecoveryDone();
      onDone();
      onToast('로그아웃했어요. 편집이 잠겼습니다.');
    } catch (error) {
      setError(authMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') || '');
    if ((mode === 'signup' || mode === 'password') && password !== values.get('confirmation')) {
      setError('두 비밀번호가 같지 않아요. 다시 확인해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const address = email.trim().toLowerCase();
      if (mode === 'login') {
        const result = await supabase.auth.signInWithPassword({ email: address, password });
        if (result.error) throw result.error;
        onDone();
        onToast('로그인했어요. 승인된 공간에서 공부를 이어 가세요.');
      } else if (mode === 'signup') {
        const result = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: returnUrl() },
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          onDone();
          onToast('계정을 만들었어요. 나의 공부 공간을 선택해 주세요.');
        } else setSent('signup');
      } else if (mode === 'reset') {
        const result = await supabase.auth.resetPasswordForEmail(address, {
          redirectTo: returnUrl(),
        });
        if (result.error) throw result.error;
        setSent('reset');
      } else {
        if (!sessionEmail)
          throw new Error(
            '재설정 링크가 만료되었거나 로그인 정보가 없어요. 새 링크를 받아 주세요.',
          );
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        onRecoveryDone();
        onDone();
        onToast('비밀번호를 변경했어요. 새 비밀번호를 사용해 주세요.');
      }
    } catch (error) {
      setError(authMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!supabase)
    return (
      <>
        <div className="account-status">
          <LockKeyhole size={30} />
          <strong>계정 연결을 준비하고 있어요.</strong>
          <p>
            Supabase를 연결하면 이메일과 비밀번호로 로그인할 수 있어요.
            <br />
            지금은 조회만 가능하며, 로그인 후 할 일을 편집합니다.
          </p>
        </div>
        <button className="primary-button full-width" onClick={onDone}>
          나의 하루로 돌아가기
        </button>
      </>
    );
  if (sessionEmail && mode !== 'password')
    return (
      <>
        <div className="account-status">
          <ShieldCheck size={28} />
          <strong>{sessionEmail}</strong>
          <p>로그인되어 있어요. 승인된 공간을 편집할 수 있습니다.</p>
        </div>
        <div className="account-actions">
          <button
            className="soft-button full-width"
            disabled={busy}
            onClick={() => switchMode('password')}
          >
            <LockKeyhole size={17} />
            비밀번호 변경
          </button>
          <button className="soft-button full-width" disabled={busy} onClick={() => void signOut()}>
            <LogOut size={17} />
            로그아웃
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  if (sent)
    return (
      <div className="account-status">
        <Mail size={32} />
        <strong>이메일을 확인해 주세요.</strong>
        <p>
          {sent === 'signup'
            ? '가입 확인 메일의 링크를 누른 뒤, 이메일과 비밀번호로 로그인해 주세요.'
            : '이 이메일로 가입한 계정이 있다면 재설정 메일이 전송됩니다. 메일의 링크에서 새 비밀번호를 정해 주세요.'}
        </p>
        <button className="text-button" onClick={() => switchMode('login')}>
          로그인으로 돌아가기
        </button>
      </div>
    );
  const changing = mode === 'password';
  return (
    <>
      {!changing && (
        <div className="auth-tabs" role="group" aria-label="계정 기능">
          <button
            type="button"
            className={mode !== 'signup' ? 'active' : ''}
            aria-pressed={mode !== 'signup'}
            disabled={busy}
            onClick={() => switchMode('login')}
          >
            로그인
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            aria-pressed={mode === 'signup'}
            disabled={busy}
            onClick={() => switchMode('signup')}
          >
            회원가입
          </button>
        </div>
      )}
      <form className="editor-form" key={mode} onSubmit={submit}>
        <fieldset disabled={busy}>
          {changing ? (
            <p className="setting-description">
              새 비밀번호를 입력해 주세요. 변경 후에는 새 비밀번호로 로그인합니다.
            </p>
          ) : (
            <Field label="이메일">
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="username"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </Field>
          )}
          {mode !== 'reset' && (
            <PasswordField
              label={changing ? '새 비밀번호' : '비밀번호'}
              name="password"
              fresh={mode === 'signup' || changing}
            />
          )}
          {(mode === 'signup' || changing) && (
            <PasswordField label="비밀번호 확인" name="confirmation" fresh />
          )}
        </fieldset>
        {mode === 'signup' && (
          <p className="card-footnote">
            이메일 확인 후 사용할 수 있어요. 다른 사람의 공간에 참여하려면 관리자의 이메일 승인이
            필요합니다.
          </p>
        )}
        {mode === 'login' && (
          <p className="card-footnote">
            본인 또는 관리자가 승인한 계정만 공유 공간을 편집할 수 있어요.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-button full-width"
          disabled={busy || (changing && !sessionEmail)}
          type="submit"
        >
          {changing ? (
            <Check size={17} />
          ) : mode === 'reset' ? (
            <Mail size={17} />
          ) : (
            <LogIn size={17} />
          )}
          {busy
            ? '처리 중…'
            : changing
              ? '새 비밀번호 저장'
              : mode === 'signup'
                ? '계정 만들기'
                : mode === 'reset'
                  ? '재설정 메일 받기'
                  : '비밀번호로 로그인'}
        </button>
        {mode === 'login' && (
          <button
            className="text-button auth-reset"
            disabled={busy}
            type="button"
            onClick={() => switchMode('reset')}
          >
            비밀번호를 잊었나요?
          </button>
        )}
        {mode === 'reset' && (
          <button
            className="text-button auth-reset"
            disabled={busy}
            type="button"
            onClick={() => switchMode('login')}
          >
            로그인으로 돌아가기
          </button>
        )}
        {changing && (
          <button
            className="text-button auth-reset"
            disabled={busy}
            type="button"
            onClick={() => (recovery ? void signOut() : switchMode('login'))}
          >
            {recovery ? '재설정 취소하고 로그아웃' : '계정으로 돌아가기'}
          </button>
        )}
      </form>
    </>
  );
}
