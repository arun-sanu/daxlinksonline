import { useCallback, useEffect, useMemo, useState } from 'react';

import type { BotInstance } from '../api/types';
import { listInstances, pauseInstance, restartInstance, startInstance, stopInstance } from '../api/tradeBots';

type BotInstanceLifecycleAction = 'start' | 'pause' | 'stop' | 'restart';

type BotInstanceControlsPanelProps = {
  botId: string;
  title?: string;
  subtitle?: string;
  showHeader?: boolean;
  className?: string;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function normalizeInstanceState(value?: string | null) {
  const normalized = String(value || 'stopped')
    .trim()
    .toLowerCase();
  if (['running', 'paused', 'stopped', 'error'].includes(normalized)) return normalized;
  return 'stopped';
}

function canRunInstanceAction(instance: BotInstance, action: BotInstanceLifecycleAction) {
  const lifecycle = (instance as any)?.lifecycle;
  const allowedActions = Array.isArray(lifecycle?.allowedActions)
    ? lifecycle.allowedActions.map((value: unknown) => String(value).toLowerCase())
    : null;

  if (allowedActions && allowedActions.length > 0) {
    return allowedActions.includes(action);
  }

  const status = normalizeInstanceState(instance.status);
  if (action === 'start') return status !== 'running';
  if (action === 'pause') return status === 'running';
  if (action === 'stop') return status !== 'stopped';
  return true;
}

function instanceStatusBadgeClass(statusValue?: string | null) {
  const status = normalizeInstanceState(statusValue);
  if (status === 'running') return 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100';
  if (status === 'paused') return 'border-amber-300/45 bg-amber-500/15 text-amber-100';
  if (status === 'error') return 'border-rose-300/45 bg-rose-500/15 text-rose-100';
  return 'border-white/25 bg-white/10 text-gray-200';
}

function getActionLabel(action: BotInstanceLifecycleAction) {
  if (action === 'restart') return 'restarted';
  if (action === 'pause') return 'paused';
  if (action === 'start') return 'started';
  return 'stopped';
}

function actionButtonClass(action: BotInstanceLifecycleAction) {
  if (action === 'start') return 'border-emerald-300/40 bg-emerald-500/15 text-emerald-100';
  if (action === 'pause') return 'border-amber-300/40 bg-amber-500/15 text-amber-100';
  if (action === 'restart') return 'border-primary-300/40 bg-primary-500/15 text-primary-100';
  return 'border-white/20 bg-white/10 text-gray-100';
}

export default function BotInstanceControlsPanel({
  botId,
  title = 'Bot runtime controls',
  subtitle = 'Start, pause, restart, or stop each deployed instance for this bot.',
  showHeader = true,
  className = ''
}: BotInstanceControlsPanelProps) {
  const [instances, setInstances] = useState<BotInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instanceActionTargetId, setInstanceActionTargetId] = useState<string | null>(null);

  const runningCount = useMemo(
    () => instances.filter((instance) => normalizeInstanceState(instance.status) === 'running').length,
    [instances]
  );

  const loadInstances = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!botId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const result = await listInstances(botId);
        setInstances(result.items || []);
      } catch (err: any) {
        setInstances([]);
        setError(err?.message || 'Failed to load bot instances.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [botId]
  );

  useEffect(() => {
    setMessage(null);
    setError(null);
    setInstances([]);
    if (!botId) return;
    loadInstances();
  }, [botId, loadInstances]);

  const handleInstanceControl = async (instanceId: string, action: BotInstanceLifecycleAction) => {
    if (!botId || !instanceId) return;
    setInstanceActionTargetId(instanceId);
    setError(null);
    setMessage(null);

    const actionRunner =
      action === 'start'
        ? startInstance
        : action === 'pause'
          ? pauseInstance
          : action === 'stop'
            ? stopInstance
            : restartInstance;

    try {
      const updated = await actionRunner(botId, instanceId);
      if (!updated) {
        setError(`Failed to ${action} bot instance.`);
        return;
      }
      setInstances((prev) => prev.map((item) => (item.id === instanceId ? { ...item, ...updated } : item)));
      setMessage(`Instance ${instanceId.slice(0, 10)} ${getActionLabel(action)}.`);
      await loadInstances({ silent: true });
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} bot instance.`);
    } finally {
      setInstanceActionTargetId(null);
    }
  };

  return (
    <section className={`rounded-2xl border border-white/15 bg-black/45 p-4 ${className}`.trim()}>
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-gray-200">
              running {runningCount}/{instances.length}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => loadInstances()}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh Instances'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-3 rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{error}</div>}
      {message && <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</div>}

      <div className="mt-3 space-y-2">
        {loading && <p className="text-xs text-gray-400">Loading instances...</p>}
        {!loading && instances.length === 0 && (
          <p className="text-xs text-gray-400">No instances found for this bot. Create or rent an instance to enable runtime controls.</p>
        )}

        {instances.map((instance) => {
          const status = normalizeInstanceState(instance.status);
          const isBusy = instanceActionTargetId === instance.id;
          const canStart = canRunInstanceAction(instance, 'start');
          const canPause = canRunInstanceAction(instance, 'pause');
          const canStop = canRunInstanceAction(instance, 'stop');
          const canRestart = canRunInstanceAction(instance, 'restart');

          return (
            <div key={instance.id} className="rounded-lg border border-white/15 bg-black/35 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-100">{String(instance.symbol || 'SYMBOL').toUpperCase()}</p>
                    <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${instanceStatusBadgeClass(status)}`}>
                      {status}
                    </span>
                    {isBusy && (
                      <span className="rounded border border-primary-300/45 bg-primary-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-primary-100">
                        applying
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    Started {formatDate(instance.startedAt)} · Stopped {formatDate(instance.stoppedAt)}
                  </p>
                  <p className="mt-1 break-all text-[10px] font-mono text-gray-500">Instance {instance.id}</p>
                  {instance.lastError && <p className="mt-1 text-[11px] text-rose-200">Last error: {instance.lastError}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-40 ${actionButtonClass('start')}`}
                    onClick={() => handleInstanceControl(instance.id, 'start')}
                    disabled={isBusy || !canStart}
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-40 ${actionButtonClass('pause')}`}
                    onClick={() => handleInstanceControl(instance.id, 'pause')}
                    disabled={isBusy || !canPause}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-40 ${actionButtonClass('restart')}`}
                    onClick={() => handleInstanceControl(instance.id, 'restart')}
                    disabled={isBusy || !canRestart}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-40 ${actionButtonClass('stop')}`}
                    onClick={() => handleInstanceControl(instance.id, 'stop')}
                    disabled={isBusy || !canStop}
                  >
                    Stop
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
