import { prisma } from '../utils/prisma.js';
import { AVAILABLE_EXCHANGES } from '../data/exchanges.js';

export async function getBootstrapData(workspaceId, requesterId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      integrations: true,
      webhooks: true,
      credentialEvents: {
        orderBy: { createdAt: 'desc' },
        take: 20
      },
      adminSessions: {
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });

  if (!workspace) {
    throw Object.assign(new Error('Workspace not found'), { status: 404 });
  }

  if (!requesterId) {
    throw Object.assign(new Error('Authentication required'), { status: 401 });
  }

  if (workspace.ownerId && workspace.ownerId !== requesterId) {
    throw Object.assign(new Error('Forbidden: workspace access denied'), { status: 403 });
  }

  return {
    metrics: {
      exchanges: workspace.integrations.length,
      endpoints: '200+'
    },
    webcastChannels: workspace.integrations.map((integration) => ({
      id: integration.id,
      exchange: integration.exchange.toUpperCase(),
      channel: `${integration.exchange.toUpperCase()} • private feed`,
      updates: 240
    })),
    planOptions: ['Starter', 'Professional', 'Enterprise'],
    teamSizes: ['1-5', '6-15', '16-50', '50+'],
    accessPolicies: workspace.credentialEvents.slice(0, 3).map((event) => ({
      id: event.id,
      name: event.eventType,
      description: event.detail,
      updated: event.createdAt.toISOString()
    })),
    recentSessions: workspace.adminSessions.map((session) => ({
      id: session.id,
      location: session.location,
      device: session.device,
      ip: session.ip,
      time: session.createdAt.toISOString()
    })),
    integrationProfiles: workspace.integrations,
    availableExchanges: AVAILABLE_EXCHANGES,
    credentialEvents: workspace.credentialEvents,
    webhooks: workspace.webhooks,
    webhookEvents: ['signal.triggered', 'signal.cleared', 'order.filled', 'order.failed'],
    workflowSummary: {
      signalsPerMinute: 140,
      signalThrottle: '30/minute',
      orderThroughput: 95,
      connectedExchanges: workspace.integrations.length
    },
    dataflowNodes: [
      {
        id: 'tradingview',
        label: 'TradingView Signals',
        role: 'Source',
        environment: 'Cloud',
        description: 'Webhook alerts converted into authenticated POST payloads.',
        metrics: { bandwidth: '120 alerts/min', rateLimit: 'N/A', latency: '80 ms' },
        connections: ['DaxLinks Router'],
        alerting: false
      },
      {
        id: 'daxlinks',
        label: 'DaxLinks Router',
        role: 'Core',
        environment: 'Kubernetes',
        description: 'Normalizes alerts, enforces guardrails, and dispatches to exchange adapters.',
        metrics: { bandwidth: '1.6 MB/s', rateLimit: '10 req/s', latency: '35 ms' },
        connections: workspace.integrations.map((i) => `${i.exchange} Adapter`),
        alerting: true
      },
      ...workspace.integrations.map((integration) => ({
        id: integration.id,
        label: `${integration.exchange} Adapter`,
        role: 'Exchange',
        environment: integration.environment,
        description: 'Private trading channel with risk checks and auto-retry enabled.',
        metrics: { bandwidth: integration.bandwidth, rateLimit: `${integration.rateLimit} req/s`, latency: '45 ms' },
        connections: ['DaxLinks Router'],
        alerting: integration.status === 'active'
      }))
    ],
    insights: {
      rest: {
        label: 'REST Pipelines',
        takeaways: [
          'Deterministic execution windows with automatic retry logic.',
          'Rate-limit awareness across all connected exchanges.',
          'Unified endpoint schema means faster integration.'
        ],
        stats: [
          { label: 'Avg Latency', value: '120 ms', caption: 'Measured across integrations.' },
          { label: 'Throughput', value: '1.8k req/min', caption: 'Within rate limits.' },
          { label: 'Success Rate', value: '99.4%', caption: 'Transport/retry adjusted.' },
          { label: 'Shared Schemas', value: '45+', caption: 'Common commands supported.' }
        ],
        helper: 'REST calls stay ideal for deterministic control loops and scheduled checks.'
      },
      socket: {
        label: 'WebSocket Streams',
        takeaways: [
          'Private channels gated behind login guards.',
          'Automatic reconnection with exponential backoff.',
          'Subscription deduplication prevents double feeds.'
        ],
        stats: [
          { label: 'Reconnect Window', value: '< 3s', caption: 'Default wait time before retry.' },
          { label: 'Retry Ceiling', value: '3 attempts', caption: 'Configurable per socket.' },
          { label: 'Channels', value: '60+', caption: 'Across public/private feeds.' },
          { label: 'Auth Guard', value: 'Enabled', caption: 'Private streams gated until login success.' }
        ],
        helper: 'WebSockets power the live cockpit—keep them light and dedicated.'
      }
    },
    resources: workspace.webhooks.map((webhook) => ({
      title: webhook.name,
      description: `Outbound to ${webhook.url}`,
      icon: '🛰️',
      linkLabel: 'View config',
      href: '#'
    })),
    roadmap: [
      {
        quarter: 'Q2 2024',
        items: ['Binance expansion', 'Real-time notification bridge', 'Improved rate-limit telemetry']
      },
      {
        quarter: 'Q3 2024',
        items: ['Hosted REST relay', 'Historical data snapshots', 'Auth vault integrations']
      }
    ],
    onboarding: [
      { step: 1, label: 'Install the SDK and configure environment variables.' },
      { step: 2, label: 'Spin up WebSocket templates or REST clients.' },
      { step: 3, label: 'Visualize data streams in the Vue cockpit.' },
      { step: 4, label: 'Deploy and monitor trading operations.' }
    ]
  };
}
