// lib/rag/chunker.ts — PDF/MD/DOCX 텍스트 추출 + 슬라이딩 윈도우 청킹
// 청킹 전략: 500토큰 단위, 100토큰 overlap

import type { SourceType } from '@/types/db';

// 토큰 추정 (영어 4자/토큰, 한글 1.5자/토큰 근사)
function estimateTokens(text: string): number {
  const korean = (text.match(/[가-힣]/g) ?? []).length;
  const others = text.length - korean;
  return Math.ceil(korean / 1.5 + others / 4);
}

// ----------------------------------------------------------------
// 슬라이딩 윈도우 청킹 (단어/문장 경계 존중)
// ----------------------------------------------------------------
const CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 100;

export interface TextChunk {
  content: string;
  chunk_index: number;
  tokens: number;
}

export function chunkBySlidingWindow(text: string): TextChunk[] {
  // 문장 단위로 분리 (한국어/영어 혼용 대응)
  const sentences = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?。\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: TextChunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const sentTokens = estimateTokens(sentence);

    // 단일 문장이 CHUNK_TOKENS 초과 시 강제 분할
    if (sentTokens > CHUNK_TOKENS) {
      // 기존 버퍼 먼저 저장
      if (buffer.length > 0) {
        const content = buffer.join(' ');
        chunks.push({ content, chunk_index: chunkIndex++, tokens: bufferTokens });
        buffer = [];
        bufferTokens = 0;
      }
      // 긴 문장을 글자 수 기준으로 분할
      const words = sentence.split(/\s+/);
      let wordBuf: string[] = [];
      let wordTokens = 0;
      for (const word of words) {
        const wt = estimateTokens(word);
        if (wordTokens + wt > CHUNK_TOKENS && wordBuf.length > 0) {
          const content = wordBuf.join(' ');
          chunks.push({ content, chunk_index: chunkIndex++, tokens: wordTokens });
          wordBuf = [];
          wordTokens = 0;
        }
        wordBuf.push(word);
        wordTokens += wt;
      }
      if (wordBuf.length > 0) {
        buffer = wordBuf;
        bufferTokens = wordTokens;
      }
      continue;
    }

    if (bufferTokens + sentTokens > CHUNK_TOKENS && buffer.length > 0) {
      // 현재 버퍼 저장
      const content = buffer.join(' ');
      chunks.push({ content, chunk_index: chunkIndex++, tokens: bufferTokens });

      // overlap: 마지막 문장들 재사용
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = buffer.length - 1; i >= 0; i--) {
        const t = estimateTokens(buffer[i]);
        if (overlapTokens + t > OVERLAP_TOKENS) break;
        overlap.unshift(buffer[i]);
        overlapTokens += t;
      }
      buffer = overlap;
      bufferTokens = overlapTokens;
    }

    buffer.push(sentence);
    bufferTokens += sentTokens;
  }

  // 나머지
  if (buffer.length > 0) {
    const content = buffer.join(' ');
    chunks.push({ content, chunk_index: chunkIndex++, tokens: bufferTokens });
  }

  return chunks;
}

// ----------------------------------------------------------------
// MD: 헤더 기준 섹션 분리 후 500토큰 미만이면 그대로, 초과 시 슬라이딩
// ----------------------------------------------------------------
export function chunkMarkdown(text: string): TextChunk[] {
  const sections = text.split(/^#{1,3}\s/m).filter((s) => s.trim().length > 0);
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const trimmed = section.trim();
    const tokens = estimateTokens(trimmed);

    if (tokens <= CHUNK_TOKENS) {
      chunks.push({ content: trimmed, chunk_index: chunkIndex++, tokens });
    } else {
      const subChunks = chunkBySlidingWindow(trimmed);
      for (const sub of subChunks) {
        chunks.push({ ...sub, chunk_index: chunkIndex++ });
      }
    }
  }

  return chunks.length > 0
    ? chunks
    : chunkBySlidingWindow(text);
}

// ----------------------------------------------------------------
// PDF 텍스트 추출 (unpdf — 서버리스 네이티브 지원)
// ----------------------------------------------------------------
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text as string;
}

// ----------------------------------------------------------------
// DOCX 텍스트 추출 (mammoth)
// ----------------------------------------------------------------
export async function extractDocxText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// ----------------------------------------------------------------
// 통합 진입점: 파일 타입별 청킹
// ----------------------------------------------------------------
export async function chunkFile(
  buffer: Buffer,
  sourceType: Extract<SourceType, 'pdf' | 'md' | 'docx'>,
): Promise<TextChunk[]> {
  switch (sourceType) {
    case 'pdf': {
      const text = await extractPdfText(buffer);
      return chunkBySlidingWindow(text);
    }
    case 'docx': {
      const text = await extractDocxText(buffer);
      return chunkBySlidingWindow(text);
    }
    case 'md': {
      const text = buffer.toString('utf-8');
      return chunkMarkdown(text);
    }
    default: {
      const exhaustive: never = sourceType;
      throw new Error(`지원하지 않는 source_type: ${exhaustive}`);
    }
  }
}
