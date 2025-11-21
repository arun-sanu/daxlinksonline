export default function VPNModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">VPN</p>
        <h2 className="text-3xl font-semibold text-main">Edge tunnels</h2>
        <p className="text-sm muted-text">
          Secure ingress for customer-managed brokers is under active development. Expect hardware key enforcement and geo-aware
          routing.
        </p>
      </header>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-primary-200">Coming soon</p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>• Dedicated tunnels per desk with split routing.</li>
          <li>• Device posture attestation + automatic revocation.</li>
          <li>• Logs streamed into the monitoring module.</li>
        </ul>
      </article>

      <article className="card-shell space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Early access</p>
        <p className="text-sm text-gray-300">Join the private preview to test connectivity with your Zyxel or ZeroTier appliances.</p>
        <button type="button" className="btn btn-secondary btn-small">Join preview</button>
      </article>
    </div>
  );
}
