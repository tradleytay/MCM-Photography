# MCM Photography

## Project layout

- Root HTML files — public pages (home, services, portfolio, contact and school photography), plus compatibility redirects and `404.html`.
- `admin/` — administrator sign-in shell and its dedicated assets.
- `parents/` — parent portal pages and portal-specific scripts.
- `css/`, `js/`, `img/`, and `lib/` — shared styles, scripts, images and vendor libraries.

## Supabase backend

The public brochure pages remain static. The contact form continues to prepare an email or WhatsApp message and does not send data to a backend. Online checkout, payments and order tracking are intentionally not implemented.

The backend project is under `supabase/`:

- `migrations/` — schema, constraints, admin RLS, private photo storage and parent access rate limiting. No learner or school seed data is included.
- `functions/parent-access` — rate-limited PIN verification and a short-lived, learner-scoped parent session.
- `functions/parent-gallery` and `functions/parent-end-session` — private signed photo URLs and session revocation.
- `functions/admin-set-learner-pin` — admin-only PIN hashing and rotation.

The browser uses `js/mcm-backend.js` and `js/backend-config.js`. The configured publishable key is public by design. `backendReady` deliberately remains `false` until the migration, Edge Functions, and first admin account have been deployed; then set it to `true` to unlock the UI. **Never add the Supabase service-role key or the parent HMAC secret to frontend files.**

### Deploy to the Supabase project

The Supabase CLI and local database runtime are not required to browse the site, but are required to apply these migrations and deploy the functions. Install the Supabase CLI, then:

1. Run `supabase login`.
2. Link this checkout to project ref `emyjyqrzyxjvxlhsxdtd` with `supabase link --project-ref emyjyqrzyxjvxlhsxdtd`.
3. Review the migration, then apply it with `supabase db push`.
4. Set Edge Function secrets in Supabase; do not save them in this repository. Set `ALLOWED_ORIGINS` to the exact HTTPS origin hosting this site, and generate a random secret of at least 32 characters for `PARENT_ACCESS_HMAC_SECRET`. On Windows PowerShell, generate it in memory with:

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

   Supabase supplies the project URL and server keys to deployed functions. The code accepts either legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` or the current `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` environment names.
5. Deploy `parent-access`, `parent-gallery`, `parent-end-session` and `admin-set-learner-pin` with `supabase functions deploy <function-name>`.
6. In Supabase Auth > URL Configuration, set the Site URL to `https://mcm-photography.vercel.app/admin/set-password.html` and add these Redirect URLs:
   - `https://mcm-photography.vercel.app/admin/set-password.html`
   - `https://mcm-photography.vercel.app/admin/dashboard.html`

   This lets an invitation open the password-setup page; after the password is saved, the user is sent to the admin dashboard. If changing these settings after an invitation was sent, resend the invitation so its link uses the new destination.
7. Invite the first administrator in Supabase Auth. In the SQL Editor, assign the trusted role to that invited user's UUID:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where id = '<INVITED_USER_UUID>';
   ```

   The administrator must sign in again after this change so the refreshed Auth token contains the role. Do not allow public admin registration.
8. Accept the invitation, set a password at `/admin/set-password.html`, then sign in at `/admin/dashboard.html`. Create schools/projects/classes/learners, set each learner's 6–12 digit PIN, upload photos, and publish photos only when ready.

Use the Supabase Dashboard to inspect migration results and Auth users. Test with non-production learner data first. The parent access code and PIN are checked only in Edge Functions; PIN hashes, sessions and rate-limit records are not readable by browser users. Photo storage is private; gallery links are short-lived.

### Security and operational requirements

- Keep RLS enabled. Admin browser CRUD is permitted only when the verified Supabase Auth token has the trusted `app_metadata.role = 'admin'` claim; the database policies repeat that check.
- Parent sessions use a random opaque token stored in browser `sessionStorage`, with only an HMAC digest stored in the database. Sessions expire after 15 minutes; signed photo links expire after 5 minutes.
- Parent access is denied unless the learner is active, the school project is active, the school is active, and photo consent is recorded as approved. Store consent source and status accurately; only publish photos when consent is valid. A withdrawn or denied consent blocks new and existing gallery requests.
- Schedule `select public.prune_parent_security_records();` daily through Supabase Cron after enabling `pg_cron`. It removes old access-attempt fingerprints and expired/revoked sessions; the audit log is intentionally retained.
- Parent PINs are salted PBKDF2-SHA-256 hashes and access attempts are rate limited. Set `PARENT_ACCESS_HMAC_SECRET` before deploying parent functions. Configure `ALLOWED_ORIGINS` with the exact production origin; local defaults are for development only.
- The private `learner-photos` bucket restricts uploads to JPEG, PNG or WebP up to 10 MiB. Verify access policies and storage behavior in the target project before adding real learner photos.
- Keep backups, retention, privacy notices and an incident-response process appropriate for children's photography. Use least privilege for each admin account.
- Online orders, payment handling and order tracking are intentionally absent until separately scoped and approved.
