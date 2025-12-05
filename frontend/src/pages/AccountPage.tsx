import { useEffect, useState } from 'react';

type Profile = {
  name: string;
  email: string;
  role: string;
  workspaceId: string;
  status: string;
};

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile>({
    name: '',
    email: '',
    role: '',
    workspaceId: '',
    status: 'Active session'
  });

  useEffect(() => {
    try {
      const name = localStorage.getItem('userName') || 'Super Admin';
      const email = localStorage.getItem('userEmail') || '—';
      const role = localStorage.getItem('userRole') || 'Super Admin';
      const workspaceId = localStorage.getItem('workspaceId') || '—';
      setProfile({ name, email, role, workspaceId, status: 'Active session' });
    } catch {
      setProfile({ name: 'Super Admin', email: '—', role: 'Super Admin', workspaceId: '—', status: 'Active session' });
    }
  }, []);

  return (
    <div className="layout-container section-pad space-y-10">
      <header className="space-y-3">
        <p className="section-label">Account</p>
        <h1 className="headline text-4xl">Workspace access</h1>
        <p className="muted-text max-w-3xl text-sm">
          Review operator identity, subscription posture, and control-plane privileges.
        </p>
      </header>

      <div className="card-shell space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="section-label">Primary operator</p>
            <h2 className="text-3xl font-semibold text-main">{profile.name}</h2>
            <p className="text-sm text-gray-400">{profile.email}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Workspace · {profile.workspaceId}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-white/90">{profile.role}</span>
            <span className="rounded-full border border-white/10 px-3 py-1 tracking-[0.28em] text-primary-200">Privileged</span>
            <span className="rounded-full border border-white/10 px-3 py-1 tracking-[0.28em] text-gray-300">2FA</span>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Session</p>
            <p className="mt-2 text-sm text-main">{profile.status}</p>
            <p className="text-xs text-gray-500">Signed in as {profile.email}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Workspace</p>
            <p className="mt-2 text-sm text-main">ID · {profile.workspaceId}</p>
            <p className="text-xs text-gray-500">Manage integrations, webhooks, and workflows.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
