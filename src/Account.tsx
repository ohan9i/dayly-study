import { Button } from '@/components/ui/button';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Eye, EyeOff, LockKeyhole, LogIn, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from './planner';
import './Account.css';

type Mode = 'login' | 'signup' | 'reset' | 'password';
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
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
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className="password-input">
        <Input
          id={id}
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

function AccountCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="auth-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children}
    </Card>
  );
}

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
  const emailId = useId();
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
      const result = await supabase.auth.signOut({ scope: 'local' });
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
      <AccountCard title="계정 연결 준비 중" description="지금은 계획을 조회할 수 있어요.">
        <CardContent>
          <div className="account-status">
            <LockKeyhole size={30} />
            <p>계정 연결이 준비되면 이메일과 비밀번호로 로그인하고 나의 계획을 편집할 수 있어요.</p>
          </div>
        </CardContent>
        <CardFooter>
          <Button className="full-width" onClick={onDone}>
            나의 하루로 돌아가기
          </Button>
        </CardFooter>
      </AccountCard>
    );
  if (sessionEmail && mode !== 'password')
    return (
      <AccountCard title="나의 계정" description="같은 계정으로 다른 기기에서도 기록을 이어가세요.">
        <CardContent>
          <div className="account-status">
            <ShieldCheck size={28} />
            <strong>{sessionEmail}</strong>
            <p>로그인되어 있어요. 승인된 공간을 편집할 수 있습니다.</p>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            className="full-width"
            disabled={busy}
            onClick={() => switchMode('password')}
          >
            <LockKeyhole size={17} />
            비밀번호 변경
          </Button>
          <Button
            variant="outline"
            className="full-width"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <LogOut size={17} />
            로그아웃
          </Button>
        </CardFooter>
      </AccountCard>
    );
  if (sent)
    return (
      <AccountCard
        title="이메일을 확인해 주세요."
        description={
          sent === 'signup' ? '가입 확인 메일을 보냈어요.' : '비밀번호 재설정을 안내해 드릴게요.'
        }
      >
        <CardContent>
          <div className="account-status">
            <Mail size={32} />
            <p>
              {sent === 'signup'
                ? '가입 확인 메일의 링크를 누른 뒤, 이메일과 비밀번호로 로그인해 주세요.'
                : '이 이메일로 가입한 계정이 있다면 재설정 메일이 전송됩니다. 메일의 링크에서 새 비밀번호를 정해 주세요.'}
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="full-width" onClick={() => switchMode('login')}>
            로그인으로 돌아가기
          </Button>
        </CardFooter>
      </AccountCard>
    );
  const changing = mode === 'password';
  const title = changing
    ? '비밀번호 변경'
    : mode === 'signup'
      ? '회원가입'
      : mode === 'reset'
        ? '비밀번호 재설정'
        : '로그인';
  const description = changing
    ? '새 비밀번호를 입력해 주세요. 변경 후에는 새 비밀번호로 로그인합니다.'
    : mode === 'signup'
      ? '나의 공부와 기록을 담을 계정을 만들어요.'
      : mode === 'reset'
        ? '가입한 이메일로 재설정 링크를 보내 드려요.'
        : '이메일과 비밀번호로 나의 하루를 이어가세요.';
  return (
    <AccountCard title={title} description={description}>
      <form className="editor-form auth-card-form" key={mode} onSubmit={submit}>
        <CardContent>
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
          <fieldset disabled={busy}>
            {!changing && (
              <Field label="이메일" htmlFor={emailId}>
                <Input
                  id={emailId}
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  autoComplete="username"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
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
        </CardContent>
        <CardFooter>
          <Button
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
          </Button>
          {(mode === 'login' || mode === 'signup') && (
            <Button
              variant="outline"
              className="full-width"
              disabled={busy}
              type="button"
              onClick={onDone}
            >
              나중에
            </Button>
          )}
          {mode === 'login' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-button auth-reset"
              disabled={busy}
              type="button"
              onClick={() => switchMode('reset')}
            >
              비밀번호를 잊었나요?
            </Button>
          )}
          {mode === 'reset' && (
            <Button
              variant="outline"
              className="full-width"
              disabled={busy}
              type="button"
              onClick={() => switchMode('login')}
            >
              로그인으로 돌아가기
            </Button>
          )}
          {changing && (
            <Button
              variant="outline"
              className="full-width"
              disabled={busy}
              type="button"
              onClick={() => (recovery ? void signOut() : switchMode('login'))}
            >
              {recovery ? '재설정 취소하고 로그아웃' : '계정으로 돌아가기'}
            </Button>
          )}
        </CardFooter>
      </form>
    </AccountCard>
  );
}
