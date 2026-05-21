'use client';

import React, { useState, useEffect, useRef, type FormEvent } from 'react';
import { generateKeywords } from '@/lib/api/content';
import { createSlot } from '@/lib/api/schedule';
import type { ContentGenerateResponse } from '@/types/api';
import { ScheduleCalendarPicker } from './ScheduleCalendarPicker';
import { TopicSuggestionModal } from './TopicSuggestionModal';

interface GenerateFormProps {
  initialTopic?: string;
  onResult: (result: ContentGenerateResponse) => void;
  onStreamStart: () => void;
  onStreamDelta: (delta: string) => void;
}

export function GenerateForm({ initialTopic, onResult, onStreamStart, onStreamDelta }: GenerateFormProps) {
  const [topic, setTopic] = useState(initialTopic ?? '');
  const [tone, setTone] = useState('전문적');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [useRag, setUseRag] = useState(true);
  const [refUrl, setRefUrl] = useState('');
  const [refFiles, setRefFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [kwLoading, setKwLoading] = useState(false);
  const [editingKw, setEditingKw] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [topicModalOpen, setTopicModalOpen] = useState(false);

  const applySuggestedTopic = async (t: string) => {
    setTopic(t);
    setError('');
    setKwLoading(true);
    try {
      const res = await generateKeywords(t);
      if (res.data) {
        setKeywords(prev => Array.from(new Set([...prev, ...res.data!])));
      }
    } finally {
      setKwLoading(false);
    }
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !keywords.includes(kw)) {
      setKeywords((prev) => [...prev, kw]);
    }
    setKeywordInput('');
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const autoGenerateKeywords = async () => {
    if (!topic.trim()) { setError('토픽을 먼저 입력해주세요'); return; }
    setKwLoading(true);
    const res = await generateKeywords(topic.trim());
    setKwLoading(false);
    if (res.data) {
      const merged = Array.from(new Set([...keywords, ...res.data]));
      setKeywords(merged);
    }
  };

  // initialTopic이 주어지면 mount 시 1회 자동 키워드 생성 (UX 편의)
  const initialTopicTriggered = useRef(false);
  useEffect(() => {
    if (initialTopicTriggered.current) return;
    const t = (initialTopic ?? '').trim();
    if (!t) return;
    initialTopicTriggered.current = true;
    (async () => {
      setKwLoading(true);
      try {
        const res = await generateKeywords(t);
        if (res.data) {
          setKeywords(prev => Array.from(new Set([...prev, ...res.data!])));
        }
      } finally {
        setKwLoading(false);
      }
    })();
  }, [initialTopic]);

  const startEdit = (kw: string) => { setEditingKw(kw); setEditingValue(kw); };
  const commitEdit = () => {
    const trimmed = editingValue.trim();
    if (trimmed && trimmed !== editingKw) {
      setKeywords(prev => prev.map(k => k === editingKw ? trimmed : k));
    }
    setEditingKw(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) { setError('토픽을 입력해주세요'); return; }
    setError('');
    setLoading(true);
    onStreamStart();

    try {
      const res = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          channel: 'blog',
          tone: tone.trim() || undefined,
          keywords: keywords.length > 0 ? keywords : undefined,
          use_rag: useRag,
        }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({ error: { message: '서버 오류' } }));
        setError(json?.error?.message ?? '서버 오류');
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = JSON.parse(line.slice(6)) as { type: string; text?: string; data?: ContentGenerateResponse; message?: string };
          if (json.type === 'delta' && json.text) {
            onStreamDelta(json.text);
          } else if (json.type === 'done' && json.data) {
            onResult(json.data);
            if (scheduledDate) {
              await createSlot({ content_id: json.data.id, channel: 'blog', scheduled_at: `${scheduledDate}T09:00:00Z` });
            }
          } else if (json.type === 'error') {
            setError(json.message ?? 'AI 생성 실패');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setLoading(false);
    }
  };

  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--sub)', marginBottom: 4, display: 'block' };
  const fieldInput: React.CSSProperties = { width: '100%', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', padding: '8px 11px', fontSize: 12.5, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' };

  return (
    <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, gap: 14 }}>
      {/* 채널 — 고정 */}
      <div>
        <label style={fieldLabel}>채널</label>
        <div style={{ ...fieldInput, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--n50)', color: 'var(--blue-700)', fontWeight: 600 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
          </svg>
          블로그 (Phase 1 고정)
        </div>
      </div>

      {/* 토픽 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...fieldLabel, marginBottom: 0 }}>토픽 *</label>
          <button
            type="button"
            onClick={() => setTopicModalOpen(true)}
            className="btn btn-ghost"
            style={{ fontSize: 10, padding: '3px 9px', gap: 4 }}
            title="이달 추천 토픽 TOP 5 보기"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/><polyline points="17,6 23,6 23,12"/>
            </svg>
            추천 토픽 보기
          </button>
        </div>
        <input
          type="search"
          style={{ ...fieldInput, borderColor: error ? '#f87171' : 'var(--border)' }}
          placeholder="예: 아파트 매매 등기 절차와 비용"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onBlur={async (e) => {
            const t = e.target.value.trim();
            if (!t) return;
            setKwLoading(true);
            const res = await generateKeywords(t);
            setKwLoading(false);
            if (res.data) {
              setKeywords(prev => Array.from(new Set([...prev, ...res.data!])));
            }
          }}
        />
        {error && <p style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{error}</p>}
      </div>

      {/* 톤 */}
      <div>
        <label style={fieldLabel}>톤</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['전문적', '친근한', '정보제공', '설득적'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              style={{
                borderRadius: 20, padding: '4px 12px', fontSize: 11.5, fontWeight: 600,
                border: tone === t ? '1px solid var(--blue-500)' : '1px solid var(--border)',
                background: tone === t ? 'var(--blue-500)' : 'var(--surface)',
                color: tone === t ? '#fff' : 'var(--sub)',
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 키워드 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...fieldLabel, marginBottom: 0 }}>SEO 키워드 <span style={{ fontWeight: 400, color: 'var(--n400)' }}>(해시태그로 활용)</span></label>
          <button type="button" onClick={autoGenerateKeywords} disabled={kwLoading} className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 9px', gap: 4, opacity: kwLoading ? 0.6 : 1 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
            </svg>
            {kwLoading ? '생성 중...' : '자동 생성'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...fieldInput, flex: 1 }}
            placeholder="키워드 직접 입력 후 추가"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
          />
          <button type="button" onClick={addKeyword} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px', flexShrink: 0 }}>추가</button>
        </div>
        {keywords.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {keywords.map((kw) => (
              editingKw === kw ? (
                <span key={kw} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 20, background: 'var(--blue-50)', border: '1.5px solid var(--blue-500)', padding: '1px 6px' }}>
                  <input
                    autoFocus
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingKw(null); }}
                    style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 11, color: 'var(--blue-700)', width: Math.max(editingValue.length * 9, 60) + 'px', fontFamily: 'inherit' }}
                  />
                </span>
              ) : (
                <span key={kw} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 20, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', padding: '2px 10px', fontSize: 11, color: 'var(--blue-700)' }}>
                  <span onClick={() => startEdit(kw)} style={{ cursor: 'text' }} title="클릭하여 편집">#{kw}</span>
                  <button type="button" onClick={() => removeKeyword(kw)} style={{ color: 'var(--sub)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                </span>
              )
            ))}
          </div>
        )}
      </div>

      {/* RAG 참조 */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--sub)' }}>
          <input type="checkbox" checked={useRag} onChange={(e) => setUseRag(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--blue-500)', cursor: 'pointer' }} />
          RAG 문서 DB에서 관련 내용 참조
        </label>

        {/* 참조 URL */}
        <div>
          <label style={fieldLabel}>참조 사이트 URL <span style={{ fontWeight: 400, color: 'var(--n400)' }}>(크롤링 후 컨텍스트 사용)</span></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, ...fieldInput }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
              <input
                type="text"
                placeholder="example.com/article"
                value={refUrl}
                onChange={(e) => {
                  const v = e.target.value;
                  setRefUrl(v.startsWith('http') ? v : v ? `https://${v}` : '');
                }}
                onFocus={(e) => {
                  if (e.target.value === 'https://') setRefUrl('');
                }}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12.5, color: 'var(--text)', background: 'transparent', fontFamily: 'inherit' }}
              />
            </div>
          </div>
        </div>

        {/* 파일 업로드 */}
        <div>
          <label style={fieldLabel}>참조 파일 업로드 <span style={{ fontWeight: 400, color: 'var(--n400)' }}>(PDF · DOCX · TXT · 복수 선택 가능)</span></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...fieldInput, cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span style={{ fontSize: 12.5, color: 'var(--sub)' }}>파일 선택 또는 끌어다 놓기</span>
            <input type="file" accept=".pdf,.docx,.txt" multiple
              onChange={(e) => {
                const newFiles = Array.from(e.target.files ?? []);
                setRefFiles(prev => [...prev, ...newFiles.filter(f => !prev.some(p => p.name === f.name))]);
                e.target.value = '';
              }}
              style={{ display: 'none' }} />
          </label>
          {refFiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              {refFiles.map((file, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, background: 'var(--blue-50)', border: '1px solid var(--blue-200)' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--blue-500)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
                  </svg>
                  <span style={{ fontSize: 11.5, color: 'var(--blue-700)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--sub)', flexShrink: 0 }}>{(file.size / 1024).toFixed(0)}KB</span>
                  <button type="button" onClick={() => setRefFiles(prev => prev.filter((_, j) => j !== i))}
                    style={{ color: 'var(--sub)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 발행 예정일 */}
      <div>
        <label style={fieldLabel}>발행 예정일 <span style={{ fontWeight: 400, color: 'var(--n400)' }}>(선택)</span></label>
        <ScheduleCalendarPicker value={scheduledDate} onChange={(d) => setScheduledDate(d || null)} />
      </div>

      {/* 생성 버튼 */}
      <button type="submit" disabled={loading} className="btn btn-primary btn-full" style={{ fontSize: 13, padding: '11px 0', opacity: loading ? 0.7 : 1 }}>
        {loading ? '생성 중...' : '콘텐츠 생성'}
      </button>

      <TopicSuggestionModal
        open={topicModalOpen}
        onClose={() => setTopicModalOpen(false)}
        onSelect={applySuggestedTopic}
      />
    </form>
  );
}
