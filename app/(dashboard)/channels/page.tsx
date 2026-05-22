// 서버 컴포넌트 — 환경변수 + 토큰 유효성으로 채널 연결 상태 동적 표시
export const dynamic = 'force-dynamic';

type ChannelState = 'connected' | 'expired' | 'disconnected';

async function verifyMetaToken(token: string): Promise<boolean> {
  try {
    const version = process.env.META_GRAPH_VERSION || 'v20.0';
    const res = await fetch(`https://graph.facebook.com/${version}/me?access_token=${token}`, {
      next: { revalidate: 0 },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getChannelStatus(): Promise<{
  naver: ChannelState;
  instagram: ChannelState;
  facebook: ChannelState;
}> {
  // 네이버: 환경변수 존재만 체크 (refresh_token 자동 갱신 지원)
  const naverHasEnv = !!(process.env.NAVER_CAFE_ACCESS_TOKEN && process.env.NAVER_CAFE_CLUB_ID && process.env.NAVER_CAFE_MENU_ID);

  // 인스타/페북: 환경변수 + 토큰 유효성 검증
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igId = process.env.INSTAGRAM_BUSINESS_ID;
  const fbToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const fbId = process.env.FACEBOOK_PAGE_ID;

  const igHasEnv = !!(igToken && igId);
  const fbHasEnv = !!(fbToken && fbId);

  // 환경변수 있는 채널만 병렬 검증
  const [igValid, fbValid] = await Promise.all([
    igHasEnv ? verifyMetaToken(igToken!) : Promise.resolve(false),
    fbHasEnv ? verifyMetaToken(fbToken!) : Promise.resolve(false),
  ]);

  return {
    naver: naverHasEnv ? 'connected' : 'disconnected',
    instagram: igHasEnv ? (igValid ? 'connected' : 'expired') : 'disconnected',
    facebook: fbHasEnv ? (fbValid ? 'connected' : 'expired') : 'disconnected',
  };
}

function Badge({ state }: { state: ChannelState }) {
  if (state === 'connected') {
    return (
      <span style={{ background: '#E8F5E9', border: '1px solid #A5D6A7', color: '#2E7D32', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>연결됨</span>
    );
  }
  if (state === 'expired') {
    return (
      <span style={{ background: '#FFF3E0', border: '1px solid #FFCC80', color: '#E65100', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>토큰 만료</span>
    );
  }
  return (
    <span style={{ background: 'var(--n100)', color: 'var(--sub)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>미연결</span>
  );
}

function maskId(value: string | undefined): string {
  if (!value || value.length < 5) return '***';
  return value.slice(0, 3) + '***' + value.slice(-2);
}

const DESC: Record<string, Record<ChannelState, string>> = {
  naver: {
    connected: '네이버 카페 OpenAPI를 통해 게시글을 자동 발행합니다. 토큰 자동 갱신 지원.',
    expired: '',
    disconnected: '환경변수 미설정: NAVER_CAFE_ACCESS_TOKEN, NAVER_CAFE_CLUB_ID, NAVER_CAFE_MENU_ID',
  },
  instagram: {
    connected: 'Instagram Graph API를 통해 피드 게시물을 자동 발행합니다.',
    expired: '토큰이 만료되었습니다. Meta Graph API Explorer에서 재발급 후 환경변수를 업데이트하세요.',
    disconnected: '환경변수 미설정: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ID',
  },
  facebook: {
    connected: 'Facebook Graph API를 통해 페이지 포스트를 자동 발행합니다.',
    expired: '토큰이 만료되었습니다. Meta Graph API Explorer에서 재발급 후 환경변수를 업데이트하세요.',
    disconnected: '환경변수 미설정: FACEBOOK_ACCESS_TOKEN, FACEBOOK_PAGE_ID',
  },
};

export default async function ChannelsPage() {
  const status = await getChannelStatus();
  const hasIssue = status.naver !== 'connected' || status.instagram !== 'connected' || status.facebook !== 'connected';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>

      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>채널 연동</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>소셜 미디어 채널을 연결하여 자동 발행합니다</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* 블로그 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--blue-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="none" stroke="var(--blue-600)" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round">
              <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>블로그 (HTML Export)</span>
              <span style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-200)', color: 'var(--blue-600)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>연결됨</span>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--sub)' }}>HTML 파일 다운로드 방식. 발행 버튼 클릭 시 og/meta/schema 포함된 HTML 생성.</p>
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>연결 해제</button>
        </div>

        {/* 네이버 카페 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: status.naver === 'connected' ? '#E8F5E9' : 'var(--n50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#03C75A">
              <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>네이버 카페</span>
              <Badge state={status.naver} />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--sub)' }}>{DESC.naver[status.naver]}</p>
            {status.naver === 'connected' && (
              <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 4, fontFamily: 'monospace' }}>
                카페 ID: {maskId(process.env.NAVER_CAFE_CLUB_ID)} / 게시판: {maskId(process.env.NAVER_CAFE_MENU_ID)}
              </p>
            )}
          </div>
          {status.naver === 'connected' && <button className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>연결 해제</button>}
        </div>

        {/* Instagram */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: status.instagram === 'expired' ? '1px solid #FFCC80' : '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: status.instagram === 'connected' ? '#FCE4EC' : 'var(--n50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="#e1306c" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Instagram</span>
              <Badge state={status.instagram} />
            </div>
            <p style={{ fontSize: 11.5, color: status.instagram === 'expired' ? '#E65100' : 'var(--sub)' }}>{DESC.instagram[status.instagram]}</p>
          </div>
          {status.instagram === 'connected' && <button className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>연결 해제</button>}
        </div>

        {/* Facebook */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: status.facebook === 'expired' ? '1px solid #FFCC80' : '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: status.facebook === 'connected' ? '#E3F2FD' : 'var(--n50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="#1877f2" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Facebook</span>
              <Badge state={status.facebook} />
            </div>
            <p style={{ fontSize: 11.5, color: status.facebook === 'expired' ? '#E65100' : 'var(--sub)' }}>{DESC.facebook[status.facebook]}</p>
          </div>
          {status.facebook === 'connected' && <button className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>연결 해제</button>}
        </div>

      </div>

      {/* 안내 */}
      {hasIssue && (
        <div style={{ display: 'flex', gap: 8, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 8, padding: '10px 14px', fontSize: 11.5, color: 'var(--blue-700)' }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span>미연결 채널은 Vercel 환경변수 설정으로, 토큰 만료 채널은 Meta Graph API Explorer에서 재발급 후 활성화됩니다.</span>
        </div>
      )}

    </div>
  );
}
