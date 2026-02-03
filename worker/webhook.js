export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
    }
    const origin = env.ORIGIN_URL || 'https://api.daxlinks.online';
    const incoming = new URL(request.url);
    const target = new URL(`${incoming.pathname}${incoming.search}`, origin);

    // Propagate original host for subdomain extraction
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', incoming.host);
    const cfConnectingIp = request.headers.get('cf-connecting-ip');
    if (cfConnectingIp) {
      headers.set('x-forwarded-for', cfConnectingIp);
    }

    return fetch(target.toString(), {
      method: 'POST',
      headers,
      body: request.body
    });
  }
};
