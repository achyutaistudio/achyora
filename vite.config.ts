// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vite only exposes VITE_* variables automatically. The server-side AI
// provider uses runtime names such as GEMINI_API_KEY. Loading the local env
// file into the Node process here makes `npx vite preview` behave like the
// Wrangler local runtime without exposing server secrets to the browser.
// Cloudflare production still uses its own Worker Variables/Secrets.
const localEnv = loadEnv("development", process.cwd(), "");
for (const [key, value] of Object.entries(localEnv)) {
  if (!(key in process.env)) process.env[key] = value;
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Pin the Nitro output layout to the one the docs and the `preview`/`deploy`
  // scripts expect: worker in dist/server, static assets in dist/client.
  // (Inside a Lovable build LOVABLE_NITRO_PRESET pins the layout and this is ignored.)
  //
  // `compatibilityDate` is forwarded verbatim to Nitro but is missing from the
  // wrapper's published option type, hence the cast. Without it Nitro stamps
  // TODAY's date into dist/server/wrangler.json, and `wrangler dev` refuses to
  // boot with "This Worker requires compatibility date <today>, but the newest
  // date supported by this server binary is <earlier>".
  vite: {
    build: {
      rollupOptions: {
        output: {
          advancedChunks: {
            groups: [
              {
                // Keep TanStack Start's server/client core (including
                // `createMiddleware`) in one chunk. Otherwise Rolldown splits
                // `createMiddleware` into the SSR entry chunk while the server
                // core lands in a sibling chunk that imports it back, and the
                // resulting circular ESM evaluation runs
                // `createCsrfMiddleware()` before `createMiddleware` is
                // initialised -> "createMiddleware is not a function".
                name: "tanstack-start-core",
                test: /node_modules[\\/]@tanstack[\\/](start-client-core|start-server-core|react-start-client|react-start-server|start-storage-context)[\\/]/,
              },
            ],
          },
        },
      },
    },
  },
  nitro: {
    compatibilityDate: "2025-09-01",
    output: {
      dir: "dist",
      serverDir: "dist/server",
      publicDir: "dist/client",
    },
  } as unknown as {
    output: { dir: string; serverDir: string; publicDir: string };
  },
});
