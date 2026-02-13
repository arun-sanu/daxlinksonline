import type { ReactNode } from 'react';
import { Navigate, useRoutes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import HomePage from './pages/HomePage';
import AccountPage from './pages/AccountPage';
import PlatformOverviewPage from './pages/platform/PlatformOverviewPage';
import PlatformModulePage from './pages/platform/PlatformModulePage';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import Market from './pages/market/Market';
import MyRentals from './pages/market/MyRentals';
import ExchangeAccounts from './pages/ExchangeAccounts';
import PineConvert from './pages/pine/Convert';
import ExchangeIntegrationPage from './pages/platform/ExchangeIntegrationPage';
import AccountRegistrationPage from './pages/AccountRegistrationPage';
import TradeBotsPage from './pages/TradeBotsPage';
import TradeBotDetail from './pages/TradeBotDetail';
import BotVersions from './pages/BotVersions';
import BotInstances from './pages/BotInstances';
import SizingDetailsPage from './pages/platform/sizing/SizingDetailsPage';
import SizingReportsPage from './pages/platform/sizing/SizingReportsPage';
import SignalExchangeReportsPage from './pages/platform/orders/SignalExchangeReportsPage';

const withinCard = (node: ReactNode) => (
  <div className="layout-container section-pad">
    <div className="card-shell overflow-hidden">{node}</div>
  </div>
);

export function AppRouter() {
  const element = useRoutes([
    { path: '/', element: <LandingPage /> },
    { path: '/overview', element: <HomePage /> },
    { path: '/login', element: <LoginPage /> },
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { path: 'dashboard', element: <DashboardPage /> },
        { path: 'market', element: withinCard(<Market />) },
        { path: 'market/rentals', element: withinCard(<MyRentals />) },
        { path: 'trade-bots', element: withinCard(<TradeBotsPage />) },
        { path: 'trade-bots/:botId', element: withinCard(<TradeBotDetail />) },
        { path: 'trade-bots/:botId/versions', element: withinCard(<BotVersions />) },
        { path: 'trade-bots/:botId/instances', element: withinCard(<BotInstances />) },
        { path: 'exchange-accounts', element: withinCard(<ExchangeAccounts />) },
        { path: 'pine-convert', element: withinCard(<PineConvert />) },
        { path: 'account/register', element: <AccountRegistrationPage /> },
        { path: 'account', element: <AccountPage /> },
        { path: 'platform', element: <PlatformOverviewPage /> },
        { path: 'platform/orders/sizing', element: <Navigate to="/platform/orders/sizing/details" replace /> },
        { path: 'platform/orders/sizing/details', element: <SizingDetailsPage /> },
        { path: 'platform/orders/sizing/reports', element: <SizingReportsPage /> },
        { path: 'platform/orders/reports', element: <SignalExchangeReportsPage /> },
        { path: 'platform/sizing', element: <Navigate to="/platform/orders/sizing/details" replace /> },
        { path: 'platform/sizing/details', element: <Navigate to="/platform/orders/sizing/details" replace /> },
        { path: 'platform/sizing/reports', element: <Navigate to="/platform/orders/sizing/reports" replace /> },
        { path: 'platform/integrations/:exchangeId', element: <ExchangeIntegrationPage /> },
        { path: 'platform/integrations/:exchangeId/connectivity', element: <ExchangeIntegrationPage /> },
        { path: 'platform/integrations/:exchangeId/data', element: <ExchangeIntegrationPage /> },
        { path: 'platform/integrations/:exchangeId/settings', element: <ExchangeIntegrationPage /> },
        { path: 'platform/:moduleId', element: <PlatformModulePage /> },
        { path: '*', element: <Navigate to="/dashboard" replace /> }
      ]
    }
  ]);

  return element;
}
