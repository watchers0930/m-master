'use client';

import { useState } from 'react';
import { searchRagDocs } from '@/lib/api/rag';
import type { RetrievedChunk } from '@/lib/rag/retriever';

export function RagSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    const res = await searchRagDocs(q);
    setResults(res.data?.chunks ?? []);
    setExpanded(new Set());
    setLoading(false);
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const similarityColor = (sim: number) => {
    if (sim >= 0.8) return 'var(--green-500)';
    if (sim >= 0.6) return 'var(--blue-400)';
    return 'var(--sub)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 검색 입력 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="검색어를 입력하세요"
          style={{
            flex: 1, padding: '8px 12px', fontSize: 13,
            border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--bg)', color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--c500)', color: '#fff',
            opacity: loading || !query.trim() ? 0.5 : 1,
          }}
        >
          {loading ? '검색 중…' : '검색'}
        </button>
      </div>

      {/* 로딩 */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        </div>
      )}

      {/* 결과 */}
      {!loading && searched && results.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--sub)', textAlign: 'center', padding: '24px 0' }}>
          검색 결과가 없습니다
        </p>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--sub)' }}>{results.length}건 검색됨</span>
          {results.map((chunk) => {
            const isExpanded = expanded.has(chunk.id);
            const preview = chunk.content.length > 120
              ? chunk.content.slice(0, 120) + '…'
              : chunk.content;
            return (
              <div
                key={chunk.id}
                style={{
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 14px', background: 'var(--bg)',
                }}
              >
                {/* 유사도 바 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border)' }}>
                    <div
                      style={{
                        width: `${Math.round(chunk.similarity * 100)}%`,
                        height: '100%', borderRadius: 2,
                        background: similarityColor(chunk.similarity),
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: similarityColor(chunk.similarity), whiteSpace: 'nowrap' }}>
                    {(chunk.similarity * 100).toFixed(1)}%
                  </span>
                </div>

                {/* 청크 텍스트 */}
                <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {isExpanded ? chunk.content : preview}
                </p>

                {chunk.content.length > 120 && (
                  <button
                    onClick={() => toggle(chunk.id)}
                    style={{
                      marginTop: 6, padding: 0, border: 'none', background: 'none',
                      fontSize: 11, color: 'var(--c500)', cursor: 'pointer',
                    }}
                  >
                    {isExpanded ? '접기' : '더보기'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 빈 상태 안내 */}
      {!searched && !loading && (
        <p style={{ fontSize: 12, color: 'var(--sub)', textAlign: 'center', padding: '24px 0' }}>
          검색어를 입력하면 업로드된 문서에서 관련 내용을 찾아줍니다
        </p>
      )}
    </div>
  );
}
