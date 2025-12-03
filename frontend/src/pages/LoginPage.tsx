import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const [mode, setMode] = useState<'user' | 'admin'>('user');
  const [step, setStep] = useState<'access' | 'mfa'>('access');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loginPayload, setLoginPayload] = useState<{ token: string; user: any } | null>(null);
  const navigate = useNavigate();
  const isAdmin = mode === 'admin';
  const TEMP_MFA_CODE = '123456';

  const switchMode = (nextMode: 'user' | 'admin') => {
    setMode(nextMode);
    setStep('access');
    setError('');
    setSuccess(false);
    setPassword('');
    setEmail('');
    setUsername('');
    setMfaCode('');
    setLoginPayload(null);
  };

  const handleAccessSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const identifier = isAdmin ? username.trim() : email.trim();
    if (!identifier || !password) {
      setError('Enter your email/username and password.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/v1/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: identifier, password })
      });

      if (!res.ok) {
        setError(res.status === 403 ? 'Access denied for this account.' : 'Invalid credentials.');
        setSuccess(false);
        return;
      }

      const body = await res.json().catch(() => null);
      setLoginPayload(body || null);
      setStep('mfa');
      setSuccess(false);
      setError('');
    } catch (err) {
      setError('Unable to reach the API. Please try again.');
      setSuccess(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaCode.trim()) {
      setError('Enter the 6-digit MFA code.');
      return;
    }
    if (mfaCode.trim() !== TEMP_MFA_CODE) {
      setError('Invalid MFA code. Use the temporary code provided.');
      return;
    }

    // Optionally persist token for downstream calls; keep light-touch for now.
    if (loginPayload?.token) {
      try {
        localStorage.setItem('dax_portal_token', loginPayload.token);
      } catch {
        // ignore storage errors
      }
    }

    setError('');
    setSuccess(true);
    navigate('/dashboard', { replace: true });
  };

  useEffect(() => {
    setError('');
  }, []);

  const accessColor = error ? '#f87171' : success ? '#22c55e' : '#f7e27c';
  const cardClass = [
    'relative z-10 w-full rounded-2xl p-8 backdrop-blur',
    error
      ? 'border border-red-400/60 bg-red-500/10 shadow-[0_25px_80px_rgba(239,68,68,0.35)]'
      : 'border border-white/10 bg-white/5 shadow-[0_25px_80px_rgba(0,0,0,0.55)]'
  ].join(' ');

  return (
    <div className="relative flex min-h-screen items-center justify-end overflow-hidden bg-[#111421] px-4 text-white sm:px-8 md:px-12 lg:px-16">
      <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-3 text-[11px] uppercase tracking-[0.26em] text-white/70 sm:right-8 sm:top-6">
        <Link to="/" className="pointer-events-auto transition hover:text-white">
          Back
        </Link>
        <span className="h-3 w-px bg-white/30" aria-hidden="true"></span>
        <Link to="/overview" className="pointer-events-auto transition hover:text-white">
          Overview
        </Link>
      </div>
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[#05060b]/90 backdrop-blur-2xl"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(107,107,247,0.14),transparent_54%)]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_72%,rgba(155,140,255,0.12),transparent_62%)]"></div>
        <div className="absolute -left-16 top-10 h-72 w-72 rounded-full bg-[#6B6BF7]/16 blur-3xl"></div>
        <div className="absolute bottom-[-10rem] right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[#9B8CFF]/12 blur-3xl"></div>
      </div>
      <div
        className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/14 to-transparent"
        aria-hidden="true"
      ></div>

      <div className="relative ml-auto mr-0 w-full max-w-md -translate-x-4 md:-translate-x-2">
        <div className={cardClass}>
          <div className="absolute -top-6 right-4 flex items-center gap-3 md:right-6">
            <span
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[#f7e27c] shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke={accessColor} strokeWidth="1.6">
                {success ? (
                  <>
                    <rect x="6.5" y="11" width="11" height="7" rx="2" ry="2" />
                    <path d="M15 10V7a3 3 0 0 0-6 0v1" />
                    <path d="M12 13.5v2" />
                  </>
                ) : (
                  <>
                    <rect x="6.5" y="10.5" width="11" height="8" rx="2" ry="2" />
                    <path d="M9 10V8a3 3 0 0 1 6 0v2" />
                    <path d="M12 13v2" />
                  </>
                )}
              </svg>
            </span>
          </div>
          <p className="text-xs uppercase tracking-[0.32em] text-white/60">
            {step === 'access' ? (isAdmin ? 'Admin Access' : 'Access') : 'MFA'}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">{step === 'access' ? 'Login' : 'Multi-factor'}</h1>

          {step === 'access' ? (
            <form className="mt-8 space-y-4" onSubmit={handleAccessSubmit}>
              {isAdmin ? (
                <>
                  <label className="block space-y-2 text-sm font-semibold">
                    <span className="text-xs uppercase tracking-[0.2em] text-white/60">Username</span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                      placeholder="admin@example.com"
                      autoComplete="username"
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-semibold">
                    <span className="text-xs uppercase tracking-[0.2em] text-white/60">Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                      placeholder="Your password"
                      autoComplete="current-password"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="block space-y-2 text-sm font-semibold">
                    <span className="text-xs uppercase tracking-[0.2em] text-white/60">Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-semibold">
                    <span className="text-xs uppercase tracking-[0.2em] text-white/60">Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                      placeholder="Your password"
                      autoComplete="current-password"
                    />
                  </label>
                </>
              )}

              {error && <p className="text-sm text-amber-300">{error}</p>}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-white/95 px-6 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-[#0b0c11] shadow-[0_12px_34px_rgba(255,255,255,0.2)] transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_42px_rgba(255,255,255,0.26)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>
              </div>
            </form>
          ) : (
            <form className="mt-8 space-y-4" onSubmit={handleMfaSubmit}>
              <label className="block space-y-2 text-sm font-semibold">
                <span className="text-xs uppercase tracking-[0.2em] text-white/60">Temporary MFA Code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                  placeholder="Enter 6-digit code"
                />
                <span className="text-[11px] text-white/60">Use the temporary code provided (default 123456).</span>
              </label>

              {error && <p className="text-sm text-amber-300">{error}</p>}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="rounded-full bg-white/95 px-6 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-[#0b0c11] shadow-[0_12px_34px_rgba(255,255,255,0.2)] transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_42px_rgba(255,255,255,0.26)]"
                >
                  Verify
                </button>
              </div>
            </form>
          )}
        </div>
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            onClick={() => switchMode(isAdmin ? 'user' : 'admin')}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition ${
              isAdmin
                ? 'border-[#f7e27c]/70 bg-[#f7e27c]/15 text-[#f7e27c]'
                : 'border-white/20 bg-white/8 text-white/70 hover:border-white/35 hover:text-white'
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[#f7e27c]">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 3 4 7v5c0 5 4 8 8 9 4-1 8-4 8-9V7l-8-4Z" />
                <path d="M9 12.5 11 14 15 10" />
              </svg>
            </span>
            <span className="text-white">Admin</span>
          </button>
        </div>
      </div>
    </div>
  );
}
