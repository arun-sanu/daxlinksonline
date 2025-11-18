import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

declare global {
  interface Window {
    monaco?: any;
    require?: any;
  }
}

type Mode = 'python' | 'webhook' | null;

const SAMPLE_PINE = `//@version=5
strategy("Simple Crossover", overlay=true)
fastLen = input.int(title="Fast", defval=9)
slowLen = input.int(title="Slow", defval=21)

fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)

goLong = ta.crossover(fast, slow)
goShort = ta.crossunder(fast, slow)

if goLong
    strategy.entry("Long", strategy.long, qty=1)
else if goShort
    strategy.entry("Short", strategy.short, qty=1)
`;

const MONACO_LOADER = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js';
const MONACO_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs';
let monacoPromise: Promise<any> | null = null;

function ensureMonaco(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Monaco unavailable during SSR'));
  if (window.monaco) return Promise.resolve(window.monaco);
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-monaco-loader="true"]') as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    script.src = MONACO_LOADER;
    script.async = true;
    script.dataset.monacoLoader = 'true';
    script.onload = () => {
      if (!window.require) {
        reject(new Error('Monaco loader missing global require'));
        return;
      }
      window.require.config({ paths: { vs: MONACO_BASE } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco));
    };
    script.onerror = () => reject(new Error('Unable to load Monaco editor'));
    if (!existing) {
      document.body.appendChild(script);
    }
  });
  return monacoPromise;
}

export default function PineConvert() {
  const [pine, setPine] = useState(SAMPLE_PINE);
  const [preview, setPreview] = useState('');
  const [mode, setMode] = useState<Mode>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  async function onConvert() {
    if (!pine.trim()) {
      setError('Provide a Pine script before converting.');
      return;
    }
    setDownloading(true);
    setError(null);
    setDownloadMessage(null);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/v1/trade-bots/pine/convert', {
        method: 'POST',
        headers,
        body: JSON.stringify({ pine })
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Conversion failed');
      }
      const previewHeader = res.headers.get('x-strategy-preview');
      const warningsHeader = res.headers.get('x-pine-warnings');
      const modeHeader = res.headers.get('x-pine-mode');
      setMode(modeHeader === 'webhook' ? 'webhook' : 'python');
      if (previewHeader) {
        try {
          const decoded = typeof window !== 'undefined' && typeof window.atob === 'function'
            ? window.atob(previewHeader)
            : previewHeader;
          setPreview(decoded);
        } catch {
          setPreview('[Unable to decode preview from response]');
        }
      }
      if (warningsHeader) {
        try {
          setWarnings(JSON.parse(decodeURIComponent(warningsHeader)));
        } catch {
          setWarnings([]);
        }
      } else {
        setWarnings([]);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pine-strategy-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadMessage('ZIP downloaded successfully. Preview updated below.');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to convert Pine script.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pine → Python Helper</h1>
          <p className="text-gray-500 max-w-2xl">
            Paste your Pine strategy, convert it into a Pendax Python skeleton, and download a ready-to-build ZIP. Unsupported features fall back to webhook mode automatically.
          </p>
        </div>
        <button
          className={`px-4 py-2 rounded text-white ${downloading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          onClick={onConvert}
          disabled={downloading}
        >
          {downloading ? 'Converting…' : 'Convert & Download'}
        </button>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Pine Script</h2>
            <span className="text-xs text-gray-500">Powered by Monaco Editor</span>
          </div>
          <MonacoEditor value={pine} onChange={setPine} />
          <div className="mt-2 text-xs text-gray-500">
            Need webhook mode instead? <Link to="/trade-bots" className="text-blue-600">Manage bots</Link>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="border rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">Conversion Mode</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{mode ? (mode === 'python' ? 'Python Strategy' : 'Webhook Fallback') : '—'}</div>
            </div>
            {mode && (
              <span className={`text-xs px-2 py-1 rounded ${mode === 'python' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {mode === 'python' ? 'Ready to build' : 'Use webhooks'}
              </span>
            )}
          </div>
          {downloadMessage && <div className="text-sm text-green-600">{downloadMessage}</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}
          {warnings.length > 0 && (
            <div className="border rounded-lg p-3 bg-yellow-50 text-sm text-yellow-900">
              <div className="font-semibold mb-1">Warnings</div>
              <ul className="list-disc list-inside space-y-1">
                {warnings.map((warn, idx) => (
                  <li key={idx}>{warn}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Python Preview</h3>
              <span className="text-xs text-gray-500">First 200 lines</span>
            </div>
            <div className="border rounded-lg bg-gray-900 text-green-100 text-xs font-mono h-96 overflow-auto p-3">
              {preview ? preview : 'Converted strategy will appear here after running the helper.'}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MonacoEditor({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    let subscription: any = null;
    ensureMonaco()
      .then((monaco) => {
        if (disposed || !containerRef.current) return;
        editorRef.current = monaco.editor.create(containerRef.current, {
          value,
          language: 'pine',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false }
        });
        subscription = editorRef.current.onDidChangeModelContent(() => {
          const nextValue = editorRef.current.getValue();
          onChange(nextValue);
        });
      })
      .catch((err) => {
        console.warn('Monaco failed to load', err);
      });
    return () => {
      disposed = true;
      if (subscription) subscription.dispose();
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (editorRef.current && editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value);
    }
  }, [value]);

  return <div ref={containerRef} className="border rounded-lg h-96 bg-gray-900" />;
}
