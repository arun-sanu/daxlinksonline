import { HashRouter, Route, Routes, NavLink } from 'react-router-dom';
import BotsList from './pages/trade-bots/BotsList';
import BotDetail from './pages/trade-bots/BotDetail';
import BotVersions from './pages/trade-bots/BotVersions';
import BotInstances from './pages/trade-bots/BotInstances';
import InstanceDetail from './pages/trade-bots/InstanceDetail';
import TradeBots from './pages/TradeBots';
import Market from './pages/market/Market';
import MyRentals from './pages/market/MyRentals';
import ExchangeAccounts from './pages/ExchangeAccounts';
import PineConvert from './pages/pine/Convert';

function Sidebar() {
  const link = 'block rounded px-3 py-2 hover:bg-gray-200 dark:hover:bg-gray-800';
  const active = 'font-semibold bg-gray-200 dark:bg-gray-800';
  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 p-3 space-y-1">
      <div className="text-sm uppercase tracking-wide text-gray-500">DaxLinks</div>
      <NavLink to="/trade-bots" className={({ isActive }) => `${link} ${isActive ? active : ''}`}>Trade Bots</NavLink>
      <NavLink to="/market" className={({ isActive }) => `${link} ${isActive ? active : ''}`}>Market</NavLink>
      <NavLink to="/market/rentals" className={({ isActive }) => `${link} ${isActive ? active : ''}`}>My Rentals</NavLink>
      <NavLink to="/exchange-accounts" className={({ isActive }) => `${link} ${isActive ? active : ''}`}>Exchange Accounts</NavLink>
      <NavLink to="/pine-convert" className={({ isActive }) => `${link} ${isActive ? active : ''}`}>Pine → Python</NavLink>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/trade-bots" element={<Layout><BotsList /></Layout>} />
        <Route path="/trade-bots/:botId" element={<Layout><BotDetail /></Layout>} />
        <Route path="/trade-bots/:botId/versions" element={<Layout><BotVersions /></Layout>} />
        <Route path="/trade-bots/:botId/instances" element={<Layout><BotInstances /></Layout>} />
        <Route path="/instances/:instanceId" element={<Layout><InstanceDetail /></Layout>} />
        <Route path="/market" element={<Layout><Market /></Layout>} />
        <Route path="/market/rentals" element={<Layout><MyRentals /></Layout>} />
        <Route path="/exchange-accounts" element={<Layout><ExchangeAccounts /></Layout>} />
        <Route path="/pine-convert" element={<Layout><PineConvert /></Layout>} />
        <Route path="*" element={<Layout><TradeBots /></Layout>} />
      </Routes>
    </HashRouter>
  );
}
