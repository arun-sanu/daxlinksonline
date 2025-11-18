import { useParams } from 'react-router-dom';

export default function BotInstances() {
  const { botId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bot Instances — {botId}</h1>
      <p className="text-gray-500">Instances list (placeholder).</p>
    </div>
  );
}

