import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import IntegrationsModule from './modules/IntegrationsModule';
import DatabasesModule from './modules/DatabasesModule';
import WebhooksModule from './modules/WebhooksModule';
import WorkflowModule from './modules/WorkflowModule';
import MonitoringModule from './modules/MonitoringModule';
import OrdersModule from './modules/OrdersModule';
import TradeBotsModule from './modules/TradeBotsModule';
import DNSModule from './modules/DNSModule';
import DeploymentModule from './modules/DeploymentModule';
import BankingModule from './modules/BankingModule';
import VPNModule from './modules/VPNModule';
import SupportModule from './modules/SupportModule';
import AlertsModule from './modules/AlertsModule';
import ChatModule from './modules/ChatModule';
import { PLATFORM_MODULE_META, type PlatformModuleId } from '../../icons/platformIcons';

const MODULE_COMPONENTS: Record<string, () => JSX.Element> = {
  integrations: IntegrationsModule,
  alerts: AlertsModule,
  databases: DatabasesModule,
  webhooks: WebhooksModule,
  workflow: WorkflowModule,
  monitoring: MonitoringModule,
  orders: OrdersModule,
  'trade-bots': TradeBotsModule,
  banking: BankingModule,
  dns: DNSModule,
  deployment: DeploymentModule,
  vpn: VPNModule,
  support: SupportModule,
  chat: ChatModule
};

export default function PlatformModulePage() {
  const { moduleId, tabId } = useParams();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!moduleId || !MODULE_COMPONENTS[moduleId]) {
      navigate('/platform', { replace: true });
    }
  }, [moduleId, navigate]);

  if (!moduleId) return null;
  const Detail = MODULE_COMPONENTS[moduleId];
  if (!Detail) return null;

  const hoursMinutes = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const meta = PLATFORM_MODULE_META[moduleId as PlatformModuleId];
  const HeaderIcon = meta?.icon;

  return (
    <div className="layout-container pt-16 pb-24 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="section-label">Platform · {meta?.label || moduleId}</p>
          <div className="flex items-center gap-3">
            {HeaderIcon && <HeaderIcon className="h-7 w-7 text-white/85" strokeWidth={1.7} aria-hidden="true" />}
            <h1 className="headline text-3xl">{meta?.label || 'Module detail'}</h1>
          </div>
        </div>
        <div className="text-xs text-gray-400 font-mono">
          {hoursMinutes}
          <span className="text-primary-200">:{seconds}</span>
        </div>
      </header>

      <section className="space-y-6">
        <Detail key={`${moduleId}:${tabId || ''}`} />
      </section>
    </div>
  );
}
