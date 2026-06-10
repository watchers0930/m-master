'use client';

import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '@/lib/api/analytics';

interface SettingsState {
  brand_guide: {
    tone: string;
    forbidden_words: string[];
    company_name: string;
    industry: string;
    core_keywords: string[];
    services: string[];
    target_audience: string;
    cta_message: string;
    website_url: string;
  };
  prompt_templates: Record<string, string>;
  budget_monthly: number;
  alert_threshold: number;
  notifications: Record<string, boolean>;
  analytics_keys: { ga4_property_id: string };
}

const INDUSTRY_OPTIONS = [
  '부동산', '건설/시공', 'IT/소프트웨어', '교육', '의료/건강',
  '뷰티/패션', 'F&B', '금융/보험', '제조업', '기타',
];

const NOTIF_LABELS: Record<string, string> = {
  publish_success:      '발행 성공',
  low_score:            'AI 검수 저점 (avg < 75)',
  ai_schedule_complete: 'AI 자동 편성 완료',
  performance_spike:    '성과 급등 (Phase 3)',
  budget_80pct:         '비용 한도 80% 도달',
};

const fieldStyle: React.CSSProperties = {
  width: '100%', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--surface)', padding: '8px 11px', fontSize: 12.5,
  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 4 };

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [forbiddenInput, setForbiddenInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [serviceInput, setServiceInput] = useState('');
  const [ga4Connected, setGa4Connected] = useState(false);
  const [ga4UpdatedAt, setGa4UpdatedAt] = useState<string | null>(null);
  const [ga4Disconnecting, setGa4Disconnecting] = useState(false);

  useEffect(() => {
    // GA4 연결 상태 조회
    fetch('/api/settings/ga4').then(r => r.json()).then((d) => {
      setGa4Connected(!!d.connected);
      setGa4UpdatedAt(d.updated_at ?? null);
    }).catch(() => {});
    // URL 파라미터로 연결 성공 확인
    const params = new URLSearchParams(window.location.search);
    if (params.get('ga4') === 'connected') {
      setGa4Connected(true);
      setGa4UpdatedAt(new Date().toISOString());
      window.history.replaceState({}, '', '/settings');
    }
    getSettings().then((res) => {
      if (res.data) {
        const bg = res.data.brand_guide;
        setSettings({
          brand_guide: {
            tone: bg.tone ?? '',
            forbidden_words: bg.forbidden_words ?? [],
            company_name: bg.company_name ?? '',
            industry: bg.industry ?? '',
            core_keywords: bg.core_keywords ?? [],
            services: bg.services ?? [],
            target_audience: bg.target_audience ?? '',
            cta_message: bg.cta_message ?? '',
            website_url: bg.website_url ?? '',
          },
          prompt_templates: res.data.prompt_templates as Record<string, string>,
          budget_monthly: res.data.budget_monthly,
          alert_threshold: res.data.alert_threshold,
          notifications: res.data.notifications as Record<string, boolean>,
          analytics_keys: {
            ga4_property_id: res.data.analytics_keys?.ga4_property_id ?? '',
          },
        });
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    await updateSettings(settings as unknown as Record<string, unknown>);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addForbiddenWord = () => {
    const w = forbiddenInput.trim();
    if (!w || !settings) return;
    setSettings((prev) => prev ? { ...prev, brand_guide: { ...prev.brand_guide, forbidden_words: [...prev.brand_guide.forbidden_words, w] } } : prev);
    setForbiddenInput('');
  };

  const removeForbiddenWord = (word: string) => {
    setSettings((prev) => prev ? { ...prev, brand_guide: { ...prev.brand_guide, forbidden_words: prev.brand_guide.forbidden_words.filter((w) => w !== word) } } : prev);
  };

  const addTag = (field: 'core_keywords' | 'services', value: string, setter: (v: string) => void) => {
    const v = value.trim();
    if (!v || !settings) return;
    setSettings((prev) => prev ? { ...prev, brand_guide: { ...prev.brand_guide, [field]: [...prev.brand_guide[field], v] } } : prev);
    setter('');
  };
  const removeTag = (field: 'core_keywords' | 'services', value: string) => {
    setSettings((prev) => prev ? { ...prev, brand_guide: { ...prev.brand_guide, [field]: prev.brand_guide[field].filter((w) => w !== value) } } : prev);
  };
  const setBg = (key: string, value: string) => {
    setSettings((prev) => prev ? { ...prev, brand_guide: { ...prev.brand_guide, [key]: value } } : prev);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      </div>
    );
  }

  if (!settings) return null;

  const budgetPct = Math.round((settings.alert_threshold ?? 0.8) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>설정</h1>
          <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>브랜드 가이드·비용 한도·알림을 관리합니다</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary" style={{ fontSize: 12, opacity: saving ? 0.7 : 1 }}>
          {saved ? '저장됨 ✓' : saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* GA4 분석 연동 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M18 20V10M12 20V4M6 20v-6"/>
          </svg>
          <span className="card-title">GA4 분석 연동</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>Google Analytics 4 연동 정보</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ga4Connected ? '#22c55e' : '#9ca3af', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text)' }}>
              {ga4Connected ? `연결됨${ga4UpdatedAt ? ` (${new Date(ga4UpdatedAt).toLocaleDateString('ko-KR')})` : ''}` : '연결 안됨'}
            </span>
          </div>
          <div>
            <label style={labelStyle}>GA4 Property ID</label>
            <input
              style={fieldStyle}
              placeholder="예: 271430539 (숫자만 입력)"
              value={settings.analytics_keys?.ga4_property_id ?? ''}
              onChange={(e) => setSettings((prev) => prev ? { ...prev, analytics_keys: { ...(prev.analytics_keys ?? { ga4_property_id: '' }), ga4_property_id: e.target.value } } : prev)}
            />
            <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 4 }}>GA4 관리 → 속성 설정 → 속성 ID</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12 }}
              onClick={() => { window.location.href = '/api/auth/ga4'; }}
            >
              {ga4Connected ? 'Google 계정 재연결' : 'Google 계정 연결'}
            </button>
            {ga4Connected && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, color: '#dc2626' }}
                disabled={ga4Disconnecting}
                onClick={async () => {
                  setGa4Disconnecting(true);
                  await fetch('/api/settings/ga4', { method: 'DELETE' });
                  setGa4Connected(false);
                  setGa4UpdatedAt(null);
                  setGa4Disconnecting(false);
                }}
              >
                {ga4Disconnecting ? '해제 중...' : '연결 해제'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 브랜드 가이드 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          <span className="card-title">브랜드 가이드</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>콘텐츠 생성 시 GPT-4o에게 전달됩니다</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>톤 & 매너</label>
            <input style={fieldStyle} placeholder="예: 전문적이고 신뢰감 있는, 법률 전문가 관점"
              value={settings.brand_guide.tone}
              onChange={(e) => setSettings((prev) => prev ? { ...prev, brand_guide: { ...prev.brand_guide, tone: e.target.value } } : prev)}
            />
          </div>
          <div>
            <label style={labelStyle}>금지어</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...fieldStyle, flex: 1 }} placeholder="금지어 입력 후 추가"
                value={forbiddenInput}
                onChange={(e) => setForbiddenInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addForbiddenWord(); } }}
              />
              <button onClick={addForbiddenWord} className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>추가</button>
            </div>
            {settings.brand_guide.forbidden_words.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {settings.brand_guide.forbidden_words.map((w) => (
                  <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>
                    {w}
                    <button type="button" onClick={() => removeForbiddenWord(w)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 비즈니스 프로필 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
          </svg>
          <span className="card-title">비즈니스 프로필</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>토픽 추천과 콘텐츠 생성에 반영됩니다</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>회사명</label>
              <input style={fieldStyle} placeholder="예: 한양건설" value={settings.brand_guide.company_name} onChange={(e) => setBg('company_name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>업종</label>
              <select style={fieldStyle} value={settings.brand_guide.industry} onChange={(e) => setBg('industry', e.target.value)}>
                <option value="">선택하세요</option>
                {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>핵심 키워드</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...fieldStyle, flex: 1 }} placeholder="키워드 입력 후 추가 (예: 아파트 시공)" value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag('core_keywords', keywordInput, setKeywordInput); } }} />
              <button onClick={() => addTag('core_keywords', keywordInput, setKeywordInput)} className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>추가</button>
            </div>
            {settings.brand_guide.core_keywords.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {settings.brand_guide.core_keywords.map((w) => (
                  <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>
                    {w}
                    <button type="button" onClick={() => removeTag('core_keywords', w)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 4 }}>토픽 추천 후보 생성에 활용됩니다</p>
          </div>
          <div>
            <label style={labelStyle}>주요 서비스</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...fieldStyle, flex: 1 }} placeholder="서비스 입력 후 추가 (예: 신축 아파트 시공)" value={serviceInput} onChange={(e) => setServiceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag('services', serviceInput, setServiceInput); } }} />
              <button onClick={() => addTag('services', serviceInput, setServiceInput)} className="btn btn-ghost" style={{ fontSize: 11.5, flexShrink: 0 }}>추가</button>
            </div>
            {settings.brand_guide.services.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {settings.brand_guide.services.map((w) => (
                  <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>
                    {w}
                    <button type="button" onClick={() => removeTag('services', w)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>타겟 고객</label>
            <input style={fieldStyle} placeholder="예: 30~50대 내집마련 예비 고객" value={settings.brand_guide.target_audience} onChange={(e) => setBg('target_audience', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>CTA 메시지</label>
            <input style={fieldStyle} placeholder="예: 무료 시공 상담 신청하세요" value={settings.brand_guide.cta_message} onChange={(e) => setBg('cta_message', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>웹사이트 URL</label>
            <input style={fieldStyle} placeholder="예: https://hanyang.co.kr" value={settings.brand_guide.website_url} onChange={(e) => setBg('website_url', e.target.value)} />
          </div>
        </div>
      </div>

      {/* 프롬프트 템플릿 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
          </svg>
          <span className="card-title">프롬프트 템플릿</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>블로그 생성 기본 템플릿</span>
        </div>
        <div style={{ padding: 16 }}>
          <label style={labelStyle}>블로그 템플릿</label>
          <textarea rows={4} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
            value={settings.prompt_templates['blog'] ?? ''}
            onChange={(e) => setSettings((prev) => prev ? { ...prev, prompt_templates: { ...prev.prompt_templates, blog: e.target.value } } : prev)}
          />
          <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 4 }}>사용 가능한 변수: {'{topic}'}, {'{tone}'}, {'{keywords}'}, {'{rag_context}'}</p>
        </div>
      </div>

      {/* 비용 한도 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
          <span className="card-title">비용 한도</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>월간 AI API 사용 예산</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>월간 한도 (원)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={100000} max={2000000} step={50000} value={settings.budget_monthly} style={{ flex: 1, accentColor: 'var(--blue-400)' }}
                onChange={(e) => setSettings((prev) => prev ? { ...prev, budget_monthly: Number(e.target.value) } : prev)}
              />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-700)', width: 90, textAlign: 'right' }}>{settings.budget_monthly.toLocaleString()}원</span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>경고 임계값 (%)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={50} max={95} step={5} value={budgetPct} style={{ flex: 1, accentColor: 'var(--blue-400)' }}
                onChange={(e) => setSettings((prev) => prev ? { ...prev, alert_threshold: Number(e.target.value) / 100 } : prev)}
              />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-700)', width: 40, textAlign: 'right' }}>{budgetPct}%</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 4 }}>예산의 {budgetPct}% 도달 시 알림 발송</p>
          </div>
        </div>
      </div>

      {/* 알림 설정 */}
      <div className="card">
        <div className="card-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span className="card-title">알림</span>
          <span style={{ fontSize: 10, color: 'var(--sub)' }}>발생 시 이메일/콘솔 알림</span>
        </div>
        <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {Object.entries(NOTIF_LABELS).map(([key, label]) => {
            const on = !!settings.notifications[key];
            return (
              <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border2)', cursor: 'pointer' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{label}</span>
                <div style={{ position: 'relative', width: 40, height: 22, flexShrink: 0 }}>
                  <input type="checkbox" checked={on} style={{ display: 'none' }}
                    onChange={(e) => setSettings((prev) => prev ? { ...prev, notifications: { ...prev.notifications, [key]: e.target.checked } } : prev)}
                  />
                  <div onClick={() => setSettings((prev) => prev ? { ...prev, notifications: { ...prev.notifications, [key]: !prev.notifications[key] } } : prev)}
                    style={{ width: 40, height: 22, borderRadius: 11, background: on ? 'var(--blue-400)' : 'var(--n200)', transition: 'background 0.2s', position: 'relative', cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

    </div>
  );
}
