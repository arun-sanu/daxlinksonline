import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Activity, FileText, GanttChartSquare, GitBranch } from 'lucide-react';
import {
  fetchWorkflowNodes,
  fetchRoutingRules,
  fetchWorkflowConfig,
  fetchWorkflowEvents,
  fetchExecutionHistory,
  applyRoutingConfig,
  controlWorkflowAction,
  deleteWorkflow,
  controlWorkflowRuleAction,
  deleteWorkflowRule,
  createNode,
  simulateRouting
} from '../../../services/workflowApi';
import { listBots } from '../../../api/tradeBots';

const BOT_LINKS_STORAGE_KEY = 'dax_trade_bot_links_v1';
const BOT_CANONICAL_NAME = 'moneyplantbot1-robot';
type WorkflowRouteTabKey = 'graph' | 'pipeline' | 'rules' | 'logs-events';
type WorkflowTabKey = WorkflowRouteTabKey | 'overview';
const WORKFLOW_ROUTE_TAB_KEYS: WorkflowRouteTabKey[] = ['graph', 'pipeline', 'rules', 'logs-events'];

function isWorkflowRouteTabKey(value: string | null | undefined): value is WorkflowRouteTabKey {
  if (!value) return false;
  return WORKFLOW_ROUTE_TAB_KEYS.includes(value as WorkflowRouteTabKey);
}

const WORKFLOW_TAB_ITEMS: { key: WorkflowRouteTabKey; label: string; icon: LucideIcon }[] = [
  { key: 'graph', label: 'Graph', icon: GitBranch },
  { key: 'pipeline', label: 'Pipeline', icon: GanttChartSquare },
  { key: 'rules', label: 'Rules', icon: FileText },
  { key: 'logs-events', label: 'Logs + Events', icon: Activity }
];

type BotConnectivityLink = {
  webhookUrl?: string | null;
  integrationId?: string | null;
  exchangeAccountId?: string | null;
  updatedAt?: string | null;
};

type ConnectedBotWorkflowLink = {
  botId: string;
  integrationId: string;
  webhookUrl?: string | null;
};

type ConnectedBotCatalogItem = {
  id: string;
  name: string;
  type?: string;
  description?: string;
};

function normalizeBotName(name?: string | null) {
  if (String(name || '').trim().toLowerCase() === 'trade-exec-bot') {
    return BOT_CANONICAL_NAME;
  }
  return String(name || 'Bot');
}

function readBotConnectivityLinks(): Record<string, BotConnectivityLink> {
  try {
    const raw = localStorage.getItem(BOT_LINKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, BotConnectivityLink>;
  } catch {
    return {};
  }
}

function extractConnectedBotWorkflowLinks(map: Record<string, BotConnectivityLink>) {
  return Object.entries(map)
    .filter(([botId, link]) => {
      if (!botId) return false;
      return Boolean(link?.webhookUrl && link?.integrationId);
    })
    .map(([botId, link]) => ({
      botId,
      integrationId: String(link?.integrationId || ''),
      webhookUrl: link?.webhookUrl || null
    }))
    .filter((entry) => !!entry.integrationId);
}

function buildConnectedBotCatalog(bots: any[], connectedLinks: ConnectedBotWorkflowLink[]) {
  const byId = new Map<string, ConnectedBotCatalogItem>();
  for (const bot of toArray(bots)) {
    const id = String(bot?.id || '');
    if (!id) continue;
    byId.set(id, {
      id,
      name: normalizeBotName(bot?.name || bot?.label || bot?.title),
      type: bot?.kind || bot?.type || 'bot',
      description: bot?.description || ''
    });
  }
  const catalog: ConnectedBotCatalogItem[] = [];
  for (const link of connectedLinks) {
    const fromWorkspace = byId.get(link.botId);
    if (fromWorkspace) {
      catalog.push(fromWorkspace);
      continue;
    }
    catalog.push({
      id: link.botId,
      name: `Connected Bot ${link.botId.slice(0, 8)}`,
      type: 'bot',
      description: 'Connected in Trade Bots module'
    });
  }
  const dedup = new Map<string, ConnectedBotCatalogItem>();
  for (const item of catalog) {
    if (!dedup.has(item.id)) dedup.set(item.id, item);
  }
  return Array.from(dedup.values());
}

type NodeType = 'webhook' | 'bot' | 'logic' | 'vm' | 'source' | 'exchange' | 'bank' | 'wallet' | 'notification';
type NodeRole = 'source' | 'destination' | 'server';
type EdgeType = 'execute' | 'notify' | 'process' | 'analyze';
type StatusColor = 'green' | 'red' | 'yellow' | 'orange' | 'grey' | 'blue';

type WorkflowNode = {
  id: string;
  label: string;
  type: NodeType;
  role: NodeRole;
  isBridgeBot?: boolean;
  position: { x: number; y: number };
  status: StatusColor;
  health?: 'healthy' | 'warning' | 'critical' | 'pending' | 'inactive' | 'muted';
  lastEventAt?: number;
  description?: string;
  url?: string;
  subdomain?: string;
  dnsRecords?: { subdomain?: string; url?: string; status?: string }[];
  exchange?: string;
  apiKeyMasked?: string;
};

type WorkflowEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: EdgeType;
  statusColor: StatusColor;
  status?: string;
  severity: 'success' | 'error' | 'warning' | 'info';
  ruleId?: string;
  latencyMs?: number | null;
  transactionId?: string | null;
  lastEventAt?: number;
  enabled?: boolean;
};

function toArray(val: any) {
  return Array.isArray(val) ? val : [];
}

type WorkflowEvent = {
  id: string;
  ruleId?: string | null;
  sourceWebhookId?: string | null;
  destinationIntegrationId?: string | null;
  status: string;
  transactionId?: string | null;
  mappedOrder?: any;
  latencyMs?: number | null;
  createdAt: string;
};

type WorkflowExecution = {
  id: string;
  ruleId?: string | null;
  status: string;
  sourceWebhookId?: string | null;
  destinationIntegrationId?: string | null;
  transactionId?: string | null;
  mappedOrder?: any;
  attempts?: number;
  lastError?: string | null;
  responsePayload?: any;
  symbol?: string | null;
  size?: number | string | null;
  timestamp: string;
};

type RoutingRule = {
  id: string;
  sourceWebhookId: string;
  destinationIntegrationId: string;
  orderType?: string;
  sizeValue?: number | string;
  leverage?: number;
  symbols?: string[];
  minNotional?: number;
  allowedSides?: string[];
  enabled?: boolean;
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const CENTER = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 + 40 };
const NODE_WIDTH = 176;
const NODE_HEIGHT = 92;
const SERVER_WIDTH = 208;
const SERVER_HEIGHT = 108;
const PORT_RADIUS = 7;
const SERVER_ID = 'server-core';
type Mode = 'view' | 'create';
type PortKind = 'input' | 'output' | 'logic' | 'notify';
type WorkflowLifecycleAction = 'pause' | 'resume' | 'restart' | 'delete';
type WorkflowRuleLifecycleAction = 'pause' | 'resume' | 'restart' | 'delete';

function RuleModal({
  open,
  draft,
  sources,
  destinations,
  onClose,
  onSave
}: {
  open: boolean;
  draft: Partial<RoutingRule> | null | undefined;
  sources: WorkflowNode[];
  destinations: WorkflowNode[];
  onClose: () => void;
  onSave: (draft: Partial<RoutingRule>) => void;
}) {
  const [form, setForm] = useState<Partial<RoutingRule>>(draft || {});
  useEffect(() => {
    if (!open) return;
    setTimeout(() => {
      setForm(draft || {});
    }, 0);
  }, [draft, open]);
  if (!open || !draft) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0e13] p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-main">Routing Rule</p>
          <button className="text-xs text-gray-400" onClick={onClose}>Close</button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-200">
          <label className="space-y-1">
            <span className="text-gray-400">Source</span>
            <select
              className="w-full rounded border border-white/10 bg-transparent px-2 py-1"
              value={form.sourceWebhookId || ''}
              onChange={(e) => setForm((p) => ({ ...p, sourceWebhookId: e.target.value }))}
            >
              <option value="">Select source</option>
              {sources.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Destination</span>
            <select
              className="w-full rounded border border-white/10 bg-transparent px-2 py-1"
              value={form.destinationIntegrationId || ''}
              onChange={(e) => setForm((p) => ({ ...p, destinationIntegrationId: e.target.value }))}
            >
              <option value="">Select destination</option>
              {destinations.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Symbols (comma or *)</span>
            <input className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={(form.symbols || []).join(', ')} onChange={(e) => setForm((p) => ({ ...p, symbols: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Allowed Sides</span>
            <select className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={form.allowedSides as any} onChange={(e) => setForm((p) => ({ ...p, allowedSides: e.target.value ? [e.target.value] : [] }))}>
              <option value="both">Both</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Order Type</span>
            <select className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={form.orderType || 'market'} onChange={(e) => setForm((p) => ({ ...p, orderType: e.target.value }))}>
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Position Size Value</span>
            <input className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={form.sizeValue as any || ''} onChange={(e) => setForm((p) => ({ ...p, sizeValue: e.target.value }))} />
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Leverage (optional)</span>
            <input className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={form.leverage ?? ''} onChange={(e) => setForm((p) => ({ ...p, leverage: Number(e.target.value) || undefined }))} />
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">Min Notional</span>
            <input className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={form.minNotional ?? ''} onChange={(e) => setForm((p) => ({ ...p, minNotional: Number(e.target.value) || undefined }))} />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-gray-400">Risk Flags (comma)</span>
            <input className="w-full rounded border border-white/10 bg-transparent px-2 py-1" value={(form as any).riskFlags?.join(', ') || ''} onChange={(e) => setForm((p) => ({ ...p, riskFlags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled !== false} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
            Enabled
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary btn-small" onClick={onClose}>Cancel</button>
          <button className="btn btn-white-animated btn-small" onClick={() => onSave(form)}>Save Rule</button>
        </div>
      </div>
    </div>
  );
}

function CreateNodeModal({
  open,
  side,
  draft,
  onClose,
  onSave
}: {
  open: boolean;
  side: 'source' | 'destination';
  draft: { label: string; nodeType: string; description?: string } | null;
  onClose: () => void;
  onSave: (side: 'source' | 'destination', draft: { label: string; nodeType: string; description?: string }) => void;
}) {
  const templates = [
    { key: 'tradingview', label: 'TradingView Webhook', nodeType: 'webhook', description: 'Accepts alerts from TradingView or any webhook source.', side: 'source' as const },
    { key: 'bot', label: 'Bot', nodeType: 'bot', description: 'Custom bot emitting signals into the router.', side: 'source' as const },
    { key: 'exchange', label: 'Exchange', nodeType: 'exchange', description: 'Destination exchange adapter', side: 'destination' as const },
    { key: 'bank', label: 'Banking', nodeType: 'bank', description: 'Settlement / banking node', side: 'destination' as const },
    { key: 'notification', label: 'Notification', nodeType: 'notification', description: 'Notify channel (email/Slack/etc.)', side: 'destination' as const }
  ];
  const exchangeOptions = [
    { slug: 'binance', name: 'Binance', lanes: 'Spot · Futures' },
    { slug: 'mexc', name: 'MEXC', lanes: 'Spot · Futures' },
    { slug: 'okx', name: 'OKX', lanes: 'Unified account' },
    { slug: 'bybit', name: 'Bybit', lanes: 'USDT Perps · Linear' },
    { slug: 'zerodha', name: 'Zerodha', lanes: 'Kite equities · F&O' },
    { slug: 'bitget', name: 'Bitget', lanes: 'Spot · Futures' },
    { slug: 'kucoin', name: 'KuCoin', lanes: 'Spot · Futures' },
    { slug: 'phemex', name: 'Phemex', lanes: 'Perps · Spot' }
  ];
  const bankOptions = [
    { slug: 'hsbc', name: 'HSBC', lanes: 'Treasury / FX' },
    { slug: 'jpm', name: 'JPM', lanes: 'Wires / Settlements' },
    { slug: 'wallet', name: 'Custody Wallet', lanes: 'USDC / USDT' }
  ];
  const [selectedSide, setSelectedSide] = useState<'source' | 'destination'>(side);
  const emptyDraft = useMemo(() => ({ label: '', nodeType: '', description: '' }), []);
  const [form, setForm] = useState(draft || emptyDraft);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTimeout(() => {
      setSelectedSide(side);
      const hasMeaningfulDraft = !!draft && (draft.label || draft.description || draft.nodeType);
      const nextForm = hasMeaningfulDraft ? { label: draft?.label || '', nodeType: draft?.nodeType || '', description: draft?.description || '' } : emptyDraft;
      setForm(nextForm);
      const inferredTemplate = hasMeaningfulDraft
        ? draft?.nodeType === 'exchange'
          ? 'exchange'
          : draft?.nodeType === 'bank'
            ? 'bank'
            : draft?.nodeType === 'bot'
              ? 'bot'
              : draft?.nodeType === 'webhook'
                ? 'tradingview'
                : null
        : null;
      setSelectedTemplate(inferredTemplate);
    }, 0);
  }, [draft, side, open, emptyDraft]);
  return (
    <div
      className={`fixed inset-y-0 right-0 z-[120] w-full max-w-md transform bg-gradient-to-b from-[#0c0f17] via-[#0a0d15] to-[#080b12] shadow-2xl border-l border-white/10 transition-transform duration-200 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ backdropFilter: 'blur(12px)' }}
      aria-hidden={!open}
    >
      <div className="h-full flex flex-col p-5 space-y-4">
        <div className="flex items-start justify-between mt-6 relative">
          <div>
            <p className="text-xl font-semibold text-white">
              Create Node
              <span className="ml-1 animate-pulse">_</span>
            </p>
          </div>
          <button className="text-xs text-gray-400 hover:text-white absolute right-0 -top-6" onClick={onClose}>Close</button>
        </div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500 mt-3">Node family</div>
        <div className="flex flex-col gap-2 text-xs">
          <button
            className={`relative rounded-lg border px-3 py-2 text-left transition ${
              selectedSide === 'source' && (selectedTemplate === 'tradingview' || form.nodeType === 'webhook')
                ? 'border-white/10 bg-white/5 text-white'
                : 'border-white/10 text-gray-300 hover:border-white/30'
            }`}
            onClick={() => {
              setSelectedSide('source');
              setForm({ label: '', nodeType: 'webhook', description: '' });
              setSelectedTemplate(null);
            }}
          >
            {selectedSide === 'source' && (selectedTemplate === 'tradingview' || form.nodeType === 'webhook') && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1.5 rounded-full bg-gradient-to-b from-white via-primary-200 to-primary-400 shadow-[0_0_18px_rgba(96,165,250,0.9)]" />
            )}
            TradingView (Webhooks)
          </button>
          <button
            className={`relative rounded-lg border px-3 py-2 text-left transition ${selectedSide === 'source' && form.nodeType === 'bot' ? 'border-white/10 bg-white/5 text-white' : 'border-white/10 text-gray-300 hover:border-white/30'}`}
            onClick={() => {
              setSelectedSide('source');
              setForm({ label: '', nodeType: 'bot', description: '' });
              setSelectedTemplate(null);
            }}
          >
            {selectedSide === 'source' && form.nodeType === 'bot' && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1.5 rounded-full bg-gradient-to-b from-white via-primary-200 to-primary-400 shadow-[0_0_18px_rgba(96,165,250,0.9)]" />
            )}
            Trade Bots
          </button>
          <button
            className={`relative rounded-lg border px-3 py-2 text-left transition ${selectedSide === 'destination' ? 'border-white/10 bg-white/5 text-white' : 'border-white/10 text-gray-300 hover:border-white/30'}`}
            onClick={() => {
              setSelectedSide('destination');
              setForm({ label: '', nodeType: 'exchange', description: '' });
              setSelectedTemplate(null);
            }}
          >
            {selectedSide === 'destination' && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1.5 rounded-full bg-gradient-to-b from-white via-primary-200 to-primary-400 shadow-[0_0_18px_rgba(96,165,250,0.9)]" />
            )}
            Destinations (Exchanges/Banks)
          </button>
        </div>
        <div className="my-6 h-px w-full bg-white/10 rounded-full" />
        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Templates</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
                {templates
                  .filter((tpl) => tpl.side === selectedSide)
                  .filter((tpl) => !(selectedSide === 'source' && form.nodeType !== 'bot' && tpl.nodeType === 'bot'))
                  .filter((tpl) => !(selectedSide === 'source' && form.nodeType === 'bot' && tpl.nodeType === 'webhook'))
                  .map((tpl) => (
                    <button
                      key={tpl.key}
                      className={`rounded-xl border px-3 py-2 text-left transition ${
                        selectedTemplate === tpl.key
                          ? 'border-primary-300/70 bg-primary-500/10 text-white shadow-[0_8px_28px_rgba(99,102,241,0.18)]'
                          : 'border-white/10 text-gray-200 hover:border-white/30 hover:bg-white/5'
                      }`}
                      onClick={() => {
                        setSelectedTemplate(tpl.key);
                        setForm({ label: tpl.label, nodeType: tpl.nodeType, description: tpl.description });
                      }}
                    >
                <p className="font-semibold">{tpl.label}</p>
                <p className="text-gray-400 text-[11px] leading-snug">{tpl.description}</p>
              </button>
            ))}
        </div>
        <div className="space-y-2 text-xs text-gray-200 bg-white/5 border border-white/10 rounded-xl p-3">
          <label className="space-y-1 block">
            <span className="text-gray-400">Label</span>
            <input className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm" value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} />
          </label>
          {selectedSide === 'destination' && form.nodeType === 'exchange' && selectedTemplate === 'exchange' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Available exchanges</p>
                <div className="flex flex-wrap gap-2">
                  {exchangeOptions.map((ex) => (
                    <button
                      key={ex.slug}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-gray-200 hover:border-white/30"
                      onClick={() => setForm((p) => ({ ...p, label: ex.name, description: ex.lanes, nodeType: 'exchange' }))}
                    >
                      {ex.name} <span className="text-gray-500">({ex.lanes})</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="space-y-1 block">
                <span className="text-gray-400">Account (label your sub-account)</span>
                <input className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm" value={(form as any).account || ''} onChange={(e) => setForm((p: any) => ({ ...p, account: e.target.value }))} />
              </label>
            </div>
          )}
          {selectedSide === 'destination' && form.nodeType === 'bank' && selectedTemplate === 'bank' && (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Available banks / wallets</p>
              <div className="flex flex-wrap gap-2">
                {bankOptions.map((b) => (
                  <button
                    key={b.slug}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-gray-200 hover:border-white/30"
                    onClick={() => setForm((p) => ({ ...p, label: b.name, description: b.lanes, nodeType: 'bank' }))}
                  >
                    {b.name} <span className="text-gray-500">({b.lanes})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="space-y-1 block">
            <span className="text-gray-400">Node Type (Modules)</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-gray-200"
              value={form.nodeType ? form.nodeType.charAt(0).toUpperCase() + form.nodeType.slice(1) : ''}
              readOnly
              disabled
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-gray-400">Description</span>
            <textarea className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm" value={form.description || ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </label>
        </div>
        <div className="flex justify-between items-center mt-auto pt-2 text-xs text-gray-400">
          <div>
            <p className="text-gray-300">Tip</p>
            <p>Nodes appear on the {selectedSide === 'source' ? 'left (sources)' : 'right (destinations)'} of the canvas.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-small" onClick={onClose}>Cancel</button>
            <button
              className={`btn btn-white-animated btn-small ${!form.nodeType ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!form.nodeType}
              onClick={() => onSave(selectedSide, form)}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function classifyNodeTypeFromIntegration(type: string | undefined): NodeType {
  if (!type) return 'exchange';
  const t = type.toLowerCase();
  if (t.includes('bank') || t.includes('wallet')) return 'bank';
  if (t.includes('notify')) return 'notification';
  return 'exchange';
}

function colorFromStatus(status: string): StatusColor {
  const s = status.toLowerCase();
  if (s.includes('success')) return 'green';
  if (s.includes('error')) return 'red';
  if (s.includes('retry')) return 'orange';
  if (s.includes('skip')) return 'grey';
  if (s.includes('ready')) return 'blue';
  return 'blue';
}

function layoutNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const nodesArr = toArray(nodes);
  if (!nodesArr.length) {
    console.warn('[WM] layoutNodes received empty or invalid nodes array.');
    return [];
  }
  const centerY = CENTER.y;
  const minY = 120;
  const maxY = CANVAS_HEIGHT - 120;
  const stagePadding = 56;
  const sourceX = 260;
  const serverXWithBridge = CENTER.x;
  const bridgeX = 820;
  const destinationXWithBridge = CANVAS_WIDTH - stagePadding - NODE_WIDTH / 2;
  const serverXDefault = CENTER.x;
  const destinationXDefault = 920;
  const sourceXDefault = 300;

  const left = nodesArr.filter((n) => n.role === 'source');
  const rightBridge = nodesArr.filter((n) => n.role === 'destination' && n.isBridgeBot);
  const right = nodesArr.filter((n) => n.role === 'destination' && !n.isBridgeBot);
  const hasBridgeLane = rightBridge.length > 0;

  function computePositions(list: WorkflowNode[], x: number) {
    if (!list.length) return [];
    const spacing = list.length > 1 ? Math.min(150, (maxY - minY) / (list.length - 1)) : 0;
    let startY = centerY - (spacing * (list.length - 1)) / 2;
    if (startY < minY) startY = minY;
    if (startY + spacing * (list.length - 1) > maxY) {
      startY = maxY - spacing * (list.length - 1);
    }
    return list.map((n, idx) => ({
      ...n,
      position: { x, y: startY + idx * spacing }
    }));
  }

  const placedLeft = computePositions(left, hasBridgeLane ? sourceX : sourceXDefault);
  const placedBridge = computePositions(rightBridge, bridgeX);
  const placedRight = computePositions(right, hasBridgeLane ? destinationXWithBridge : destinationXDefault);
  const routerX = hasBridgeLane ? serverXWithBridge : serverXDefault;

  try {
    const placedNodes = nodesArr.map((n) => {
      if (n.role === 'server') return { ...n, position: { x: routerX, y: centerY } };
      const placed =
        placedLeft.find((p) => p.id === n.id) || placedBridge.find((p) => p.id === n.id) || placedRight.find((p) => p.id === n.id) || null;
      return placed ?? n;
    });
    console.log('[WM] Placed nodes:', placedNodes);
    return placedNodes;
  } catch (err) {
    console.error('[WM] layoutNodes mapping error', err);
    return nodesArr;
  }
}

function applyNodeHealth(nodes: WorkflowNode[], edges: WorkflowEdge[], events: WorkflowEvent[]): WorkflowNode[] {
  const now = Date.now();
  const byRule = new Map<string, WorkflowEvent>();
  events.forEach((evt) => {
    if (evt.ruleId && !byRule.has(evt.ruleId)) {
      byRule.set(evt.ruleId, evt);
    }
  });
  const nodeLast: Record<string, { ts?: number; status?: string; attempts?: number; enabled?: boolean }> = {};
  edges.forEach((edge) => {
    const evt = edge.ruleId ? byRule.get(edge.ruleId) : undefined;
    const ts = edge.lastEventAt || (evt?.createdAt ? new Date(evt.createdAt).getTime() : undefined);
    const existing = nodeLast[edge.sourceNodeId] || {};
    const existing2 = nodeLast[edge.targetNodeId] || {};
    const payloadAttempts = (evt as any)?.attempts;
    nodeLast[edge.sourceNodeId] = {
      ts: ts && (!existing.ts || ts > existing.ts) ? ts : existing.ts,
      status: evt?.status || existing.status,
      attempts: payloadAttempts != null ? payloadAttempts : existing.attempts,
      enabled: edge.enabled
    };
    nodeLast[edge.targetNodeId] = {
      ts: ts && (!existing2.ts || ts > existing2.ts) ? ts : existing2.ts,
      status: evt?.status || existing2.status,
      attempts: payloadAttempts != null ? payloadAttempts : existing2.attempts,
      enabled: edge.enabled
    };
  });

  function statusToHealth(status?: string, ts?: number, attempts?: number, enabled?: boolean): { health: WorkflowNode['health']; statusColor: StatusColor; lastEventAt?: number } {
    const s = (status || '').toLowerCase();
    const ageMs = ts ? now - ts : Infinity;
    if (enabled === false) return { health: 'muted', statusColor: 'grey', lastEventAt: ts };
    if (!status && ageMs === Infinity) return { health: 'muted', statusColor: 'grey', lastEventAt: ts };
    if (ageMs > 24 * 60 * 60 * 1000) return { health: 'inactive', statusColor: 'grey', lastEventAt: ts };
    if (s.includes('error') || s.includes('failed') || s.includes('executed_error')) return { health: 'critical', statusColor: 'red', lastEventAt: ts };
    if (s.includes('retry') || (attempts || 0) > 0) return { health: 'warning', statusColor: 'orange', lastEventAt: ts };
    if (s.includes('ready')) return { health: 'pending', statusColor: 'blue', lastEventAt: ts };
    if (s.includes('success') || s.includes('executed_success')) return { health: 'healthy', statusColor: 'green', lastEventAt: ts };
    return { health: 'pending', statusColor: 'blue', lastEventAt: ts };
  }

  return nodes.map((n) => {
    const info = nodeLast[n.id] || {};
    const mapped = statusToHealth(info.status, info.ts, info.attempts, info.enabled);
    return { ...n, health: mapped.health, status: mapped.statusColor, lastEventAt: mapped.lastEventAt };
  });
}

function getAnchor(node: WorkflowNode, side: 'left' | 'right') {
  const width = node.role === 'server' ? SERVER_WIDTH : NODE_WIDTH;
  const halfW = width / 2;
  const x = side === 'left' ? node.position.x - halfW : node.position.x + halfW;
  return { x, y: node.position.y };
}

function NodeBadge({
  node,
  onSelect,
  mode,
  selectedSource,
  onPortMouseDown,
  onPortEnter,
  onPortLeave
}: {
  node: WorkflowNode;
  onSelect: (id: string, node: WorkflowNode) => void;
  mode: Mode;
  selectedSource: string | null;
  onPortMouseDown: (node: WorkflowNode, portKind: PortKind) => void;
  onPortEnter: (node: WorkflowNode, portKind: PortKind) => void;
  onPortLeave: () => void;
}) {
  const tone =
    node.type === 'webhook' || node.role === 'source'
      ? 'border-sky-300 text-sky-100'
      : node.type === 'exchange'
        ? 'border-emerald-300 text-emerald-100'
        : 'border-purple-300 text-purple-100';
  const width = node.role === 'server' ? SERVER_WIDTH : NODE_WIDTH;
  const height = node.role === 'server' ? SERVER_HEIGHT : NODE_HEIGHT;
  const sizeStyle = { width, height };
  const highlight =
    node.role === 'source' && mode === 'create'
      ? selectedSource === node.id
        ? 'ring-2 ring-sky-300'
        : ''
      : node.role === 'destination' && mode === 'create'
        ? selectedSource
          ? 'ring-2 ring-emerald-300'
          : ''
        : '';
  const badge = (() => {
    switch (node.health) {
      case 'critical':
        return { text: '⛔', cls: 'text-red-300' };
      case 'warning':
        return { text: '⚠', cls: 'text-amber-300' };
      case 'pending':
        return { text: '⏳', cls: 'text-sky-300' };
      case 'inactive':
        return { text: '💤', cls: 'text-gray-400' };
      case 'muted':
        return { text: '⚪', cls: 'text-gray-400' };
      case 'healthy':
        return { text: '💚', cls: 'text-emerald-300' };
      default:
        return null;
    }
  })();
  if (!node || !node.position) {
    console.error('[WM] NodeBadge missing node or position', node);
    return null;
  }
  return (
    <div
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border ${tone} workflow-node-glass px-4 py-3 shadow-lg text-center flex flex-col justify-center ${highlight}`}
      style={{ left: node.position.x, top: node.position.y, ...sizeStyle }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id, node);
      }}
    >
      {console.log('[WM] Rendering node:', node.id, node.label, node.position)}
      {badge && <span className={`absolute -right-2 -top-2 text-sm ${badge.cls}`}>{badge.text}</span>}
      <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">
        {node.role === 'server' ? 'Core Router' : node.type}
      </p>
      <p className="text-sm font-semibold text-white">{node.label}</p>
      {/* Ports */}
      {node.role !== 'destination' && (
        <div
          className="absolute"
          style={{ right: -PORT_RADIUS, top: '50%', transform: 'translateY(-50%)' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onPortMouseDown(node, 'output');
          }}
          onMouseEnter={() => onPortEnter(node, 'output')}
          onMouseLeave={onPortLeave}
        >
          <span
            className="block rounded-full border border-sky-300 bg-sky-500/30 shadow-[0_0_12px_rgba(56,189,248,0.6)]"
            style={{ width: PORT_RADIUS * 2, height: PORT_RADIUS * 2 }}
          />
        </div>
      )}
      {node.role !== 'source' && (
        <div
          className="absolute"
          style={{ left: -PORT_RADIUS, top: '50%', transform: 'translateY(-50%)' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onPortMouseDown(node, 'input');
          }}
          onMouseEnter={() => onPortEnter(node, 'input')}
          onMouseLeave={onPortLeave}
        >
          <span
            className="block rounded-full border border-emerald-300 bg-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.6)]"
            style={{ width: PORT_RADIUS * 2, height: PORT_RADIUS * 2 }}
          />
        </div>
      )}
      {node.role === 'server' && (
        <>
          <div
            className="absolute"
            style={{ top: -PORT_RADIUS, left: '50%', transform: 'translateX(-50%)' }}
            onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown(node, 'input'); }}
            onMouseEnter={() => onPortEnter(node, 'input')}
            onMouseLeave={onPortLeave}
          >
            <span
              className="block rounded-full border border-sky-300 bg-sky-500/30 shadow-[0_0_12px_rgba(56,189,248,0.6)]"
              style={{ width: PORT_RADIUS * 2, height: PORT_RADIUS * 2 }}
            />
          </div>
          <div
            className="absolute"
            style={{ bottom: -PORT_RADIUS, left: '50%', transform: 'translateX(-50%)' }}
            onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown(node, 'notify'); }}
            onMouseEnter={() => onPortEnter(node, 'notify')}
            onMouseLeave={onPortLeave}
          >
            <span
              className="block rounded-full border border-amber-300 bg-amber-500/30 shadow-[0_0_12px_rgba(251,191,36,0.6)]"
              style={{ width: PORT_RADIUS * 2, height: PORT_RADIUS * 2 }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function shortTime(ts?: string | number | Date | null) {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function since(ts?: string | number | Date | null) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function EdgeLine({ edge, nodes, onSelect }: { edge: WorkflowEdge; nodes: WorkflowNode[]; onSelect: (id: string) => void }) {
  const src = nodes.find((n) => n.id === edge.sourceNodeId);
  const dst = nodes.find((n) => n.id === edge.targetNodeId);
  if (!src || !dst) return null;
  const start = src.role === 'source' ? getAnchor(src, 'right') : src.role === 'server' ? getAnchor(src, 'right') : getAnchor(src, 'right');
  const end = dst.role === 'server' ? getAnchor(dst, 'left') : dst.role === 'destination' ? getAnchor(dst, 'left') : getAnchor(dst, 'left');
  const stroke = edge.statusColor === 'green' ? '#34d399' : edge.statusColor === 'red' ? '#f87171' : edge.statusColor === 'orange' ? '#fb923c' : edge.statusColor === 'grey' ? '#9ca3af' : '#38bdf8';
  const midX = (start.x + end.x) / 2;
  const isSuccess = edge.status?.includes('success') || edge.statusColor === 'green';
  const isError = edge.status?.includes('error') || edge.statusColor === 'red';
  const isRetry = edge.status?.includes('retry') || edge.statusColor === 'orange';
  return (
    <>
      <path
        d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
        stroke={stroke}
        strokeWidth={edge.enabled === false ? 2 : 2.4}
        fill="none"
        className={`opacity-90 ${edge.enabled === false ? 'stroke-dasharray-[6_6]' : ''} ${isRetry ? 'animate-pulse' : ''}`}
        onClick={() => onSelect(edge.id)}
        style={{ cursor: 'pointer', filter: isError ? 'drop-shadow(0 0 6px rgba(248,113,113,0.6))' : undefined }}
      />
      {edge.enabled !== false && (
        <path
          d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
          stroke={stroke}
          strokeWidth={1.8}
          fill="none"
          className="workflow-edge-flow"
        />
      )}
      {isSuccess && (
        <circle
          cx={(start.x + end.x) / 2}
          cy={(start.y + end.y) / 2}
          r={4}
          fill="#34d399"
          className="animate-ping"
          style={{ animationDuration: '1.6s' }}
        />
      )}
    </>
  );
}

export default function WorkflowModule() {
  console.log('[WM] Render started');
  const { tabId } = useParams<{ tabId?: string }>();
  const navigate = useNavigate();
  const activeTab: WorkflowTabKey = isWorkflowRouteTabKey(tabId) ? tabId : 'overview';
  const [nodes, setNodes] = useState<WorkflowNode[] | null>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [connectedBotLinks, setConnectedBotLinks] = useState<ConnectedBotWorkflowLink[]>([]);
  const [connectedBotCatalog, setConnectedBotCatalog] = useState<ConnectedBotCatalogItem[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [detailInfo, setDetailInfo] = useState<{ kind: 'execution' | 'event'; data: any } | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [zoom, setZoom] = useState(1);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [ruleModal, setRuleModal] = useState<{ open: boolean; draft?: Partial<RoutingRule> | null }>({ open: false, draft: null });
  const [createNodeModal, setCreateNodeModal] = useState<{ open: boolean; side: 'source' | 'destination'; draft: { label: string; nodeType: string; description?: string } | null }>({
    open: false,
    side: 'source',
    draft: null
  });
  const [dragConnection, setDragConnection] = useState<{ start: { x: number; y: number }; current: { x: number; y: number }; fromNodeId: string; fromRole: NodeRole } | null>(null);
  const [hoverPort, setHoverPort] = useState<{ nodeId: string; role: NodeRole; portKind: PortKind } | null>(null);
  const [simPreview, setSimPreview] = useState<{ message: string; severity: 'ok' | 'error'; data?: any; x: number; y: number } | null>(null);
  const [activityTab, setActivityTab] = useState<'executions' | 'events'>('executions');
  const [savingRules, setSavingRules] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<'active' | 'paused'>('active');
  const [workflowActionInFlight, setWorkflowActionInFlight] = useState<WorkflowLifecycleAction | null>(null);
  const [ruleActionTargetId, setRuleActionTargetId] = useState<string | null>(null);
  const [ruleActionInFlight, setRuleActionInFlight] = useState<WorkflowRuleLifecycleAction | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    if (tabId === 'overview') {
      navigate('/platform/workflow', { replace: true });
      return;
    }
    if (tabId && !isWorkflowRouteTabKey(tabId)) {
      navigate('/platform/workflow', { replace: true });
    }
  }, [navigate, tabId]);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const updateScale = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const paddedWidth = Math.max(0, rect.width - 240);
      const paddedHeight = Math.max(0, rect.height - 200);
      const scale = Math.min(paddedWidth / CANVAS_WIDTH, paddedHeight / CANVAS_HEIGHT);
      const clamped = Math.min(0.92, Math.max(0.5, scale));
      setFitScale(Number.isFinite(clamped) && clamped > 0 ? clamped : 1);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  useEffect(() => {
    const safeNodes = toArray(nodes);
    const safeRules = toArray(rules);
    const safeEvents = toArray(events);
    const safeEdges = toArray(edges);
    const safeExecs = toArray(executions);
    console.log({ nodes: safeNodes, rules: safeRules, events: safeEvents, edges: safeEdges, executions: safeExecs });
    console.log('[WM] SafeNodes:', safeNodes);
    console.log('[WM] SafeEdges:', safeEdges);
    console.log('[WM] SafeRules:', safeRules);
  }, [nodes, rules, events, edges, executions]);
  let safeNodes = toArray(nodes);
  const safeRules = toArray(rules);
  const safeEvents = toArray(events);
  const safeEdges = toArray(edges);
  let safeExecs = toArray(executions);
  const recentExecutions = useMemo(() => safeExecs.slice(0, 25), [safeExecs]);
  const recentEvents = useMemo(() => safeEvents.slice(0, 25), [safeEvents]);
  if (!safeNodes.length) {
    console.warn('[WM] Nothing to render — injecting fallback server node.');
    safeNodes = [
      { id: SERVER_ID, label: 'DaxLinks Router', role: 'server', type: 'logic', position: CENTER, status: 'green' as StatusColor }
    ];
  }
  const placedNodes = safeNodes;
  console.log('[WM] placedNodes:', placedNodes);

  const workspaceId = useMemo(() => {
    try {
      const stored = localStorage.getItem('workspaceId');
      return stored || '';
    } catch {
      return '';
    }
  }, []);
  const workspaceReady = useMemo(() => !!workspaceId && workspaceId !== '00000000-0000-0000-0000-000000000000', [workspaceId]);
  console.log({ workspaceId });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
  };

  function buildNodes(
    webhooks: any[],
    bots: any[],
    integrations: any[],
    connectedCatalog: ConnectedBotCatalogItem[] = [],
    connectedLinks: ConnectedBotWorkflowLink[] = []
  ): WorkflowNode[] {
    const server: WorkflowNode = { id: SERVER_ID, label: 'DaxLinks Router', type: 'logic', role: 'server', status: 'green', position: { x: CENTER.x, y: CENTER.y } };
    const connectedSet = new Set(connectedLinks.map((link) => link.botId));
    const botMap = new Map<string, any>();
    for (const bot of toArray(bots)) {
      if (!bot?.id) continue;
      botMap.set(String(bot.id), bot);
    }
    for (const bot of connectedCatalog) {
      if (!bot?.id) continue;
      if (!botMap.has(bot.id)) {
        botMap.set(bot.id, { id: bot.id, name: bot.name, type: bot.type || 'bot', description: bot.description || '' });
      }
    }
    const mergedBots = Array.from(botMap.values());
    const src: WorkflowNode[] = [
      ...webhooks.map((w) => ({
        id: w.id,
        label: w.name || w.label || 'Webhook',
        type: 'webhook',
        role: 'source',
        status: 'green',
        position: { x: 0, y: 0 },
        description: w.description || '',
        url: w.url || '',
        subdomain: w.subdomain || '',
        dnsRecords: Array.isArray(w.dnsRecords) ? w.dnsRecords : []
      })),
      ...mergedBots.map((b) => {
        const connected = connectedSet.has(String(b.id));
        return {
          id: b.id,
          label: normalizeBotName(b.name || 'Bot'),
          type: 'bot',
          role: connected ? 'destination' : 'source',
          isBridgeBot: connected,
          status: 'green',
          position: { x: 0, y: 0 },
          description: b.description || ''
        } as WorkflowNode;
      })
    ];
    const dst: WorkflowNode[] = integrations.map((i) => ({
      id: i.id,
      label: i.name || i.label || i.exchange || 'Integration',
      type: classifyNodeTypeFromIntegration(i.type),
      role: 'destination',
      status: 'green',
      position: { x: 0, y: 0 },
      exchange: i.exchange || '',
      apiKeyMasked: i.apiKeyMasked || '',
      description: i.description || ''
    }));
    const finalNodes = [server, ...src, ...dst];
    console.log('[WM] Pre-layout nodes:', finalNodes);
    if (!finalNodes.length) return finalNodes;
    try {
      const placed = layoutNodes(finalNodes);
      console.log('[WM] Placed nodes:', placed);
      return placed;
    } catch (err) {
      console.error('[WM] layoutNodes error', err);
      return finalNodes;
    }
  }

  function buildEdges(
    nodesList: WorkflowNode[],
    rulesList: RoutingRule[],
    eventList: WorkflowEvent[],
    connectedLinks: ConnectedBotWorkflowLink[] = []
  ): WorkflowEdge[] {
    if (!nodesList || nodesList.length === 0) return [];
    const edgesBuilt: WorkflowEdge[] = [];
    rulesList.forEach((rule) => {
      if (!rule.sourceWebhookId || !rule.destinationIntegrationId) return;
      if (rule.enabled === false) {
        // still render but muted/dashed
      }
      const evt = eventList.find((e) => e.ruleId === rule.id);
      const statusColor = evt ? colorFromStatus(evt.status) : 'blue';
      const lastEventAt = evt?.createdAt ? new Date(evt.createdAt).getTime() : undefined;
      const sourceEdge: WorkflowEdge = {
        id: `edge-${rule.id}-src`,
        sourceNodeId: rule.sourceWebhookId,
        targetNodeId: SERVER_ID,
        edgeType: 'analyze',
        statusColor: rule.enabled === false ? 'grey' : statusColor,
        severity: 'info',
        status: evt?.status,
        ruleId: rule.id,
        latencyMs: evt?.latencyMs || null,
        transactionId: evt?.transactionId || null,
        enabled: rule.enabled !== false,
        lastEventAt
      };
      const targetEdge: WorkflowEdge = {
        id: `edge-${rule.id}-dst`,
        sourceNodeId: SERVER_ID,
        targetNodeId: rule.destinationIntegrationId,
        edgeType: classifyNodeTypeFromIntegration(nodesList.find((n) => n.id === rule.destinationIntegrationId)?.type) === 'notification' ? 'notify' : 'execute',
        statusColor: rule.enabled === false ? 'grey' : statusColor,
        severity: 'info',
        status: evt?.status,
        ruleId: rule.id,
        latencyMs: evt?.latencyMs || null,
        transactionId: evt?.transactionId || null,
        enabled: rule.enabled !== false,
        lastEventAt
      };
      edgesBuilt.push(sourceEdge, targetEdge);
    });
    const now = Date.now();
    const keySet = new Set(edgesBuilt.map((edge) => `${edge.sourceNodeId}::${edge.targetNodeId}`));
    const addEdge = (edge: WorkflowEdge) => {
      const key = `${edge.sourceNodeId}::${edge.targetNodeId}`;
      if (keySet.has(key)) return;
      keySet.add(key);
      edgesBuilt.push(edge);
    };
    connectedLinks.forEach((link) => {
      const botNode = nodesList.find((node) => node.id === link.botId);
      if (!botNode) return;
      const integrationNode = nodesList.find((node) => node.id === link.integrationId);
      const webhookNode = link.webhookUrl
        ? nodesList.find((node) => node.role === 'source' && node.type === 'webhook' && node.url === link.webhookUrl)
        : null;
      if (webhookNode) {
        addEdge({
          id: `edge-connected-${link.botId}-ingress`,
          sourceNodeId: webhookNode.id,
          targetNodeId: SERVER_ID,
          edgeType: 'analyze',
          statusColor: 'green',
          severity: 'info',
          status: 'connected_success',
          enabled: true,
          lastEventAt: now
        });
      }
      addEdge({
        id: `edge-connected-${link.botId}-src`,
        sourceNodeId: SERVER_ID,
        targetNodeId: link.botId,
        edgeType: 'process',
        statusColor: 'green',
        severity: 'info',
        status: 'connected_success',
        enabled: true,
        lastEventAt: now
      });
      if (integrationNode) {
        addEdge({
          id: `edge-connected-${link.botId}-${link.integrationId}-dst`,
          sourceNodeId: link.botId,
          targetNodeId: link.integrationId,
          edgeType: 'execute',
          statusColor: 'green',
          severity: 'info',
          status: 'connected_success',
          enabled: true,
          lastEventAt: now
        });
      }
    });
    return edgesBuilt;
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      if (!workspaceReady) {
        setError('Workspace ID missing or placeholder. Log in again to load workflow data.');
        setLoading(false);
        return;
      }
      try {
        const [nodesRespRaw, rulesRespRaw, eventsRespRaw, workflowConfigResp, tradeBotsResp] = await Promise.all([
          fetchWorkflowNodes(workspaceId),
          fetchRoutingRules(workspaceId),
          fetchWorkflowEvents(workspaceId),
          fetchWorkflowConfig(workspaceId),
          listBots().catch(() => ({ items: [] }))
        ]);
        const nodesResp = nodesRespRaw && typeof nodesRespRaw === 'object' ? nodesRespRaw : {};
        const rulesResp = toArray(rulesRespRaw);
        const eventsResp = toArray(eventsRespRaw);
        const statusRaw = String((workflowConfigResp as any)?.workflowConfig?.status || 'active').toLowerCase();
        const resolvedStatus = statusRaw === 'paused' ? 'paused' : 'active';
        const { webhooks = [], bots = [], integrations = [] } = nodesResp || {};
        const linksMap = readBotConnectivityLinks();
        const connectedLinks = extractConnectedBotWorkflowLinks(linksMap);
        const workspaceBots = toArray((tradeBotsResp as any)?.items).map((bot: any) => ({
          ...bot,
          name: normalizeBotName(bot?.name || bot?.label || 'Bot')
        }));
        const connectedCatalog = buildConnectedBotCatalog(workspaceBots, connectedLinks);
        if (!mounted) return;
        setConnectedBotLinks(connectedLinks);
        setConnectedBotCatalog(connectedCatalog);
        setWorkflowStatus(resolvedStatus);
        const nodesBuilt = buildNodes(toArray(webhooks), toArray(bots), toArray(integrations), connectedCatalog, connectedLinks);
        console.log('[WM] Nodes loaded:', nodesBuilt);
        const edgesBuilt = buildEdges(nodesBuilt, rulesResp, eventsResp, connectedLinks);
        const nodesWithHealth = applyNodeHealth(nodesBuilt, edgesBuilt, eventsResp);
        setNodes(nodesWithHealth);
        setEdges(edgesBuilt);
        setRules(rulesResp);
        setEvents(eventsResp);
        console.log('[WM] Rules loaded:', rulesResp);
        console.log('[WM] Events loaded:', eventsResp);
        const execs = await fetchExecutionHistory(workspaceId);
        if (mounted) setExecutions(toArray(execs));
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || 'Failed to load workflow data');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workspaceId, workspaceReady, reloadNonce]);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      if (!dragConnection) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const scale = fitScale * zoom;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      setDragConnection((prev) => (prev ? { ...prev, current: { x, y } } : null));
    }
    function handleUp() {
      if (dragConnection && hoverPort) {
        const fromRole = dragConnection.fromRole;
        const toRole = hoverPort.role;
        const isSourceToServer = fromRole === 'source' && hoverPort.nodeId === SERVER_ID;
        const isServerToDestination = fromRole === 'server' && toRole === 'destination';

        // First leg: lock source selection
        if (isSourceToServer) {
          setSelectedSource(dragConnection.fromNodeId);
          setSimPreview({
            message: 'Source locked — now drag from server to a destination.',
            severity: 'ok',
            x: dragConnection.current.x,
            y: dragConnection.current.y
          });
          setTimeout(() => setSimPreview(null), 2500);
        }

        // Second leg: preview + open modal
        if (isServerToDestination) {
          const sourceId = selectedSource || dragConnection.fromNodeId;
          const destinationId = hoverPort.nodeId;
          if (!sourceId) {
            setSimPreview({
              message: 'Select a source first (drag a webhook into the server).',
              severity: 'error',
              x: dragConnection.current.x,
              y: dragConnection.current.y
            });
            setTimeout(() => setSimPreview(null), 2500);
          } else {
            if (!workspaceReady) {
              setError('Workspace ID missing or placeholder. Log in again to simulate routing.');
              return;
            }
            simulateRouting(workspaceId, sourceId, destinationId)
              .then((res) => {
                const hasMatch = Array.isArray(res?.matchedRules) && res.matchedRules.length > 0;
                const simRule = res?.matchedRules?.[0];
                const skippedReason = Array.isArray(res?.skippedRules) && res.skippedRules.length > 0 ? res.skippedRules[0].reason : null;
                setSimPreview({
                  message: hasMatch ? 'Route looks valid — open rule editor.' : skippedReason ? `Skipped: ${skippedReason}` : 'No rules would match this path.',
                  severity: hasMatch ? 'ok' : 'error',
                  data: simRule,
                  x: dragConnection.current.x,
                  y: dragConnection.current.y
                });
                setTimeout(() => setSimPreview(null), 3500);
                setRuleModal({
                  open: true,
                  draft: {
                    sourceWebhookId: sourceId,
                    destinationIntegrationId: destinationId,
                    enabled: true,
                    symbols: simRule?.conditions?.symbols || simRule?.symbols,
                    allowedSides: simRule?.conditions?.allowedSides || simRule?.allowedSides,
                    minNotional: simRule?.conditions?.minNotional,
                    leverage: simRule?.mapping?.leverage || simRule?.maxLeverage,
                    sizeValue: simRule?.mapping?.positionSizeValue || simRule?.sizeValue,
                    orderType: simRule?.mapping?.orderType || simRule?.orderType
                  }
                });
              })
              .catch(() => {
                setSimPreview({
                  message: 'Simulation failed',
                  severity: 'error',
                  x: dragConnection.current.x,
                  y: dragConnection.current.y
                });
                setTimeout(() => setSimPreview(null), 3000);
                setRuleModal({
                  open: true,
                  draft: {
                    sourceWebhookId: sourceId,
                    destinationIntegrationId: destinationId,
                    enabled: true
                  }
                });
              });
          }
        }
      }
      setDragConnection(null);
      setHoverPort(null);
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragConnection, hoverPort, selectedSource, workspaceId, fitScale, zoom]);

  async function handleSaveRule(draft: Partial<RoutingRule>) {
    if (!workspaceReady) {
      setError('Workspace ID missing or placeholder. Log in again to save routing rules.');
      return;
    }
    const safeRuleList = Array.isArray(rules) ? rules : [];
    const sourceWebhookId = draft.sourceWebhookId || selectedSource || '';
    const destinationIntegrationId = draft.destinationIntegrationId || '';
    if (!sourceWebhookId || !destinationIntegrationId) {
      setError('Select a source and destination to save a rule.');
      return;
    }
    setSavingRules(true);
    try {
      const ruleId = draft.id || `rule-${Date.now()}`;
      const baseRule = {
        id: ruleId,
        sourceWebhookId,
        destinationIntegrationId,
        orderType: draft.orderType || 'market',
        sizeValue: draft.sizeValue || '',
        leverage: draft.leverage,
        symbols: draft.symbols,
        allowedSides: draft.allowedSides,
        minNotional: draft.minNotional,
        enabled: draft.enabled !== false
      };
      const exists = safeRuleList.find((r) => r.id === ruleId);
      const nextRules = exists ? safeRuleList.map((r) => (r.id === ruleId ? { ...r, ...baseRule } : r)) : [...safeRuleList, baseRule];
      await applyRoutingConfig(workspaceId, nextRules);
      const [rulesResp, eventsResp] = await Promise.all([fetchRoutingRules(workspaceId), fetchWorkflowEvents(workspaceId)]);
      const reRules = Array.isArray(rulesResp) ? rulesResp : [];
      const edgesBuilt = buildEdges(safeNodes, reRules, eventsResp || [], connectedBotLinks);
      const nodesWithHealth = applyNodeHealth(safeNodes, edgesBuilt, eventsResp || []);
      setRules(reRules);
      setEvents(eventsResp || []);
      setEdges(edgesBuilt);
      setNodes(nodesWithHealth);
      setMode('view');
      setSelectedSource(null);
      setRuleModal({ open: false, draft: null });
    } catch (err: any) {
      setError(err?.message || 'Failed to save rule');
    } finally {
      setSavingRules(false);
    }
  }

  async function handleCreateNode(side: 'source' | 'destination', draft: { label: string; nodeType: string; description?: string }) {
    if (!workspaceReady) {
      setError('Workspace ID missing or placeholder. Log in again to create nodes.');
      return;
    }
    try {
      await createNode(workspaceId, { label: draft.label, nodeType: draft.nodeType, description: draft.description, side });
      const [nodesRespRaw] = await Promise.all([fetchWorkflowNodes(workspaceId)]);
      const nodesResp = nodesRespRaw && typeof nodesRespRaw === 'object' ? nodesRespRaw : {};
      const { webhooks = [], bots = [], integrations = [] } = nodesResp || {};
      const nodesBuilt = buildNodes(webhooks || [], bots || [], integrations || [], connectedBotCatalog, connectedBotLinks);
      const safeRuleList = Array.isArray(rules) ? rules : [];
      const edgesBuilt = buildEdges(nodesBuilt, safeRuleList, events, connectedBotLinks);
      const nodesWithHealth = applyNodeHealth(nodesBuilt, edgesBuilt, events);
      setNodes(nodesWithHealth);
      setEdges(edgesBuilt);
      setError(null);
      showToast(`Node "${draft.label || 'Unnamed'}" created`, 'success');
    } catch (err: any) {
      const message = err?.message || 'Failed to create node';
      setError(message);
      showToast(message, 'error');
    } finally {
      setCreateNodeModal({ open: false, side, draft: null });
    }
  }

  const handleZoom = (delta: number) => setZoom((z) => Math.min(2, Math.max(0.5, parseFloat((z + delta).toFixed(2)))));
  const labelForNode = (id: string | null | undefined) => {
    if (!id) return '—';
    const found = safeNodes.find((n) => n.id === id);
    return found?.label || id.slice(0, 8);
  };
  const sourceOptions = safeNodes.filter((n) => n.role === 'source');
  const destinationOptions = safeNodes.filter((n) => n.role === 'destination');

  async function handleWorkflowLifecycleAction(action: WorkflowLifecycleAction) {
    if (!workspaceReady) {
      setError('Workspace ID missing or placeholder. Log in again to control workflow.');
      return;
    }
    if (action === 'delete') {
      const confirmed = window.confirm('Delete workflow config and all routing rules?');
      if (!confirmed) return;
    }

    setWorkflowActionInFlight(action);
    setError(null);
    try {
      if (action === 'delete') {
        await deleteWorkflow(workspaceId);
      } else {
        await controlWorkflowAction(workspaceId, action);
      }
      setWorkflowStatus(action === 'pause' ? 'paused' : 'active');
      setReloadNonce((value) => value + 1);
      const suffix = action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'restart' ? 'restarted' : 'deleted';
      showToast(`Workflow ${suffix}`, 'success');
    } catch (err: any) {
      const message = err?.message || `Failed to ${action} workflow`;
      setError(message);
      showToast(message, 'error');
    } finally {
      setWorkflowActionInFlight(null);
    }
  }

  async function handleRuleLifecycleAction(ruleId: string, action: WorkflowRuleLifecycleAction) {
    if (!workspaceReady) {
      setError('Workspace ID missing or placeholder. Log in again to control workflow rules.');
      return;
    }
    if (action === 'delete') {
      const confirmed = window.confirm('Delete this rule?');
      if (!confirmed) return;
    }

    setRuleActionTargetId(ruleId);
    setRuleActionInFlight(action);
    setSavingRules(true);
    setError(null);
    try {
      if (action === 'delete') {
        await deleteWorkflowRule(workspaceId, ruleId);
      } else {
        await controlWorkflowRuleAction(workspaceId, ruleId, action);
      }
      setReloadNonce((value) => value + 1);
      const suffix = action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'restart' ? 'restarted' : 'deleted';
      showToast(`Rule ${suffix}`, 'success');
    } catch (err: any) {
      const message = err?.message || `Failed to ${action} rule`;
      setError(message);
      showToast(message, 'error');
    } finally {
      setSavingRules(false);
      setRuleActionTargetId(null);
      setRuleActionInFlight(null);
    }
  }

  const sourceNodeCount = safeNodes.filter((node) => node.role === 'source').length;
  const destinationNodeCount = safeNodes.filter((node) => node.role === 'destination').length;
  const activeRulesCount = safeRules.filter((rule) => rule.enabled !== false).length;
  const inactiveRulesCount = safeRules.filter((rule) => rule.enabled === false).length;

  const tabRail = (
    <nav className="grid grid-cols-3 gap-2 sm:w-fit">
      {WORKFLOW_TAB_ITEMS.map((tab) => {
        const isActive = activeTab === tab.key;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            to={`/platform/workflow/${tab.key}`}
            className={`group relative flex aspect-square w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-5 py-5 text-center text-base font-semibold transition sm:w-40 ${
              isActive
                ? 'border-primary-200/80 bg-primary-400/10 text-white'
                : 'border-white/10 bg-transparent text-white/80 hover:border-primary-400/40 hover:bg-primary-500/10'
            }`}
          >
            <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-bl from-white/40 to-white/0 opacity-10"></span>
            <span className={`relative z-10 flex h-10 w-10 items-center justify-center ${isActive ? 'opacity-100' : 'opacity-70'}`}>
              <Icon className="h-6 w-6 text-white/85" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className={`relative z-10 leading-snug text-base ${isActive ? 'text-white' : 'text-white/70'}`}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <RuleModal
        open={ruleModal.open}
        draft={ruleModal.draft}
        sources={sourceOptions}
        destinations={destinationOptions}
        onClose={() => {
          setRuleModal({ open: false, draft: null });
          setMode('view');
          setSelectedSource(null);
        }}
        onSave={handleSaveRule}
      />
      <CreateNodeModal
        open={createNodeModal.open}
        side={createNodeModal.side}
        draft={createNodeModal.draft}
        onClose={() => setCreateNodeModal({ open: false, side: 'source', draft: null })}
        onSave={handleCreateNode}
      />
      {toast && (
        <div
          className={`fixed right-4 top-4 z-[200] rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.tone === 'success' ? 'bg-emerald-600/80 border-emerald-300/60 text-emerald-50' : 'bg-red-600/80 border-red-300/60 text-red-50'
          }`}
        >
          {toast.message}
        </div>
      )}
      {(!nodes || isLoading) && (
        <div className="w-full py-12 text-center text-gray-300">
          <p className="text-sm">Loading workflow graph…</p>
        </div>
      )}
      <div className="relative w-full overflow-hidden">
        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-200">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1 font-mono text-[10px] text-gray-300">
              <span className="text-gray-500">Workspace</span>
              <span className="text-white">{workspaceId || 'not-set'}</span>
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${
                workflowStatus === 'paused'
                  ? 'border-amber-300/45 bg-amber-500/15 text-amber-100'
                  : 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100'
              }`}
            >
              {workflowStatus}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg border border-amber-300/45 bg-amber-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => handleWorkflowLifecycleAction('pause')}
                disabled={Boolean(workflowActionInFlight) || workflowStatus === 'paused'}
              >
                Pause
              </button>
              <button
                className="rounded-lg border border-emerald-300/45 bg-emerald-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => handleWorkflowLifecycleAction('resume')}
                disabled={Boolean(workflowActionInFlight) || workflowStatus !== 'paused'}
              >
                Resume
              </button>
              <button
                className="rounded-lg border border-primary-300/45 bg-primary-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-primary-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => handleWorkflowLifecycleAction('restart')}
                disabled={Boolean(workflowActionInFlight)}
              >
                Restart
              </button>
              <button
                className="rounded-lg border border-rose-300/45 bg-rose-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => handleWorkflowLifecycleAction('delete')}
                disabled={Boolean(workflowActionInFlight)}
              >
                Delete
              </button>
            </div>
            <button
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-100 hover:border-white/40"
              onClick={() => setReloadNonce((value) => value + 1)}
              disabled={isLoading}
            >
              Refresh
            </button>
          </div>
        </div>
        <section className="grid gap-6 lg:grid-cols-[minmax(0,31rem)_minmax(0,1fr)] lg:gap-x-24 lg:items-start">
          <div>{tabRail}</div>
          <div className="space-y-6">
        {activeTab === 'overview' && (
          <>
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="section-label">Workflow Overview</p>
              <p className="text-sm text-gray-300">
                Use the tab rail to open Graph, Pipeline, Rules, or Logs + Events on their own pages.
              </p>
            </section>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Sources</p>
                <p className="mt-2 text-2xl font-semibold text-white">{sourceNodeCount}</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Destinations</p>
                <p className="mt-2 text-2xl font-semibold text-white">{destinationNodeCount}</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Routing Rules</p>
                <p className="mt-2 text-2xl font-semibold text-white">{safeRules.length}</p>
                <p className="text-xs text-gray-400">{activeRulesCount} active · {inactiveRulesCount} paused</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Activity</p>
                <p className="mt-2 text-2xl font-semibold text-white">{recentEvents.length + recentExecutions.length}</p>
                <p className="text-xs text-gray-400">Latest executions + events</p>
              </article>
            </section>
          </>
        )}

        {activeTab === 'pipeline' && (
          <section className="card-shell space-y-4 border border-white/10 bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Pipeline</p>
                <p className="text-sm text-gray-300">Live routing lanes from source nodes to destination integrations.</p>
              </div>
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${
                  workflowStatus === 'paused'
                    ? 'border-amber-300/45 bg-amber-500/15 text-amber-100'
                    : 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100'
                }`}
              >
                workflow {workflowStatus}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Pipelines</p>
                <p className="mt-2 text-xl font-semibold text-white">{safeRules.length}</p>
              </article>
              <article className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Healthy Lanes</p>
                <p className="mt-2 text-xl font-semibold text-white">{activeRulesCount}</p>
              </article>
              <article className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Sources</p>
                <p className="mt-2 text-xl font-semibold text-white">{sourceNodeCount}</p>
              </article>
              <article className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Destinations</p>
                <p className="mt-2 text-xl font-semibold text-white">{destinationNodeCount}</p>
              </article>
            </div>
            <div className="space-y-2">
              {safeRules.length === 0 && <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-gray-400">No pipelines available yet.</p>}
              {safeRules.map((rule) => (
                <div key={`pipeline-${rule.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm">
                  <div className="flex items-center gap-2 text-gray-100">
                    <span className="font-semibold text-white">{labelForNode(rule.sourceWebhookId)}</span>
                    <span className="text-gray-500">→</span>
                    <span className="font-semibold text-white">{labelForNode(rule.destinationIntegrationId)}</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                      rule.enabled === false ? 'bg-gray-700 text-gray-300' : 'bg-emerald-700/60 text-emerald-100'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${rule.enabled === false ? 'bg-gray-400' : 'bg-emerald-300'}`} />
                    {rule.enabled === false ? 'Disabled' : 'Enabled'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'rules' && (
          <>
      <section className="card-shell space-y-4 w-full max-w-5xl mx-auto mb-4 bg-black/70 backdrop-blur-xl border border-white/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <p className="section-label">Signal Sources</p>
            <p className="text-sm text-gray-300">Webhooks & bots pulled from backend.</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm text-gray-200">
          {safeNodes
            .filter((n) => n.role === 'source')
            .map((n) => (
              <li key={n.id} className={`flex items-center justify-between border border-white/10 rounded-xl px-3 py-2 bg-white/5 ${mode === 'create' && selectedSource === n.id ? 'ring-2 ring-sky-300' : ''}`}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span>{n.label}</span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{n.type}</span>
                  </div>
                  {n.id === 'tradingview' ? (
                    n.dnsRecords && n.dnsRecords.length > 0 ? (
                      <div className="space-y-1 text-[11px] text-gray-400">
                        {n.dnsRecords.map((record, idx) => (
                          <div key={`${record.subdomain || 'dns'}-${idx}`} className="space-y-0.5">
                            <span className="block text-gray-300">
                              {record.subdomain || n.subdomain || 'DNS record'}
                            </span>
                            <span className="block font-mono text-gray-400 break-all">
                              {record.url || n.url || 'Ingress not provisioned'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : n.url ? (
                      <p className="text-[11px] font-mono text-gray-400 break-all">{n.url}</p>
                    ) : (
                      <p className="text-[11px] text-gray-500">Ingress not provisioned</p>
                    )
                  ) : (
                    n.description && <p className="text-[11px] text-gray-400 break-all">{n.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    className="rounded-lg border border-white/15 px-2 py-1 text-gray-200 hover:border-white/40"
                    onClick={() =>
                      setRuleModal({
                        open: true,
                        draft: {
                          sourceWebhookId: n.id,
                          destinationIntegrationId: '',
                          enabled: true
                        }
                      })
                    }
                  >
                    Add routing rule
                  </button>
                  <button
                    className="rounded-lg border border-white/10 px-2 py-1 text-gray-200 hover:border-white/40"
                    onClick={() =>
                      setRuleModal({
                        open: true,
                        draft: {
                          sourceWebhookId: n.id,
                          destinationIntegrationId: '',
                          enabled: true
                        }
                      })
                    }
                  >
                    Configure
                  </button>
                </div>
              </li>
            ))}
          {!safeNodes.filter((n) => n.role === 'source').length && (
            <li className="px-3 py-2 text-gray-500 text-sm">No sources found. Create a webhook to begin routing.</li>
          )}
        </ul>
      </section>

      <section className="card-shell space-y-4 w-full max-w-5xl mx-auto mb-4 bg-black/70 backdrop-blur-xl border border-white/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <p className="section-label">Destinations</p>
            <p className="text-sm text-gray-300">Integrations pulled from backend.</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm text-gray-200">
          {safeNodes
            .filter((n) => n.role === 'destination')
            .map((n) => (
              <li key={n.id} className="flex items-center justify-between border border-white/10 rounded-xl px-3 py-2 bg-white/5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span>{n.label}</span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{n.type}</span>
                  </div>
                  {(n.exchange || n.apiKeyMasked) && (
                    <p className="text-[11px] text-gray-400">
                      {[n.exchange ? n.exchange.toUpperCase() : null, n.apiKeyMasked ? `API ${n.apiKeyMasked}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    className="rounded-lg border border-white/15 px-2 py-1 text-gray-200 hover:border-white/40"
                    onClick={() =>
                      setRuleModal({
                        open: true,
                        draft: {
                          sourceWebhookId: '',
                          destinationIntegrationId: n.id,
                          enabled: true
                        }
                      })
                    }
                  >
                    Add routing rule
                  </button>
                  <button
                    className="rounded-lg border border-white/10 px-2 py-1 text-gray-200 hover:border-white/40"
                    onClick={() =>
                      setRuleModal({
                        open: true,
                        draft: {
                          sourceWebhookId: '',
                          destinationIntegrationId: n.id,
                          enabled: true
                        }
                      })
                    }
                  >
                    Configure
                  </button>
                </div>
              </li>
            ))}
          {!safeNodes.filter((n) => n.role === 'destination').length && (
            <li className="px-3 py-2 text-gray-500 text-sm">No destinations found. Connect an integration.</li>
          )}
        </ul>
      </section>

      <section className="card-shell space-y-4 w-full max-w-6xl mx-auto mb-6 border border-white/10 bg-black/60">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Routing Rules</p>
            <p className="text-sm text-gray-300">Source → destination guardrails synced with backend.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              className="btn btn-white-animated btn-small"
              onClick={() =>
                setRuleModal({
                  open: true,
                  draft: {
                    sourceWebhookId: selectedSource || '',
                    destinationIntegrationId: '',
                    enabled: true
                  }
                })
              }
            >
              New rule
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className="grid grid-cols-6 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-gray-500">
            <span>Source</span>
            <span>Destination</span>
            <span>Symbols</span>
            <span>Sides / Min</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          {safeRules.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">No routing rules saved yet.</p>}
          {safeRules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-6 items-center px-4 py-3 text-sm text-gray-100 border-t border-white/5">
              <div className="truncate">
                <p className="font-semibold text-white">{labelForNode(rule.sourceWebhookId)}</p>
              </div>
              <div className="truncate">
                <p className="font-semibold text-white">{labelForNode(rule.destinationIntegrationId)}</p>
              </div>
              <div className="truncate text-gray-300">{rule.symbols?.length ? rule.symbols.join(', ') : '*'}</div>
              <div className="truncate text-gray-300">
                {rule.allowedSides?.length ? rule.allowedSides.join('/') : 'both'} · {rule.minNotional != null ? `min ${rule.minNotional}` : 'no min'}
              </div>
              <div className="text-gray-300">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${rule.enabled === false ? 'bg-gray-700 text-gray-300' : 'bg-emerald-700/60 text-emerald-100'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${rule.enabled === false ? 'bg-gray-400' : 'bg-emerald-300'}`} />
                  {rule.enabled === false ? 'Disabled' : 'Enabled'}
                </span>
              </div>
              <div className="flex justify-end gap-2 text-xs">
                <button
                  className="px-3 py-1 rounded-lg border border-amber-300/40 text-amber-100 hover:border-amber-200/70 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={savingRules || ruleActionTargetId === rule.id || rule.enabled === false}
                  onClick={() => handleRuleLifecycleAction(rule.id, 'pause')}
                >
                  Pause
                </button>
                <button
                  className="px-3 py-1 rounded-lg border border-emerald-300/40 text-emerald-100 hover:border-emerald-200/70 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={savingRules || ruleActionTargetId === rule.id || rule.enabled !== false}
                  onClick={() => handleRuleLifecycleAction(rule.id, 'resume')}
                >
                  Resume
                </button>
                <button
                  className="px-3 py-1 rounded-lg border border-primary-300/40 text-primary-100 hover:border-primary-200/70 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={savingRules || ruleActionTargetId === rule.id}
                  onClick={() => handleRuleLifecycleAction(rule.id, 'restart')}
                >
                  Restart
                </button>
                <button
                  className="px-3 py-1 rounded-lg border border-white/10 text-gray-200 hover:border-white/30"
                  disabled={savingRules || ruleActionTargetId === rule.id}
                  onClick={() =>
                    setRuleModal({
                      open: true,
                      draft: {
                        ...rule
                      }
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className="px-3 py-1 rounded-lg border border-red-400/40 text-red-200 hover:border-red-300/80"
                  disabled={savingRules || ruleActionTargetId === rule.id}
                  onClick={() => handleRuleLifecycleAction(rule.id, 'delete')}
                >
                  Delete
                </button>
                {ruleActionTargetId === rule.id && (
                  <span className="px-2 py-1 rounded-lg border border-primary-300/40 text-primary-100">
                    {ruleActionInFlight}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
          </>
        )}

        {activeTab === 'graph' && (
          <>
      <div
        ref={canvasWrapRef}
        className="relative w-full rounded-2xl border border-white/10 overflow-hidden workflow-canvas-glass"
        style={{
          height: '100vh',
          minHeight: '100vh',
          width: '100%',
          position: 'relative',
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          backgroundPosition: 'center center'
        }}
      >
        {isLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm text-sm text-gray-200">
            Loading workflow…
          </div>
        )}
        <div className="absolute top-4 left-4 z-40">
          <div
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 shadow-2xl"
            style={{ backdropFilter: 'blur(10px)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}
          >
            <div className="flex items-center gap-2 text-xs text-gray-100">
              <button
                className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 border border-white/10"
                onClick={() => setCreateNodeModal({ open: true, side: 'source', draft: null })}
              >
                Create Node
              </button>
              <button
                className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 border border-white/10"
                  onClick={() => {
                    setMode('create');
                    setSelectedSource(null);
                  }}
                >
                  Create Link
                </button>
              </div>
          </div>
        </div>
        <div className="absolute top-4 right-4 z-40 flex flex-col items-center gap-2 rounded-full border border-white/10 bg-black/60 backdrop-blur px-2 py-3 text-xs text-gray-100 shadow-lg">
          <button className="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20" onClick={() => handleZoom(0.1)}>+</button>
          <button className="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20" onClick={() => handleZoom(-0.1)}>-</button>
        </div>
        <div className="absolute inset-y-0 left-0 w-1/3 bg-white/5 pointer-events-none" style={{ maskImage: 'linear-gradient(90deg, rgba(0,0,0,0.12), rgba(0,0,0,0))', zIndex: 5 }}></div>
        <div className="absolute inset-y-0 right-0 w-1/3 bg-white/5 pointer-events-none" style={{ maskImage: 'linear-gradient(270deg, rgba(0,0,0,0.12), rgba(0,0,0,0))', zIndex: 5 }}></div>
        <div className="absolute inset-y-0 left-1/3 right-1/3 bg-white/3 pointer-events-none" style={{ zIndex: 5, maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0))' }}></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={stageRef}
            className="relative"
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              transform: `scale(${fitScale * zoom})`,
              transformOrigin: 'center center'
            }}
          >
          <div className="absolute inset-0 z-10 flex justify-between">
            <div
              className="flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setCreateNodeModal({ open: true, side: 'source', draft: null });
              }}
            />
            <div
              className="flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                // center zone ignored for creation
              }}
            />
            <div
              className="flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setCreateNodeModal({ open: true, side: 'destination', draft: null });
              }}
            />
          </div>
          <div className="absolute top-6 left-6 z-20 text-xs text-gray-400">Sources (TradingView / Bots)</div>
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 text-xs text-gray-400">DaxLinks Router</div>
          <div className="absolute top-6 right-6 z-20 text-xs text-gray-400 text-right">Destinations (Exchanges / Banks)</div>
          <svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="absolute inset-0">
            {(() => {
              try {
                console.log('[WM] Render stage → nodes count:', safeNodes?.length || 0);
                const validEdges = safeEdges.filter((edge) => {
                  const src = safeNodes.find((n) => n.id === edge.sourceNodeId);
                  const dst = safeNodes.find((n) => n.id === edge.targetNodeId);
                  return src && dst;
                });
                const dropped = safeEdges.filter((e) => !validEdges.includes(e));
                if (dropped.length) {
                  console.warn('[WM] Dropped orphan edges:', dropped);
                }
                return validEdges.map((edge) => (
                  <EdgeLine key={edge.id} edge={edge} nodes={safeNodes} onSelect={() => {}} />
                ));
              } catch (err) {
                console.error('[WM] Edge render error', err);
                return null;
              }
            })()}
          </svg>
          {(() => {
            try {
              if (!safeNodes || safeNodes.length === 0) {
                return null;
              }
              return safeNodes.map((node) => (
                <NodeBadge
                  key={node.id}
                  node={node}
                  mode={mode}
                  selectedSource={selectedSource}
                  onPortMouseDown={(n, portKind) => {
                    setDragConnection({
                      start: getAnchor(n, portKind === 'input' ? 'left' : 'right'),
                      current: getAnchor(n, portKind === 'input' ? 'left' : 'right'),
                      fromNodeId: n.id,
                      fromRole: n.role
                    });
                  }}
                  onPortEnter={(n, portKind) => setHoverPort({ nodeId: n.id, role: n.role, portKind })}
                  onPortLeave={() => setHoverPort(null)}
                  onSelect={(id, n) => {
                    if (mode === 'create') {
                      if (n.role === 'source') {
                        setSelectedSource(n.id);
                      } else if (n.role === 'destination' && selectedSource) {
                        setRuleModal({
                          open: true,
                          draft: {
                            sourceWebhookId: selectedSource,
                            destinationIntegrationId: n.id,
                            enabled: true
                          }
                        });
                      }
                    }
                  }}
                />
              ));
            } catch (err) {
              console.error('[WM] Node render error', err);
              return null;
            }
          })()}
          {dragConnection && (
            <svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="absolute inset-0 pointer-events-none">
              <path
                d={`M ${dragConnection.start.x} ${dragConnection.start.y} C ${(dragConnection.start.x + dragConnection.current.x) / 2} ${dragConnection.start.y}, ${(dragConnection.start.x + dragConnection.current.x) / 2} ${dragConnection.current.y}, ${dragConnection.current.x} ${dragConnection.current.y}`}
                stroke="#38bdf8"
                strokeWidth={2}
                strokeDasharray="6 4"
                fill="none"
              />
            </svg>
          )}
          {simPreview && (
            <div
              className={`absolute z-40 pointer-events-none rounded-xl border px-3 py-2 text-xs shadow-lg ${
                simPreview.severity === 'ok' ? 'bg-emerald-500/20 border-emerald-300/50 text-emerald-50' : 'bg-red-500/20 border-red-300/50 text-red-50'
              }`}
              style={{
                left: `${(simPreview.x / CANVAS_WIDTH) * 100}%`,
                top: `${(simPreview.y / CANVAS_HEIGHT) * 100}%`,
                transform: 'translate(-50%, -120%)'
              }}
            >
              {simPreview.message}
            </div>
          )}
          </div>
        </div>

      </div>
          </>
        )}

        {activeTab === 'logs-events' && (
          <>
      <section className="card-shell space-y-3 w-full max-w-5xl mx-auto mt-6 border border-white/10 bg-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Workflow Activity</p>
            <p className="text-sm text-gray-300">Live executions and events streamed from backend.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              className={`px-3 py-1 rounded-lg border ${activityTab === 'executions' ? 'border-white/40 bg-white/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/20'}`}
              onClick={() => setActivityTab('executions')}
            >
              Executions
            </button>
            <button
              className={`px-3 py-1 rounded-lg border ${activityTab === 'events' ? 'border-white/40 bg-white/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/20'}`}
              onClick={() => setActivityTab('events')}
            >
              Events
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 divide-y divide-white/5">
          {activityTab === 'executions' && recentExecutions.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">No executions yet for this workspace.</p>
          )}
          {activityTab === 'events' && recentEvents.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">No events yet for this workspace.</p>
          )}
          {activityTab === 'executions' &&
            recentExecutions.map((exec) => (
              <button
                key={exec.id}
                className="w-full px-4 py-3 text-left hover:bg-white/5 transition flex flex-col gap-1"
                onClick={() => setDetailInfo({ kind: 'execution', data: exec })}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${exec.status?.includes('error') ? 'bg-red-400' : exec.status?.includes('ready') ? 'bg-blue-300' : 'bg-emerald-300'}`} />
                    {exec.status || 'unknown'}
                  </span>
                  <span className="font-mono text-[11px] text-gray-500">
                    {shortTime(exec.timestamp)} · {since(exec.timestamp)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-100">
                  <span className="flex items-center gap-2">
                    <span className="text-gray-400">src</span>
                    <span className="font-semibold text-white">{labelForNode(exec.sourceWebhookId)}</span>
                    <span className="text-gray-500">→</span>
                    <span className="font-semibold text-white">{labelForNode(exec.destinationIntegrationId)}</span>
                  </span>
                  <span className="text-gray-300">
                    {exec.symbol || '—'}
                    {exec.size ? ` · size ${exec.size}` : ''}
                  </span>
                </div>
              </button>
            ))}
          {activityTab === 'events' &&
            recentEvents.map((evt: any) => (
              <button
                key={evt.id}
                className="w-full px-4 py-3 text-left hover:bg-white/5 transition flex flex-col gap-1"
                onClick={() => setDetailInfo({ kind: 'event', data: evt })}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${evt.statusColor === 'red' ? 'bg-red-400' : evt.statusColor === 'orange' ? 'bg-amber-300' : evt.statusColor === 'grey' ? 'bg-gray-400' : 'bg-emerald-300'}`} />
                    {evt.kind || 'event'}
                  </span>
                  <span className="font-mono text-[11px] text-gray-500">
                    {shortTime(evt.timestamp || evt.createdAt)} · {since(evt.timestamp || evt.createdAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-100">
                  <span className="font-semibold text-white">{evt.summary || evt.edgeKey || 'Workflow event'}</span>
                  <span className="text-gray-300">{evt.symbol || ''}</span>
                </div>
              </button>
            ))}
        </div>
      </section>
          </>
        )}
          </div>
        </section>

      {detailInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDetailInfo(null)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0e13] p-5 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-white">
                {detailInfo.kind === 'execution' ? 'Execution detail' : 'Event detail'}
              </p>
              <button className="text-xs text-gray-400" onClick={() => setDetailInfo(null)}>
                Close
              </button>
            </div>
            {detailInfo.kind === 'execution' && (
              <div className="space-y-2 text-sm text-gray-200">
                <p className="text-gray-400">Status: <span className="text-white">{detailInfo.data.status}</span></p>
                <p className="text-gray-400">
                  Source → Destination:{' '}
                  <span className="text-white">{labelForNode(detailInfo.data.sourceWebhookId)}</span>
                  <span className="text-gray-500"> → </span>
                  <span className="text-white">{labelForNode(detailInfo.data.destinationIntegrationId)}</span>
                </p>
                <p className="text-gray-400">
                  Symbol / Size:{' '}
                  <span className="text-white">{detailInfo.data.symbol || '—'}{detailInfo.data.size ? ` · ${detailInfo.data.size}` : ''}</span>
                </p>
                <p className="text-gray-400">Attempts: <span className="text-white">{detailInfo.data.attempts ?? 0}</span></p>
                {detailInfo.data.lastError && (
                  <p className="text-red-300 break-words">Last error: {detailInfo.data.lastError}</p>
                )}
                {detailInfo.data.transactionId && (
                  <p className="text-gray-400">Transaction ID: <span className="text-white">{detailInfo.data.transactionId}</span></p>
                )}
                <p className="text-gray-500 text-xs">
                  {shortTime(detailInfo.data.timestamp)} · {since(detailInfo.data.timestamp)}
                </p>
              </div>
            )}
            {detailInfo.kind === 'event' && (
              <div className="space-y-2 text-sm text-gray-200">
                <p className="text-gray-400">Kind: <span className="text-white">{detailInfo.data.kind || 'event'}</span></p>
                <p className="text-gray-400">Summary: <span className="text-white">{detailInfo.data.summary || '—'}</span></p>
                {detailInfo.data.meta && (
                  <pre className="text-xs text-gray-300 bg-white/5 rounded-lg p-3 overflow-auto max-h-48">{JSON.stringify(detailInfo.data.meta, null, 2)}</pre>
                )}
                <p className="text-gray-500 text-xs">
                  {shortTime(detailInfo.data.timestamp || detailInfo.data.createdAt)} · {since(detailInfo.data.timestamp || detailInfo.data.createdAt)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
