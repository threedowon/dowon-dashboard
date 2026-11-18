# Dowon Dashboard backup deployment

## Temporary file transfers

The `#transfers` page uses a separate private Cloudflare R2 bucket, never the GitHub data repository. The existing GitHub session authenticates all list/upload/download/delete requests. Files are limited to 5 GiB each (8 MiB multipart chunks; zero-byte files use the legacy small-file endpoint), with 1-minute, 5-minute, or 10-minute (default and maximum) retention. Retention starts at upload completion. Failed parts retry up to three times; interrupted uploads expire after 24 hours. Downloads stream directly to the browser without a full-file Blob in JavaScript. Downloads already started before expiration can finish; downloaded PC copies are unaffected by expiration.

One-time setup, using Node 22.12+ and an authenticated Wrangler CLI:

1. Enable R2 in the Cloudflare account if needed (review any billing requirements in Cloudflare).
2. Run `npx wrangler r2 bucket create dowon-dashboard-transfers`. Keep public access disabled; no r2.dev or custom public domain is needed.
3. Deploy the Worker with `npm run deploy` and publish the updated dashboard through its existing GitHub Pages workflow. The `TRANSFERS` binding and 1-minute Cron Trigger are in `wrangler.toml`.
4. As a storage safety net, configure a bucket lifecycle rule removing objects under `transfers/` after 1 day. The API independently checks the selected expiry on every download; lifecycle deletion alone is not the access control.
5. Log in on both PCs, upload a disposable file, refresh the second PC, and verify its downloaded bytes. Verify manual deletion and check scheduled Worker logs for cleanup failures.

Expired objects are immediately excluded from the list and rejected for new downloads, even if cleanup is delayed. The scheduled handler removes expired objects every minute when Cloudflare runs the trigger. Missing R2 configuration shows a setup message, not an empty successful list. Do not store transfer files in this checkout. R2 storage/operation charges depend on account usage; this feature does not enforce a total storage quota. Local previews do not access production storage.

## Production addresses
- Dashboard: https://dashboard.3dowon.com (GitHub Pages, main / root)
- API: https://api.3dowon.com (Cloudflare Worker dowon-dashboard-backup)
- Private backup: threedowon/dowon-dashboard-data/projects.json
- Existing www.3dowon.com and other DNS records must remain unchanged.

## GitHub App
App: Dowon Dashboard Backup (owner threedowon).
Homepage: https://dashboard.3dowon.com
OAuth callback: https://api.3dowon.com/auth/callback
Webhook disabled; expiring user tokens enabled. No wildcard callbacks.
Install on dowon-dashboard-data only, Contents read/write and mandatory Metadata read.
No private key is required by this user-OAuth implementation.

## Cloudflare
The zone already uses Cloudflare authoritative DNS; no Porkbun nameserver change is needed.
Add dashboard CNAME to threedowon.github.io with DNS only. Enable HTTPS in GitHub Pages after certificate issuance.
wrangler.toml defines only the api.3dowon.com custom domain and this Worker's variables.
Cloudflare Workers Builds may deploy the public code repository with npm ci, npm test, and npx wrangler deploy.

Set these Worker secrets (never put values in Git, chat, screenshots, or build variables):
- GITHUB_CLIENT_ID: GitHub App client ID
- GITHUB_CLIENT_SECRET: GitHub App OAuth client secret
- SESSION_KEY: base64 encoding of exactly 32 cryptographically random bytes

CLI alternative: npm ci, npx wrangler login, npx wrangler secret put NAME, npm run deploy.
Rotate SESSION_KEY to invalidate existing sessions. Sessions expire within eight hours; reconnect afterward.

## Usage and recovery
Click GitHub 연결 and authorize the app, then GitHub 복원 or GitHub 백업.
API address is fixed to api.3dowon.com; no user-supplied third-party backup destination.
Restore first stores the previous data under localStorage key dowon-dashboard:v1:before-restore and downloads a JSON copy.
Retain that JSON until restored data has been checked. Use JSON 불러오기 to undo a restore.
Backups create commits, compare the current content SHA, and reject concurrent writes.
A missing/inaccessible backup returns an error, never a misleading successful empty restore.
Moving from a previous origin does not move browser-local data: export JSON on the old address and import on the new address.

## Verification
WireNest: open #wirenest. The new-work button opens the existing WireNest app in a separate window. Save a `.wnest` there, then manually upload it to the dashboard (25 MiB per file). Each upload is a separate backup, including repeated filenames; there is no automatic sync. Download a backup and use File → Open in WireNest to continue working. Search, upload retry and confirmed deletion are available. Localhost is a screen preview only; production-origin authentication remains required for backup operations.

WireNest uses `/api/wirenest`, `wirenest/index.json` and `wirenest/files/<UUID>.wnest` in the same private data repository. It shares the library's atomic commit and revision-conflict handling, with separate metadata and file paths. Uploads must be JSON with the WireNest app marker, a positive integer version, and boards/nodes/wires records. Bytes are preserved on download. Deploy both the Worker and dashboard to enable this feature; no new credentials or permissions are needed.

PDF library: open #pdf, connect GitHub, upload PDFs (10 MiB per file), then filter by tags or search title/filename/tags. Titles and tags save immediately. Other devices load the library directly; milestone backup/restore does not include or overwrite PDFs. Shared HTML does not include private PDF content. Up to 1,000 documents / 900 KB metadata are supported.

Storage: library/index.json and library/files/<UUID>.pdf in the same private data repository. No new secrets or App permissions are needed. Upload commits file and metadata atomically using a base tree and non-force branch update. Concurrent branch changes retry from the newest commit; stale edits to the same document are rejected by revision. Files are returned only through authenticated, origin-restricted API responses with no-store headers. The PDF header check is a format check, not malware scanning.

npm test covers OAuth state/PKCE, secure encrypted cookies, origin rejection, anonymous/tampered sessions, and stale-SHA write rejection.
npx wrangler deploy --dry-run validates bundling.
Live completion requires /health configured=true, GitHub login, backup, restore, and private repository commit verification.
Use an unchanged backup or preserve an independent original JSON for live testing; never replace real data with test fixtures.
