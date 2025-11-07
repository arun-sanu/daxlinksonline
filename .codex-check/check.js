const { executablePath } = require('puppeteer-core');
const puppeteer = require('puppeteer-core');

(async () => {
  const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  const url = process.argv[2] || 'http://localhost:5173/#/dns';
  const timeoutMs = 20000;

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1280,800'
    ]
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);

  const logs = [];
  const errors = [];
  const requestsFailed = [];
  const badResponses = [];

  page.on('console', async msg => {
    try {
      const args = await Promise.all(msg.args().map(a => a.jsonValue().catch(() => undefined)));
      logs.push({ type: msg.type(), text: msg.text(), args });
    } catch {
      logs.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', err => errors.push({ message: err.message }));
  page.on('requestfailed', req => {
    requestsFailed.push({ url: req.url(), method: req.method(), failure: req.failure() });
  });
  page.on('response', res => {
    const status = res.status();
    if (status >= 400) {
      badResponses.push({ url: res.url(), status });
    }
  });

  const start = Date.now();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
  } catch (e) {
    errors.push({ message: `Navigation error: ${e.message}` });
  }

  // Give SPA a bit to boot
  await new Promise(r => setTimeout(r, 6000));

  const title = await page.title().catch(() => '');

  const result = {
    url,
    title,
    durationMs: Date.now() - start,
    errors,
    console: logs,
    requestsFailed,
    httpErrors: badResponses,
  };

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
