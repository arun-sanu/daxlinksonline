export default {
  name: 'AppFooter',
  setup() {
    return {
      year: new Date().getFullYear()
    };
  },
  template: `
    <footer class="footer-shell" style="margin-top: 6rem;">
      <div class="layout-container flex flex-col gap-8 text-sm muted-text md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-main text-lg font-semibold">DaxLinks Online</p>
          <p class="mt-2 text-xs uppercase tracking-[0.28em] text-gray-500">Advanced automation, calm confidence.</p>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.24em] footer-links">
          <a href="https://daxlinks.online/docs" target="_blank" rel="noopener">Docs</a>
          <a href="https://daxlinks.online/legal" target="_blank" rel="noopener">Legal</a>
          <a href="https://daxlinks.online/security" target="_blank" rel="noopener">Security</a>
          <a href="https://daxlinks.online/support" target="_blank" rel="noopener">Support</a>
        </div>
        <p class="text-xs text-gray-500">© {{ year }} DaxLinks. All rights reserved.</p>
      </div>
    </footer>
  `
};
