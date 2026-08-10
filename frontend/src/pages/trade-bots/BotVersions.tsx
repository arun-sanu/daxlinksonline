import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { BotVersion } from '../../api/types';
import { createVersion, listVersions, uploadVersion, startBuildVersion, getScanVersion, publishBot, type VersionScanResult } from '../../api/tradeBots';

export default function BotVersions() {
  const { botId } = useParams();
  const [versions, setVersions] = useState<BotVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploadingVersionId, setUploadingVersionId] = useState<string | null>(null);
  const [buildingVersionId, setBuildingVersionId] = useState<string | null>(null);
  const [scanDetails, setScanDetails] = useState<Record<string, VersionScanResult>>({});
  const [scanLoadingId, setScanLoadingId] = useState<string | null>(null);
  const [activeDropId, setActiveDropId] = useState<string | null>(null);

  async function refreshOne(versionId: string) {
    if (!botId) return;
    const scan = await getScanVersion(botId, versionId);
    if (!scan) return;
    setVersions((prev) =>
      prev.map((v) =>
        v.id === versionId
          ? {
              ...v,
              status: scan.status || v.status,
              imageRef: scan.imageRef ?? v.imageRef,
              sbomRef: scan.sbomRef ?? v.sbomRef,
              signedDigest: scan.signedDigest ?? v.signedDigest
            }
          : v
      )
    );
    setScanDetails((prev) => ({ ...prev, [versionId]: scan }));
  }

  async function refresh() {
    if (!botId) return;
    setLoading(true);
    const res = await listVersions(botId);
    setVersions(res.items);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [botId]);

  async function onCreate() {
    if (!botId) return;
    setCreating(true);
    try {
      const v = await createVersion(botId, {});
      if (v) setVersions((prev) => [v, ...prev]);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file: File, versionId: string) {
    if (!botId) return;
    setUploadingVersionId(versionId);
    try {
      await uploadVersion(botId, versionId, file);
      await refreshOne(versionId);
    } finally {
      setUploadingVersionId(null);
    }
  }

  async function onBuild(versionId: string) {
    if (!botId) return;
    setBuildingVersionId(versionId);
    try {
      await startBuildVersion(botId, versionId);
      // Poll once after a short delay
      setTimeout(() => refreshOne(versionId), 1200);
    } finally {
      setBuildingVersionId(null);
    }
  }

  async function onPublish(versionId: string) {
    if (!botId) return;
    await publishBot(botId, versionId);
    refresh();
  }

  async function onViewReport(versionId: string) {
    if (!botId) return;
    setScanLoadingId(versionId);
    try {
      await refreshOne(versionId);
    } finally {
      setScanLoadingId(null);
    }
  }

  function renderStatusBadge(status: string) {
    const color =
      status === 'approved'
        ? 'bg-green-100 text-green-800'
        : status === 'published'
          ? 'bg-purple-100 text-purple-800'
          : status === 'scanned'
            ? 'bg-amber-100 text-amber-800'
            : status === 'built'
              ? 'bg-blue-100 text-blue-800'
              : status === 'rejected'
                ? 'bg-red-100 text-red-800'
                : 'bg-gray-100 text-gray-800';
    return <span className={`px-2 py-0.5 rounded text-xs capitalize ${color}`}>{status}</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Versions</h2>
        <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={onCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create Version'}
        </button>
      </div>
      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : (
        <ul className="space-y-2">
          {versions.length === 0 && <li className="text-gray-500">No versions yet</li>}
          {versions.map((v) => (
            <li key={v.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{v.id}</div>
                  <div className="text-sm text-gray-500 flex items-center gap-2">
                    Status: {renderStatusBadge(v.status)}
                    {v.imageRef && <span className="text-xs text-gray-400">Image: {v.imageRef}</span>}
                  </div>
                  {v.signedDigest && <div className="text-xs text-gray-400 break-all">Digest: {v.signedDigest}</div>}
                </div>
                <div className="text-sm text-gray-500">{new Date(v.createdAt).toLocaleString()}</div>
              </div>
              <div
                className={`border-2 border-dashed rounded p-3 text-sm ${activeDropId === v.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setActiveDropId(v.id);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setActiveDropId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setActiveDropId(null);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleUpload(file, v.id);
                }}
              >
                <p className="text-gray-600">{uploadingVersionId === v.id ? 'Uploading…' : 'Upload bot ZIP (drag & drop or select)'}</p>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="mt-2 text-sm"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, v.id);
                    e.target.value = '';
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                  disabled={buildingVersionId === v.id || uploadingVersionId === v.id}
                  onClick={() => onBuild(v.id)}
                >
                  {buildingVersionId === v.id ? 'Building…' : 'Start Build'}
                </button>
                <button
                  className="px-3 py-2 rounded bg-slate-200 text-slate-800 disabled:opacity-50"
                  onClick={() => onViewReport(v.id)}
                  disabled={scanLoadingId === v.id}
                >
                  {scanLoadingId === v.id ? 'Loading report…' : 'View Scan / SBOM'}
                </button>
                <button
                  className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
                  disabled={v.status !== 'approved'}
                  onClick={() => onPublish(v.id)}
                >
                  Publish
                </button>
              </div>
              {scanDetails[v.id] && (
                <div className="bg-gray-50 border rounded p-3 text-xs space-y-2">
                  <div className="font-semibold text-gray-700">Security Scan</div>
                  <div>Tool: {scanDetails[v.id].scan?.tool || 'grype-sim'}</div>
                  <div>Summary: {scanDetails[v.id].scan?.summary || 'n/a'}</div>
                  <div>
                    Findings:
                    {scanDetails[v.id].scan?.findings?.length ? (
                      <ul className="list-disc list-inside">
                        {scanDetails[v.id].scan!.findings!.map((f: any) => (
                          <li key={f.id || f.package}>{f.severity?.toUpperCase()} · {f.package} — {f.detail || 'See report'}</li>
                        ))}
                      </ul>
                    ) : (
                      <span> none</span>
                    )}
                  </div>
                  {scanDetails[v.id].sbom && (
                    <details className="bg-white border rounded p-2">
                      <summary className="cursor-pointer text-blue-600">View SBOM JSON</summary>
                      <pre className="mt-2 max-h-64 overflow-auto text-[11px]">{JSON.stringify(scanDetails[v.id].sbom, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
