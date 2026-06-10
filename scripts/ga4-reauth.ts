#!/usr/bin/env npx tsx
// scripts/ga4-reauth.ts — GA4 OAuth refresh token 재발급
// 실행: npx tsx scripts/ga4-reauth.ts
// 브라우저가 열리면 Google 계정 로그인 → 허용 클릭 → 자동 완료

import http from 'http';
import { exec } from 'child_process';

const CLIENT_ID = process.env.GA4_OAUTH_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GA4_OAUTH_CLIENT_SECRET ?? '';
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET 환경변수를 설정하세요.');
  process.exit(1);
}
const REDIRECT_URI = 'http://localhost:9876/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n🔑 GA4 OAuth 토큰 재발급\n');
console.log('브라우저가 열립니다. Google 계정으로 로그인 후 "허용"을 눌러주세요.\n');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:9876`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>❌ 인증 실패</h1><p>${error ?? '코드 없음'}</p>`);
    console.error('❌ 인증 실패:', error);
    process.exit(1);
  }

  // authorization code → refresh token 교환
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as Record<string, unknown>;

    if (tokenData.error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>❌ 토큰 교환 실패</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      console.error('❌ 토큰 교환 실패:', tokenData);
      process.exit(1);
    }

    const refreshToken = tokenData.refresh_token as string;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <h1>✅ 토큰 발급 성공!</h1>
      <p>터미널로 돌아가세요. 자동으로 Vercel 환경변수가 업데이트됩니다.</p>
      <p style="color:#888; font-size:12px;">이 탭을 닫아도 됩니다.</p>
    `);

    console.log('\n✅ Refresh Token 발급 성공!\n');
    console.log(`REFRESH_TOKEN: ${refreshToken}\n`);

    // Vercel 환경변수 자동 업데이트
    console.log('📤 Vercel 환경변수 업데이트 중...\n');
    const { execSync } = await import('child_process');

    try {
      execSync('vercel env rm GA4_OAUTH_REFRESH_TOKEN production -y', { stdio: 'pipe' });
    } catch { /* 없으면 무시 */ }

    execSync(`printf '${refreshToken}' | vercel env add GA4_OAUTH_REFRESH_TOKEN production`, { stdio: 'pipe' });
    console.log('✅ GA4_OAUTH_REFRESH_TOKEN 업데이트 완료');

    // Vestra 소스용 토큰도 동일하게 업데이트
    try {
      execSync('vercel env rm GA4_SOURCE_VESTRA_OAUTH_REFRESH_TOKEN production -y', { stdio: 'pipe' });
    } catch { /* 없으면 무시 */ }

    execSync(`printf '${refreshToken}' | vercel env add GA4_SOURCE_VESTRA_OAUTH_REFRESH_TOKEN production`, { stdio: 'pipe' });
    console.log('✅ GA4_SOURCE_VESTRA_OAUTH_REFRESH_TOKEN 업데이트 완료');

    console.log('\n🎉 완료! 재배포하면 방문자분석이 복구됩니다.\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>❌ 서버 오류</h1><pre>${err}</pre>`);
    console.error('❌ 서버 오류:', err);
    process.exit(1);
  }
});

server.listen(9876, () => {
  console.log(`인증 서버 시작 (http://localhost:9876)\n`);
  // 브라우저 자동 열기
  const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${openCmd} "${authUrl}"`);
});
