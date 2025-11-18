import { useParams } from 'react-router-dom';

export default function InstanceDetail() {
  const { instanceId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Instance: {instanceId}</h1>
      <p className="text-gray-500">Instance detail (placeholder).</p>
    </div>
  );
}

