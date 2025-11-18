import { useParams } from 'react-router-dom';

export default function BotVersions() {
  const { botId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bot Versions — {botId}</h1>
      <p className="text-gray-500">Versions list (placeholder).</p>
    </div>
  );
}

