import type { ReactNode } from 'react';
import { Navigate, useRoutes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import HomePage from './pages/HomePage';
import TradeBotsPage from './pages/TradeBotsPage';
import AccountPage from './pages/AccountPage';
import PlatformOverviewPage from './pages/platform/PlatformOverviewPage';
import PlatformModulePage from './pages/platform/PlatformModulePage';
import BotDetail from './pages/trade-bots/BotDetail';
import BotVersions from './pages/trade-bots/BotVersions';
import BotInstances from './pages/trade-bots/BotInstances';
import InstanceDetail from './pages/trade-bots/InstanceDetail';
import Market from './pages/market/Market';
import MyRentals from './pages/market/MyRentals';
import ExchangeAccounts from './pages/ExchangeAccounts';
import PineConvert from './pages/pine/Convert';

const withinCard = (node: ReactNode) => (
  <div className="layout-container section-pad">
    <div className="card-shell overflow-hidden">{node}</div>
  </div>
);

export function AppRouter() {
  const element = useRoutes([
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'trade-bots', element: <TradeBotsPage /> },
        { path: 'trade-bots/:botId', element: withinCard(<BotDetail />) },
        { path: 'trade-bots/:botId/versions', element: withinCard(<BotVersions />) },
        { path: 'trade-bots/:botId/instances', element: withinCard(<BotInstances />) },
        { path: 'instances/:instanceId', element: withinCard(<InstanceDetail />) },
        { path: 'market', element: withinCard(<Market />) },
        { path: 'market/rentals', element: withinCard(<MyRentals />) },
        { path: 'exchange-accounts', element: withinCard(<ExchangeAccounts />) },
        { path: 'pine-convert', element: withinCard(<PineConvert />) },
        { path: 'account', element: <AccountPage /> },
        { path: 'platform', element: <PlatformOverviewPage /> },
        { path: 'platform/:moduleId', element: <PlatformModulePage /> },
        { path: '*', element: <Navigate to="/" replace /> }
      ]
    }
  ]);

  return element;
}
