import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
// Cache-bust local module imports
import App from './App.js?v=20251106b';
import { router } from './router.js?v=20251106b';

const app = createApp(App);
app.use(router);
app.mount('#app');

if (typeof window !== 'undefined') {
  window.__appRouter__ = router;
}
