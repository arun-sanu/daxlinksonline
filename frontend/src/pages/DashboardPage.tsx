export default function DashboardPage() {
  return (
    <div className="space-y-10 pb-16">
      <section className="layout-container section-pad">
        <div className="card-shell">
          <p className="section-label">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold text-main">Welcome back</h1>
          <p className="mt-2 text-sm text-gray-300">
            You&apos;re signed in. This dashboard is ready for your widgets and metrics when you&apos;re ready to add them.
          </p>
        </div>
      </section>
    </div>
  );
}
