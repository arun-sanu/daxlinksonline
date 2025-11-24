import { Link } from 'react-router-dom';

export default function LoginPage() {
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

      <div className="relative z-10 ml-auto mr-0 w-full max-w-md -translate-x-4 rounded-2xl border border-white/10 bg-white/5 p-8 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur md:-translate-x-2">
        <p className="text-xs uppercase tracking-[0.32em] text-white/60">Access</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Login</h1>
        <p className="mt-2 text-sm text-white/60">Enter your credentials to reach the console.</p>

        <form className="mt-8 space-y-4" onSubmit={(event) => event.preventDefault()}>
          <label className="block space-y-2 text-sm font-semibold">
            <span className="text-xs uppercase tracking-[0.2em] text-white/60">Email</span>
            <input
              type="email"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
              placeholder="you@daxlinksonline.link"
            />
          </label>
          <label className="block space-y-2 text-sm font-semibold">
            <span className="text-xs uppercase tracking-[0.2em] text-white/60">Password</span>
            <input
              type="password"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-white/40 focus:bg-white/10"
              placeholder="••••••••"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-full bg-white/90 px-4 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-[#0b0c11] transition hover:-translate-y-0.5 hover:bg-white"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
