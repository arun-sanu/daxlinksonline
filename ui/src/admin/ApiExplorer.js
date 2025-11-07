import { ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'ApiExplorer',
  setup() {
    const method = ref('GET');
    const path = ref('/metadata');
    const headers = ref('');
    const body = ref('');
    const autoAuth = ref(true);
    const loading = ref(false);
    const status = ref('');
    const responseHeaders = ref('');
    const responseBody = ref('');

    function buildCurl(url) {
      const lines = [`curl -X ${method.value} "${url}"`];
      const hdrs = headers.value.split('\n').map(l => l.trim()).filter(Boolean);
      if (autoAuth.value && window.__appAuthToken__) hdrs.push(`Authorization: Bearer ${window.__appAuthToken__}`);
      hdrs.forEach(h => lines.push(`-H '${h.replace(/'/g, "'\\''")}'`));
      if (body.value && method.value !== 'GET' && method.value !== 'HEAD') lines.push(`--data '${body.value.replace(/'/g, "'\\''")}'`);
      return lines.join(' \\ \n  ');
    }

    async function send() {
      loading.value = true; status.value=''; responseHeaders.value=''; responseBody.value='';
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const url = base.replace(/\/$/, '') + path.value;
        const hdrs = {};
        headers.value.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
          const i = line.indexOf(':'); if (i>0) hdrs[line.slice(0,i).trim()] = line.slice(i+1).trim();
        });
        if (autoAuth.value && window.__appAuthToken__) hdrs['Authorization'] = `Bearer ${window.__appAuthToken__}`;
        const resp = await fetch(url, { method: method.value, headers: { 'Content-Type': 'application/json', ...hdrs }, body: (method.value === 'GET' || method.value === 'HEAD') ? undefined : (body.value || undefined) });
        status.value = `${resp.status} ${resp.statusText}`;
        const h = {};
        resp.headers?.forEach?.((v,k)=>{ h[k]=v; });
        responseHeaders.value = JSON.stringify(h, null, 2);
        const text = await resp.text();
        try { responseBody.value = JSON.stringify(JSON.parse(text), null, 2); } catch { responseBody.value = text; }
      } catch (e) {
        status.value = String(e?.message || e);
      } finally { loading.value = false; }
    }

    function copyCurl() {
      const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
      const url = base.replace(/\/$/, '') + path.value;
      const cmd = buildCurl(url);
      navigator.clipboard?.writeText(cmd);
      alert('Copied cURL');
    }

    return { method, path, headers, body, autoAuth, loading, status, responseHeaders, responseBody, send, copyCurl };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">API Explorer</h3>
          <button class="btn btn-secondary" @click="copyCurl">Copy as cURL</button>
        </header>
        <div class="mt-3 grid gap-3 md:grid-cols-4">
          <select v-model="method" class="field">
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option>
          </select>
          <input v-model="path" class="field md:col-span-3" placeholder="/v1/..." />
        </div>
        <label class="mt-3 text-xs text-gray-400 inline-flex items-center gap-2"><input type="checkbox" v-model="autoAuth" /> Include auth</label>
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <textarea v-model="headers" class="field" rows="6" placeholder="Header: value\nAnother: value"></textarea>
          <textarea v-model="body" class="field" rows="6" placeholder='{"key":"value"}'></textarea>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <button class="btn btn-white-animated" :disabled="loading" @click="send">Send</button>
          <span class="text-xs text-gray-400">{{ status }}</span>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <h4 class="text-sm text-main">Response headers</h4>
            <pre class="mt-2 whitespace-pre-wrap text-xs">{{ responseHeaders }}</pre>
          </div>
          <div>
            <h4 class="text-sm text-main">Response body</h4>
            <pre class="mt-2 whitespace-pre-wrap text-xs">{{ responseBody }}</pre>
          </div>
        </div>
      </article>
    </section>
  `
};
