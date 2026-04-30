"use client";

import type { FormEvent } from "react";

import { SectionCard } from "@/components/ui/section-card";
import type { ProjectPreview, SourceFileDraft } from "@/features/dashboard/types";

type ProjectIntakeFormProps = {
  name: string;
  domain: string;
  workingPath: string;
  files: SourceFileDraft[];
  preview: ProjectPreview | null;
  loading: boolean;
  folderSupported: boolean;
  error?: string | null;
  onNameChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onPickFolder: () => Promise<void>;
  onPreview: () => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function ProjectIntakeForm(props: ProjectIntakeFormProps) {
  const {
    name,
    domain,
    workingPath,
    files,
    preview,
    loading,
    folderSupported,
    error,
    onNameChange,
    onDomainChange,
    onPickFolder,
    onPreview,
    onSubmit,
  } = props;

  return (
    <SectionCard
      title="프로젝트 생성"
      description="프로젝트명, 도메인, 작업 폴더를 연결해 컨텍스트 초안과 추천 주제를 먼저 확인합니다."
      badge="Step 1"
      tone="soft"
    >
      <form className="form-grid" onSubmit={onSubmit}>
        <div className="field-group">
          <label className="field-label" htmlFor="project-name">
            프로젝트 이름
          </label>
          <input
            id="project-name"
            className="text-input"
            placeholder="예: Vestra Content Ops"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="project-domain">
            대표 도메인
          </label>
          <input
            id="project-domain"
            className="text-input"
            placeholder="예: vestra.kr"
            value={domain}
            onChange={(event) => onDomainChange(event.target.value)}
          />
          <p className="fine-print">도메인 정보는 CTA와 핵심 메시지 구조화에 반영됩니다.</p>
        </div>

        <div className="field-group">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label className="field-label">작업 폴더 선택</label>
            <button className="button ghost" type="button" onClick={() => void onPickFolder()}>
              폴더 선택
            </button>
          </div>
          <div className="insight-item">
            <strong>{workingPath || "아직 선택된 폴더가 없습니다."}</strong>
            <div className="fine-print">
              {folderSupported
                ? "브라우저가 읽을 수 있는 문서 파일의 메타데이터와 본문 일부를 추출해 초안 분석에 사용합니다."
                : "현재 브라우저는 폴더 선택 API를 지원하지 않습니다. Chromium 기반 브라우저에서 테스트하는 것이 좋습니다."}
            </div>
          </div>
          {files.length > 0 ? (
            <div className="file-chip-wrap">
              {files.map((file) => (
                <div className="file-chip" key={`${file.relativePath || file.name}-${file.size ?? 0}`}>
                  <strong>{file.name}</strong>
                  <span className="fine-print">
                    {file.relativePath || "root"} · {file.extension || file.mimeType || "text"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="button-row">
          <button className="button" disabled={loading} type="button" onClick={() => void onPreview()}>
            {loading ? "초안 생성 중" : "컨텍스트 미리보기"}
          </button>
          <button className="button primary" disabled={loading} type="submit">
            {loading ? "생성 중" : "프로젝트 저장"}
          </button>
        </div>

        {preview ? (
          <div className="insight-list">
            <div className="insight-item">
              <strong>서비스 요약 초안</strong>
              <p className="fine-print">{preview.brandProfile.summary}</p>
            </div>
            <div className="insight-item">
              <strong>핵심 타겟</strong>
              <p className="fine-print">{preview.brandProfile.audience || "타겟 초안 없음"}</p>
            </div>
            <div className="insight-item">
              <strong>문서 분석 요약</strong>
              <p className="fine-print">
                총 {preview.sourceAnalysis.totalFiles}개 파일, excerpt 보유 {preview.sourceAnalysis.filesWithExcerpt}개
              </p>
              <p className="fine-print">
                형식 분포: {preview.sourceAnalysis.fileTypeBreakdown.map((item) => `${item.key} ${item.count}`).join(", ") || "없음"}
              </p>
            </div>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}
