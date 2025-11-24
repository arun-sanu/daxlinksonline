import { Link, useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';

export default function LoginPage() {
  const [step, setStep] = useState<'access' | 'mfa'>('access');
  const [email, setEmail] = useState('arn@dx.link');
  const [password, setPassword] = useState('asd.12345');
  const [codeDigits, setCodeDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [accessGranted, setAccessGranted] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const navigate = useNavigate();

  const joinCode = () => codeDigits.join('').trim();

  const handleCodeChange = (index: number, value: string) => {
    const digit = value.slice(-1).replace(/\D/g, '');
    const nextDigits = [...codeDigits];
    nextDigits[index] = digit;
    setCodeDigits(nextDigits);
    if (digit && codeRefs.current[index + 1]) {
      codeRefs.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !codeDigits[index] && codeRefs.current[index - 1]) {
      codeRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('');
    if (!text.length) return;
    const nextDigits = [...codeDigits];
    for (let i = 0; i < 6; i++) {
      nextDigits[i] = text[i] || '';
    }
    setCodeDigits(nextDigits);
    const nextEmpty = nextDigits.findIndex((d) => !d);
    const targetIndex = nextEmpty === -1 ? 5 : nextEmpty;
    codeRefs.current[targetIndex]?.focus();
    event.preventDefault();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step === 'access') {
      if (email.trim() === 'arn@dx.link' && password === 'asd.12345') {
        setError('');
        setAccessGranted(true);
        setStep('mfa');
      } else {
        setError('Invalid credentials. Use the temp email and password provided.');
      }
    } else if (step === 'mfa') {
      const code = joinCode();
      if (code.length < 6) {
        setError('Enter the 6-digit code.');
        return;
      }
      if (code === '123456') {
        setError('');
        setMfaVerified(true);
        navigate('/dashboard', { replace: true });
      } else {
        setError('Invalid MFA code. Use the temp code 123456.');
        setMfaVerified(false);
      }
    }
  };

  const accessColor = error ? '#f87171' : accessGranted ? 'oklch(82.8% 0.189 84.429)' : '#f7e27c';
  const mfaColor = error ? '#f87171' : mfaVerified ? 'oklch(82.8% 0.189 84.429)' : '#f7e27c';
  const cardClass = [
    'relative z-10 ml-auto mr-0 w-full max-w-md -translate-x-4 rounded-2xl p-8 backdrop-blur md:-translate-x-2',
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

      <div className={cardClass}>
        <div className="absolute -top-6 right-4 flex items-center gap-3 md:right-6">
          <span
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[#f7e27c] shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur ${
              step === 'access' ? 'lock-pulse' : ''
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke={accessColor} strokeWidth="1.6">
              {accessGranted ? (
                <>
                  <rect x="6.5" y="11" width="11" height="7" rx="2" ry="2" />
                  <path d="M9 11V8a3 3 0 0 1 5.2-2" />
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
          <span
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[#f7e27c] shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur ${
              step === 'mfa' ? 'lock-pulse' : ''
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke={mfaColor} strokeWidth="1.6">
              {mfaVerified ? (
                <>
                  <rect x="6.5" y="11" width="11" height="7" rx="2" ry="2" />
                  <path d="M9 11V8a3 3 0 0 1 5.2-2" />
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
        <p className="text-xs uppercase tracking-[0.32em] text-white/60">{step === 'access' ? 'Access' : 'MFA'}</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">{step === 'access' ? 'Login' : 'Multi-factor'}</h1>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {step === 'access' ? (
            <>
              <label className="block space-y-2 text-sm font-semibold">
                <span className="text-xs uppercase tracking-[0.2em] text-white/60">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                  placeholder="arn@dx.link"
                />
              </label>
              <label className="block space-y-2 text-sm font-semibold">
                <span className="text-xs uppercase tracking-[0.2em] text-white/60">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
                  placeholder="asd.12345"
                />
              </label>
            </>
          ) : (
            <div className="space-y-2 text-sm font-semibold">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-white/60">MFA Code</span>
                <span className="text-[11px] text-white/50">Sent to {email || 'your email'}</span>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (codeRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(idx, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                    onPaste={handleCodePaste}
                    className="h-14 rounded-md border border-white/10 bg-white/5 text-center text-sm font-semibold tracking-[0.12em] text-white outline-none transition focus:border-white/30 focus:bg-white/10"
                  />
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-amber-300">{error}</p>}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="rounded-full bg-white/95 px-6 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-[#0b0c11] shadow-[0_12px_34px_rgba(255,255,255,0.2)] transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_42px_rgba(255,255,255,0.26)]"
            >
              {step === 'access' ? 'Sign In' : mfaVerified ? 'Verified' : 'Verify'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
