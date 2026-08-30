# ACHYORA — Operations runbook

Short answers for the things that actually go wrong in production.

---

## "AI is not configured" / `AI_NOT_CONFIGURED`

**Meaning:** `AI_PROVIDER` names a provider whose credentials are missing, or
no provider is configured at all. This is deliberate — the app never silently
switches vendors.

**Fix:** set the matching key and redeploy.

| `AI_PROVIDER` | Required |
| --- | --- |
| `gemini` | `GEMINI_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gateway` | `AI_GATEWAY_BASE_URL` **and** `AI_GATEWAY_API_KEY` |

Server variables are read per request, so a redeploy (or Worker secret update)
is enough — no code change.

---

## AI calls fail with provider errors

1. Check the deployment logs for the provider status code.
2. `401/403` — key revoked or wrong project. Rotate it in the vendor
   dashboard and update the env var.
3. `429` — vendor quota. Lower the `RATE_LIMIT_*` values or raise the vendor
   plan.
4. Users are refunded automatically on failure; verify in `credit_ledger`.

---

## Users report "Too many requests"

That is `RATE_LIMITED`. Inspect the window:

```sql
select bucket, subject, count, window_start
from public.api_rate_limits
order by window_start desc
limit 50;
```

Raise the relevant `RATE_LIMIT_<BUCKET>` variable (format `requests/seconds`)
and redeploy. To clear a specific subject immediately, delete its row.

---

## Credits look wrong

The ledger is the source of truth:

```sql
select * from public.credit_ledger where user_id = '<uuid>' order by created_at desc limit 50;
select * from public.credits where user_id = '<uuid>';
```

Every spend has a reason; refunds carry a `*_refund` reason. If a balance and
the ledger disagree, the ledger wins — correct the balance from it. Spends are
atomic, so a negative balance should be impossible; if you see one, capture
the row and investigate before adjusting.

---

## A video job never finishes

Jobs are capped by `VIDEO_MAX_POLL_SECONDS` (default 600). On timeout the row
in `generated_media` is set to `failed` and 8 credits are refunded. If users
report hangs:

1. Confirm the cap is not set to something huge.
2. Check `generated_media` for rows stuck in `processing` older than the cap —
   they were abandoned before the poll ran; fail them and refund manually.

---

## Guest quota complaints

The quota is 3 messages / 24 h keyed on a salted hash of IP + user agent.
Shared networks (offices, campuses, carrier NAT) can collide. Options: raise
the guest allowance in the migration, or accept it and push sign-up.

Never remove `GUEST_HASH_SALT`; rotating it resets every guest counter.

---

## Payments not activating

Order of investigation:

1. Razorpay dashboard → Webhooks → delivery log. Non-2xx means our endpoint
   rejected it.
2. `401` from us = signature mismatch → `RAZORPAY_WEBHOOK_SECRET` differs from
   the dashboard secret.
3. Check `processed_webhook_events` — if the event id is present, we already
   processed it and skipped a duplicate (correct behaviour).
4. Check `subscriptions` for the user.

Never activate a subscription by hand from a browser callback; re-send the
webhook from the Razorpay dashboard instead.

---

## Sign-in redirect loops or "invalid redirect URL"

The app builds redirect URLs from the live request origin. The origin must be
listed in Supabase → Authentication → URL Configuration → Redirect URLs:

```
https://<domain>/auth/callback
https://<domain>/auth/reset-password
```

Add preview domains too. Google sign-in additionally needs
`https://<project-ref>.supabase.co/auth/v1/callback` in the Google Cloud OAuth
client.

---

## Library uploads failing

- *Rejected before upload* — over `LIBRARY_MAX_UPLOAD_BYTES` or a MIME type
  outside the allow-list. Adjust `LIBRARY_MAX_UPLOAD_BYTES` or
  `LIBRARY_EXTRA_MIME_TYPES`.
- *Upload succeeds, registration fails* — the object's real metadata violated
  policy; the server deletes the object, so nothing is orphaned.
- *Storage error* — confirm a **private** bucket named `library` exists and the
  storage policies from the migrations are applied.

---

## Rotating secrets

1. Create the new key in the vendor dashboard.
2. Update the environment variable on the host.
3. Update the Worker variable/secret in Cloudflare, then redeploy so build-time
   `VITE_*` values are re-inlined.
4. Revoke the old key.

Rotating `SUPABASE_SERVICE_ROLE_KEY` requires redeploying immediately, as
webhooks and guest quota depend on it.

---

## Rolling back

Both hosts keep previous deployments; promote the last good one. Database
migrations are additive — a rollback of code does not require a schema
rollback.

---

## Routine checks

| Cadence | Check |
| --- | --- |
| Daily | Error rate in host logs; failed webhook deliveries |
| Weekly | `credit_ledger` refund volume (a spike means provider trouble) |
| Weekly | Rows stuck in `processing` in `generated_media` |
| Monthly | Prune old `api_rate_limits` and `guest_usage` rows |
| Quarterly | Rotate API keys; re-run the acceptance list in `TESTING.md` |
