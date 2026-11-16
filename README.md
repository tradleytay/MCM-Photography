# MCM Photography

## Project layout

- Root HTML files — public pages (home, services, portfolio, contact and school photography), plus compatibility redirects and `404.html`.
- `admin/` — administrator sign-in shell and its dedicated assets.
- `parents/` — parent portal pages and portal-specific scripts.
- `css/`, `js/`, `img/`, and `lib/` — shared styles, scripts, images and vendor libraries.

## Supabase backend

The public brochure pages remain static and read published page content and school packages from Supabase. The contact form saves booking requests for admin review. Parents can submit unpaid photo/package order requests from their private gallery; admins manage order status, production and delivery. **There is no online payment processing.**

The backend project is under `supabase/`:

- `migrations/` — the initial school schema and incremental workflow/operations migrations. No learner or school seed data is included.
- `functions/parent-access` — rate-limited PIN verification and a short-lived, learner-scoped parent session.
- `functions/parent-gallery` and `functions/parent-end-session` — private signed photo URLs and session revocation.
- `functions/admin-set-learner-pin` — admin-only PIN hashing and rotation.
- `functions/admin-manage-users` — invite, suspend, and reinstate administrator accounts. There are no staff roles or public sign-ups.
- `functions/create-booking` — validated, rate-limited public booking requests.
- `functions/parent-submit-order` and `functions/parent-orders` — parent-session-verified unpaid order requests and status lookup.
- `functions/parent-download-request` and `functions/parent-photo-download` — entitlement-checked download requests and short-lived original-photo links.

The browser uses `js/mcm-backend.js` and `js/backend-config.js`. The configured publishable key is public by design. Set `backendReady` to `true` only after the required schema, Edge Functions, and first admin account are deployed. New migrations and Edge Function changes in a checkout are not live until deployed. **Never add the Supabase service-role key or the parent HMAC secret to frontend files.**

The admin dashboard has exactly eight sections: Overview, Website Management, Bookings, Schools & Learners, Photo Management, Orders & Payments, Production & Deliveries, and Settings. The Overview retains five summary cards. Settings are available to admins only; staff role management is intentionally not enabled. Website Management edits published text/image/link slots identified by `data-cms-key`, manages public site media, and maintains school packages. Bookings include service settings, scheduling/conflict checks, calendar filters, deposits, and history. School operations include learner/guardian records, consent, PIN/session controls, CSV imports, batched photo upload, manual photo assignment, private watermarked previews, and photo pricing. Orders preserve price snapshots; payment status is manually reconciled against actual transactions, and production cannot begin before verification. Original photo downloads use approvals and short-lived links. Online payment gateways are out of scope.

### Deploy the new workflows

The initial migration `20261115141400_initial_school_backend.sql` has already been applied to the project. **Do not run it again**; doing so will fail with “relation already exists.” Check the Supabase migration history and apply each missing incremental migration in order, exactly once, using the Supabase SQL Editor:

1. `supabase/migrations/20261116010000_admin_workflows.sql`
2. `supabase/migrations/20261116020000_admin_operations.sql`

Do not run `supabase db push` unless the project migration history has first been checked and correctly reconciled. The operations migration adds schedule and payment safeguards, guardian/photo workflow tables, watermarked preview paths, download approvals, and admin audit events.

The Edge Functions import the existing `supabase/functions/_shared` helpers. From the repository root, deploy them with the Supabase CLI:

```powershell
supabase login
supabase link --project-ref emyjyqrzyxjvxlhsxdtd
supabase functions deploy parent-access --no-verify-jwt
supabase functions deploy parent-end-session --no-verify-jwt
supabase functions deploy admin-set-learner-pin --no-verify-jwt
supabase functions deploy create-booking --no-verify-jwt
supabase functions deploy parent-submit-order --no-verify-jwt
supabase functions deploy parent-orders --no-verify-jwt
supabase functions deploy parent-gallery --no-verify-jwt
supabase functions deploy parent-download-request --no-verify-jwt
supabase functions deploy parent-photo-download --no-verify-jwt
supabase functions deploy admin-manage-users --no-verify-jwt
```

The changed `create-booking`, `parent-gallery`, and `parent-orders` functions must also be redeployed. If deploying from the Supabase Dashboard instead, turn **off Verify JWT** for the public parent-session and booking functions; each checks its own origin/session. Keep `ALLOWED_ORIGINS` restricted to `https://mcm-photography.vercel.app`; parent session and booking functions use the existing `PARENT_ACCESS_HMAC_SECRET` where applicable.

If configuring the project for the first time, set Edge Function secrets in Supabase; do not save them in this repository. Generate a random secret of at least 32 characters for `PARENT_ACCESS_HMAC_SECRET`. On Windows PowerShell:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$parentSecret = [Convert]::ToBase64String($bytes)
$originSecret = "ALLOWED_ORIGINS=https://YOUR-SITE-ORIGIN"
$hmacSecret = "PARENT_ACCESS_HMAC_SECRET=$parentSecret"
supabase secrets set --project-ref emyjyqrzyxjvxlhsxdtd $originSecret $hmacSecret
$rng.Dispose()
```

Supabase supplies the project URL and server keys to deployed functions. The code accepts either legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` or the current `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` environment names. The parent HMAC secret and the allowed origin were configured previously; do not rotate the HMAC secret without also considering existing parent sessions.

The public website code and the dashboard changes must also be deployed to Vercel. The page CMS is intentionally limited to the public HTML fields marked with `data-cms-key`; a new editable field needs a matching key in its page markup.

Current CMS page keys are: `home` (`hero.*`, `about.*`), `about` (`story.*`, `team.image-primary`), `contact` (`booking.*`), `services` (`services.*`), each `service-weddings`, `service-portraits`, `service-metric`, and `service-fashion` page (`hero.*`), `portfolio` (`gallery.*`), and `school-photography` (`hero.*`, `packages.*`). Use the `image` type for image keys and `link` for `home / hero.cta-book`; other keys use `text`.

In Supabase Auth > URL Configuration, keep the Site URL set to `https://mcm-photography.vercel.app/admin/set-password.html` and add these Redirect URLs:

- `https://mcm-photography.vercel.app/admin/set-password.html`
- `https://mcm-photography.vercel.app/admin/dashboard.html`

This lets an invitation open the password-setup page; after the password is saved, the user is sent to the admin dashboard. If changing these settings after an invitation was sent, resend the invitation so its link uses the new destination.

Invite the administrator in Supabase Auth. In the SQL Editor, assign the trusted role to that invited user's UUID:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin","admin_suspended":false}'::jsonb
where id = '<INVITED_USER_UUID>';
```

The administrator must sign in again after this change so the refreshed Auth token contains the role. Do not allow public admin registration. Accept the invitation, set a password at `/admin/set-password.html`, then sign in at `/admin/dashboard.html`.

Use the Supabase Dashboard to inspect the new tables, RLS policies and storage bucket. Test with non-production learner data first. Existing photo rows created before preview generation will not appear in parent galleries until an admin uses **Generate preview**; only approved, active learners may have photos published. Original and watermarked preview objects remain private in `learner-photos`, and the parent portal receives short-lived signed URLs. The separate `site-media` bucket is public. Payment verification is manual; never mark an order verified from a screenshot or message without checking the actual transaction.

### Security and operational requirements

- Keep RLS enabled. Admin browser CRUD is permitted only when the signed-in user has the trusted `app_metadata.role = 'admin'` claim and is not suspended; database policies check the current Auth record so suspensions take effect even for an older token.
- Parent sessions use a random opaque token stored in browser `sessionStorage`, with only an HMAC digest stored in the database. Sessions expire after 15 minutes; signed photo links expire after 5 minutes.
- Parent access is denied unless the learner is active, the school project is active, the school is active, and photo consent is recorded as approved. Store consent source and status accurately; only publish photos when consent is valid. A withdrawn or denied consent blocks new and existing gallery requests.
- Schedule `select public.prune_parent_security_records();` daily through Supabase Cron after enabling `pg_cron`. It removes old access-attempt fingerprints and expired/revoked sessions; the audit log is intentionally retained.
- Parent PINs are salted PBKDF2-SHA-256 hashes and access attempts are rate limited. Set `PARENT_ACCESS_HMAC_SECRET` before deploying parent functions. Configure `ALLOWED_ORIGINS` with the exact production origin; local defaults are for development only.
- The private `learner-photos` bucket restricts uploads to JPEG, PNG or WebP up to 10 MiB. The public `site-media` bucket is only for intentionally public site images and has the same file types and size limit. Verify access policies and storage behavior in the target project before adding real learner photos or public images.
- Keep backups, retention, privacy notices and an incident-response process appropriate for children's photography. Use least privilege for each admin account.
- Orders are paid outside the website; no card data, payment proof, or online gateway is accepted or stored. Admins may record transaction references and mark payment verified only after checking the actual bank transaction.
