# Cloudflare Pages configuration

## Frontend to deploy
- **Source directory:** `frontend/`
- **Framework:** React + Vite SPA (uses `vite.config.ts`)
- **Build output:** `frontend/dist`
- **SPA routing:** `_redirects` file present at `frontend/public/_redirects` (copied into `dist` by Vite) to serve `/index.html` for all paths.

## Cloudflare Pages dashboard settings
- **Project name:** `daxlinks-online`
- **Production branch:** `main`
- **Build command:** `pnpm --filter daxlinks-frontend build`
  - Pages will run `pnpm install` automatically because `packageManager` is set to pnpm in the repo root.
- **Build output directory:** `frontend/dist`
- **Root directory (optional in UI):** leave empty (repo root) — the build command already targets the frontend workspace.

## Worker routing warning (prevents 500s)
- Keep Worker routes scoped, e.g. `daxlinksonline.link/api/*` is safe.
- Do **not** create catch-all Worker routes like `daxlinksonline.link/*` or `www.daxlinksonline.link/*` unless the Worker intentionally proxies to the Pages site. Catch-alls will steal traffic from Pages and return 500s if misconfigured.

## Operator checklist
1. Set the Pages build command to `pnpm --filter daxlinks-frontend build` and the output directory to `frontend/dist` on project `daxlinks-online` (branch `main`).
2. Ensure no Worker route matches `daxlinksonline.link/*` or `www.daxlinksonline.link/*` unless it proxies to Pages; keep API routes narrowly scoped (e.g., `/api/*`).
3. Confirm DNS has a CNAME (or the Cloudflare-managed record) pointing `daxlinksonline.link` to the Pages hostname provided by Cloudflare.
