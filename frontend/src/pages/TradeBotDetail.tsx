import { useParams } from 'react-router-dom';

export default function TradeBotDetail() {
  const { botId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Trade Bot: {botId}</h1>
      <p className="text-gray-500">Bot detail page (placeholder).</p>
    </div>
  );
}

