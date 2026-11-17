import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';

const env = { SESSION_KEY: Buffer.alloc(32, 7).toString('base64'), GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', DASHBOARD_ORIGIN: 'https://dashboard.3dowon.com', DASHBOARD_URL: 'https://dashboard.3dowon.com/', ALLOWED_GITHUB_LOGIN: 'threedowon' };
const request = (path, options={}) => worker.fetch(new Request('https://api.3dowon.com'+path, options), env);

test('OAuth redirects set secure cookies and preserve PKCE/state through callback', async () => {
  const login = await request('/auth/login');
  assert.equal(login.status, 302);
  const url = new URL(login.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^__Host-dowon_oauth=/);
  assert.match(login.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/login/oauth/access_token')) {
      const body = JSON.parse(options.body);
      assert.ok(body.code_verifier);
      return Response.json({access_token:'test-token', expires_in:28800});
    }
    if (String(url).endsWith('/user')) return Response.json({login:'threedowon'});
    if (options.method === 'PUT') { writes++; return Response.json({content:{sha:'next'},commit:{sha:'commit'}}); }
    return Response.json({sha:'current',content:Buffer.from(JSON.stringify({version:1,projects:[]})).toString('base64')});
  };
  try {
    const mismatch = await request('/auth/callback?state=wrong&code=test',{headers:{cookie}});
    assert.equal(mismatch.status,403);
    const callback = await request('/auth/callback?state='+url.searchParams.get('state')+'&code=test',{headers:{cookie}});
    assert.equal(callback.status,302);
    assert.equal(callback.headers.get('location'),env.DASHBOARD_URL);
    const session = callback.headers.getSetCookie().find(c=>c.startsWith('__Host-dowon_session=')).split(';')[0];
    const headers={cookie:session,origin:env.DASHBOARD_ORIGIN,'content-type':'application/json'};
    assert.equal((await request('/api/backup',{headers})).status,200);
    assert.equal((await request('/api/backup',{method:'POST',headers,body:JSON.stringify({sha:'stale',data:{projects:[]}})})).status,409);
    assert.equal(writes,0);
    assert.equal((await request('/api/backup',{method:'POST',headers,body:JSON.stringify({sha:'current',data:{projects:[]}})})).status,200);
    assert.equal(writes,1);
    assert.equal((await request('/api/backup',{headers:{...headers,origin:'https://evil.example'}})).status,403);
    assert.equal((await request('/api/me',{headers:{...headers,cookie:session+'tampered'}})).status,401);
    globalThis.fetch=async()=>new Response('',{status:404});
    assert.equal((await request('/api/backup',{headers})).status,404);
  } finally { globalThis.fetch=original; }
});

test('anonymous requests cannot read private backups', async()=>{
  for(const path of ['/api/ideas','/api/ideas/boards/p','/api/ideas/images/'+('a'.repeat(40))+'/png']){
    assert.equal((await request(path,{headers:{origin:env.DASHBOARD_ORIGIN}})).status,401);
    assert.equal((await request(path,{headers:{origin:'https://evil.example'}})).status,403);
  }
  assert.equal((await request('/api/library',{headers:{origin:env.DASHBOARD_ORIGIN}})).status,401);
  assert.equal((await request('/api/library',{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/api/backup',{headers:{origin:env.DASHBOARD_ORIGIN}})).status,401);
  const preflight=await request('/api/backup',{method:'OPTIONS',headers:{origin:'https://evil.example'}});
  assert.equal(preflight.headers.get('access-control-allow-origin'),null);
});
