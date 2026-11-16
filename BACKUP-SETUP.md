# Dowon Dashboard backup deployment

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
npm test covers OAuth state/PKCE, secure encrypted cookies, origin rejection, anonymous/tampered sessions, and stale-SHA write rejection.
npx wrangler deploy --dry-run validates bundling.
Live completion requires /health configured=true, GitHub login, backup, restore, and private repository commit verification.
Use an unchanged backup or preserve an independent original JSON for live testing; never replace real data with test fixtures.
