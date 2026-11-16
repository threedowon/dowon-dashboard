# Dowon Dashboard — GitHub private backup setup

## Current architecture
- Public UI: `https://threedowon.github.io/dowon-dashboard/`
- Private data: `threedowon/dowon-dashboard-data/projects.json`
- API: Cloudflare Worker `worker/src/index.js`
- Auth: GitHub App user authorization (OAuth), access token stored only in an encrypted HttpOnly cookie in the Worker.
- Local changes save to localStorage even without GitHub connection.
- GitHub backup is manual, creates git commits, and checks content SHA before overwrite.

## Required setup (owner action)
1. Enable GitHub Pages in the public repository's Settings > Pages > Deploy from branch > main > /(root).
2. Register a **GitHub App** at GitHub Settings > Developer settings > GitHub Apps > New GitHub App:
   - Homepage URL: `https://threedowon.github.io/dowon-dashboard/`
   - Callback URL: `https://dowon-dashboard-backup.<your-subdomain>.workers.dev/auth/callback` (replace with actual Worker URL)
   - Webhook: inactive
   - Repository permissions: **Contents: Read and write** only (plus mandatory Metadata read)
   - Install only on `threedowon/dowon-dashboard-data`; account access restricted to `threedowon`
   - Keep Client ID and Client Secret out of public repository.
3. Deploy the Worker from repository root with Wrangler:
   ```sh
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   # Generate a random 32-byte base64 secret locally, e.g. openssl rand -base64 32
   npx wrangler secret put SESSION_KEY
   ```
   `SESSION_KEY` must be **base64 of exactly 32 random bytes**.
   For Github App callback URL use the *actual* deployed worker domain, and update if needed.
4. In Dowon Dashboard choose **GitHub 연결**, enter the exact Worker URL, and authorize GitHub.
5. Use **GitHub 백업** to save, **GitHub 복원** to load. Maintain an independent JSON backup before first restore.

## Important browser compatibility
The current Pages domain (`github.io`) and Worker domain (`workers.dev`) are cross-site. Some browsers block third-party cookies, so authentication may fail. For reliable sessions, use custom domains on the *same site*:
- Dashboard: `dashboard.3dowon.com` (GitHub Pages custom domain)
- Worker: `api.3dowon.com` (Cloudflare Worker custom domain)

When switching to custom domain, update `DASHBOARD_ORIGIN`, `DASHBOARD_URL`, GitHub App callback URL, and reconnect the app. The Worker uses strict Origin validation and no wildcard CORS.

## Security and limitations
- Do not paste a GitHub personal access token into HTML or browser localStorage.
- Do not commit GitHub Client Secret or SESSION_KEY.
- GitHub App installation must be limited to the private backup repository.
- Restore replaces all local projects after confirmation.
- GitHub writes use SHA compare-and-swap; conflicts require refreshing the backup.
- This is an implementation scaffold: GitHub App authorization and Worker deployment must be completed and live-tested before production use.
