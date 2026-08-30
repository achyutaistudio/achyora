# ACHYORA merged build

Base: `achyora-premium-ui-main`

Merged from `project-source`:

- Variable credit pricing:
  - Chat: 1 credit
  - Research: 2 credits
  - Sanatan: 2 credits
  - Image: 3 credits
  - Video: 8 credits
  - Voice: 2 credits
  - Model comparison: 1 credit per selected model
- Centralized credit policy in `src/lib/credits.ts` (restored in the production repair pass).
- Server-side streaming chat uses the same centralized chat cost.
- Comparison refunds failed model costs only and returns the resulting balance.
- Workspace UI shows the applicable credit cost where appropriate.
- Premium workspace layout, sidebar, account UI, Sanatan -> Chat continuation, and single-flight protections are preserved.
- Added `npm run typecheck` script because the project documentation references it.

Verification:

- Source-level consistency checks completed.
- A dependency install was attempted twice but did not complete within the execution window, so a full production build/typecheck could not be completed in this environment.
- Global TypeScript was invoked and stopped immediately because project dependencies (for example `vite/client`) were not installed.
