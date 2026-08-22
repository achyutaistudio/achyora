# ACHYORA — Testing and verification

## Automated

```bash
npm install
npm run typecheck    # no errors
npm run lint         # no errors
npm run build        # must succeed for the target host
```

A green build is the minimum bar for merging. `npm run build` on a machine
produces the Cloudflare worker in `dist/`; run `npx wrangler dev --local` to
verify it on the Workers runtime before deploying.

## Manual acceptance

Run against a real deployment with real environment variables.

### Guest

1. Open the landing page signed out; the chat responds.
2. Send three messages — all answer.
3. Send a fourth — refused with the sign-up prompt.
4. Clear cookies and local storage, reload: still refused (quota is
   server-side, keyed on a salted hash).
5. Hammer the endpoint: after the guest rate limit you get HTTP 429 with
   `Retry-After`, not a 500.

### Auth

6. Sign up with email; the confirmation flow completes.
7. Sign in, hard refresh — session survives.
8. Sign out — protected routes redirect to `/auth`.
9. Google sign-in returns to `/auth/callback` and lands in the workspace.
10. Password reset email links to `/auth/reset-password` and sets a new
    password.
11. Visit `/workspace/chat` signed out — redirected, never a blank screen.

### Credits

12. Note the balance, send a chat message — it decrements by 1.
13. Spend down to zero — further calls return the insufficient-credits message
    with a link to pricing, not an error page.
14. Force a provider failure (temporarily wrong key) — credits are refunded
    and the ledger shows both rows.
15. Fire several requests at once — the balance never goes negative.

### Surfaces

16. **Chat**: history persists across reload; conversations list correctly.
17. **Compare**: multiple models answer; cost equals the number of models.
18. **Research** and **Sanatan research**: return structured answers.
19. **Image**: generates, appears in history, downloads.
20. **Video**: starts, polls, and either completes or stops at
    `VIDEO_MAX_POLL_SECONDS` with a refund — never polls forever.
21. **Voice**: records, transcribes, returns text.
22. **Library**: upload, list, open (signed URL), delete. Confirm the object is
    gone from storage after delete.
23. **Library abuse**: upload a disallowed MIME type and an oversized file —
    both rejected, and no orphan object remains.
24. **Settings**: profile edits persist.

### Payments

25. `/pricing` shows correct INR and USD prices from the database.
26. A Razorpay test payment activates Pro **only** after the webhook fires.
27. Replaying the same webhook event does not grant credits twice.
28. Posting to the webhook with a bad signature returns 401 and changes
    nothing.

### Security spot checks

29. Sign in as user A, note a `library_items` id; as user B, call open/delete
    with that id — both refused.
30. Poll a video job id belonging to another account — refused.
31. Inspect the built client bundle for `SERVICE_ROLE`, `SECRET`, and vendor
    keys — none present.
32. Query another user's rows directly with the anon key — RLS blocks it.

### SEO and performance

33. Public pages have unique titles, descriptions and OG tags; workspace pages
    are `noindex`.
34. Exactly one `<h1>` per page; images have alt text.
35. Lighthouse on the landing page: performance and accessibility ≥ 90.
36. Mobile 360 px width: no horizontal scrolling on any surface.

## Regression rules

- Never trust client-declared file metadata; re-verify server-side.
- Never activate a subscription outside the verified webhook.
- Never allow an AI failure to keep a user's credits.
- Never introduce a hard-coded domain, vendor host or key.
