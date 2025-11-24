import { Link } from 'react-router-dom';

export default function LandingPage() {

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#111421] text-white">
      <div className="shockwave"></div>
      <div className="shockwave shockwave--2"></div>
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(107,107,247,0.16),transparent_52%)]"></div>
        <div className="absolute -left-24 top-12 h-80 w-80 rounded-full bg-[#6B6BF7]/18 blur-3xl"></div>
        <div className="absolute bottom-[-8rem] right-[-6rem] h-96 w-96 rounded-full bg-[#9B8CFF]/16 blur-3xl"></div>
      </div>
      <div
        className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/30 to-transparent opacity-80"
        aria-hidden="true"
      ></div>

      <div className="relative z-10 flex w-full max-w-6xl items-center justify-between px-6 py-16 md:px-12">
        <div className="flex-1 translate-x-6 space-y-3 md:translate-x-10">
          <div
            className="select-none text-[7.5vw] leading-[0.78] md:text-[5.8vw]"
            style={{ fontFamily: '"Orbitron", "Plus Jakarta Sans", sans-serif' }}
          >
            D&gt;&lt;
          </div>
          <p
            className="pl-1 text-xl font-bold tracking-[0.12em] text-white/80 md:text-2xl"
            style={{ fontFamily: '"Plus Jakarta Sans", "Inter", sans-serif' }}
          >
            daxlinksonline.link
          </p>
        </div>

        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Link
            to="/login"
            className="pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border border-white/40 text-2xl font-semibold tracking-wide text-white transition hover:-translate-y-1 hover:border-white/70 md:h-16 md:w-16 md:text-3xl"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(107,107,247,0.18))' }}
            aria-label="Go to login"
          >
            <span className="pulse-ring"></span>
            <span className="pulse-ring pulse-ring--alt"></span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 transition-transform group-hover:translate-x-0.5 md:h-6 md:w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
