# ACHYORA on Replit

## Run locally

The project keeps its existing Vite, TanStack Start, Nitro, and Cloudflare
deployment architecture.

```sh
npm install
npm run dev -- --host 0.0.0.0 --port 8080
```

The configured Replit workflow runs the same command on port 8080.

## Environment

The browser requires the existing Supabase public configuration:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (or the existing supported anon-key alias)

Server-side auth and application features require the existing runtime names:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for admin-only operations

AI provider and Razorpay variables remain optional until those features are
enabled. Keep server-only values unprefixed with `VITE_`; they must be supplied
through Replit Secrets or the deployment's server-side secret store.

## Verification notes

- Production builds use the existing Nitro Cloudflare module target.
- `npm run build` generates the worker and static client output under `dist`.
- TypeScript and ESLint checks are available through `npm run typecheck` and
  `npm run lint`.