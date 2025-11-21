import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import IntegrationsModule from './modules/IntegrationsModule';
import DatabasesModule from './modules/DatabasesModule';
import WebhooksModule from './modules/WebhooksModule';
import WorkflowModule from './modules/WorkflowModule';
import MonitoringModule from './modules/MonitoringModule';
import ResourcesModule from './modules/ResourcesModule';
import TradeBotsModule from './modules/TradeBotsModule';
import DNSModule from './modules/DNSModule';
import DeploymentModule from './modules/DeploymentModule';
import BankingModule from './modules/BankingModule';
import VPNModule from './modules/VPNModule';
import SupportModule from './modules/SupportModule';

const MODULE_COMPONENTS: Record<string, () => JSX.Element> = {
  integrations: IntegrationsModule,
  databases: DatabasesModule,
  webhooks: WebhooksModule,
  workflow: WorkflowModule,
  monitoring: MonitoringModule,
  resources: ResourcesModule,
  'trade-bots': TradeBotsModule,
  banking: BankingModule,
  dns: DNSModule,
  deployment: DeploymentModule,
  vpn: VPNModule,
  support: SupportModule
};

export default function PlatformModulePage() {
  const { moduleId } = useParams();
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

  return (
    <div className="layout-container pt-16 pb-24 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="section-label">Platform · {moduleId}</p>
          <h1 className="headline text-3xl">Module detail</h1>
        </div>
        <div className="text-xs text-gray-400 font-mono">
          {hoursMinutes}
          <span className="text-primary-200">:{seconds}</span>
        </div>
      </header>

      <Link to="/platform" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-primary-200">
        ← Back to overview
      </Link>

      <section className="space-y-6">
        <Detail />
      </section>
    </div>
  );
}
