import CustomDns from '../components/CustomDns.js';

export default {
  name: 'DnsPage',
  components: { CustomDns },
  template: `
    <main class="layout-container section-pad space-y-12">
      <section class="space-y-3">
        <span class="section-label">Infrastructure</span>
        <h1 class="text-3xl font-semibold text-main sm:text-4xl">DNS &amp; Routing Overview</h1>
        <p class="max-w-3xl text-sm muted-text">
          Keep webhook ingress, API callbacks, and operator dashboards resolvable in every region.
          Manage records, health checks, and failover targets from a single console.
        </p>
      </section>
      <section class="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <article class="card-shell space-y-4">
          <h2 class="text-lg font-semibold text-main">Active Zones</h2>
          <table class="w-full text-xs muted-text">
            <thead class="text-left text-[11px] uppercase tracking-[0.3em] muted-text">
              <tr>
                <th class="pb-2">Hostname</th>
                <th class="pb-2">Type</th>
                <th class="pb-2">Target</th>
                <th class="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-white/5">
                <td class="py-3">hooks.daxlinksonline.link</td>
                <td class="py-3">CNAME</td>
                <td class="py-3">router.edge.daxlinksonline.link</td>
                <td class="py-3 text-right" style="color: var(--primary);">Healthy</td>
              </tr>
              <tr class="border-t border-white/5">
                <td class="py-3">ops.daxlinksonline.link</td>
                <td class="py-3">A</td>
                <td class="py-3">35.188.12.42</td>
                <td class="py-3 text-right" style="color: var(--primary);">Healthy</td>
              </tr>
              <tr class="border-t border-white/5">
                <td class="py-3">ws.daxlinksonline.link</td>
                <td class="py-3">SRV</td>
                <td class="py-3">wss://router.daxlinksonline.link:443</td>
                <td class="py-3 text-right muted-text">Degraded</td>
              </tr>
            </tbody>
          </table>
        </article>
        <aside class="card-shell space-y-5">
          <div class="flex items-center gap-3">
            <div class="h-9 w-9 rounded-full" style="background: linear-gradient(135deg, #F3801A, #F7B733);"></div>
            <div>
              <p class="text-sm font-semibold text-main">Secured by Cloudflare</p>
              <p class="text-xs" style="color: #F3801A;">Always-on DDoS &amp; WAF protection</p>
            </div>
          </div>
          <h3 class="text-sm font-semibold text-main">Failover Policy</h3>
          <p class="text-xs muted-text">
            Configure ordered health checks and instant fallbacks for critical workloads.
            When latency breaches thresholds, traffic shifts to the next available region automatically.
          </p>
          <div class="space-y-2 text-xs muted-text">
            <p>Primary: <span style="color: var(--primary);">fra.edge.daxlinksonline.link</span></p>
            <p>Secondary: <span style="color: var(--primary);">sin.edge.daxlinksonline.link</span></p>
            <p>Emergency: <span style="color: var(--primary);">nyc.edge.daxlinksonline.link</span></p>
          </div>
        </aside>
      </section>
      <section class="card-shell space-y-3">
        <h2 class="text-lg font-semibold text-main">Change Workflow</h2>
        <ol class="space-y-2 text-xs muted-text">
          <li>1. Draft record updates and request peer review.</li>
          <li>2. Validate propagation with automated dig checks.</li>
          <li>3. Record change tickets for audit and rollback tracking.</li>
        </ol>
      </section>
      <CustomDns />
    </main>
  `
};

