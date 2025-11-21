import type { ReactNode } from 'react';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export default function PlaceholderPage({ title, description, children }: PlaceholderPageProps) {
  return (
    <div className="layout-container section-pad">
      <section className="card-shell space-y-4">
        <h2 className="text-2xl font-semibold text-main">{title}</h2>
        {description && <p className="text-sm muted-text">{description}</p>}
        <div className="text-sm text-main/80">{children ?? 'This area is coming soon.'}</div>
      </section>
    </div>
  );
}
