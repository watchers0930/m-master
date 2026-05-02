"use client";

import type { FormEvent } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import type { ProjectPreview, SourceFileDraft } from "@/features/dashboard/types";

type ProjectIntakeFormProps = {
  name: string;
  domain: string;
  workingPath: string;
  files: SourceFileDraft[];
  preview: ProjectPreview | null;
  loading: boolean;
  folderSupported: boolean | null;
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
      description="프로젝트명과 도메인만으로도 시작할 수 있습니다. 여기서는 입력 소스가 제대로 읽히는지만 먼저 확인하고, 브랜드 초안 편집은 Step 2에서 진행합니다."
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
          <p className="fine-print">도메인만 입력해도 사이트를 읽어 브랜드 컨텍스트 초안을 자동 수집합니다.</p>
        </div>

        <div className="field-group">
          <details className="inline-details">
            <summary>작업 폴더 연결은 선택 사항입니다</summary>
            <div className="inline-details-body">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <label className="field-label">작업 폴더 선택</label>
                <button className="button ghost" type="button" onClick={() => void onPickFolder()}>
                  폴더 선택
                </button>
              </div>
              <div className="insight-item folder-empty-state">
                <strong>{workingPath || "아직 선택된 폴더가 없습니다."}</strong>
                <div className="fine-print">
                  {folderSupported === null
                    ? "브라우저 지원 여부를 확인한 뒤 여기서 추가 문서를 연결할 수 있습니다."
                    : folderSupported
                      ? "문서를 추가로 연결하면 브라우저가 읽을 수 있는 파일 메타데이터와 본문 일부를 추출해 사이트 분석과 함께 사용합니다."
                      : "현재 브라우저는 폴더 선택 API를 지원하지 않습니다. 이 경우에도 도메인만으로 기본 컨텍스트 초안을 만들 수 있습니다."}
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
          </details>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="button-row">
          <button className="button primary" disabled={loading} type="submit">
            {loading ? "생성 중" : "프로젝트 저장"}
          </button>
          <button className="button" disabled={loading} type="button" onClick={() => void onPreview()}>
            {loading ? "수집 결과 생성 중" : "저장 전 미리 확인"}
          </button>
        </div>

        {preview ? (
          <div className="insight-list">
            <div className="step-focus-card">
              <strong>이제 확인할 것</strong>
              <p className="fine-print">
                소스 근거와 주제 후보만 빠르게 보고 괜찮으면 바로 저장하면 됩니다.
              </p>
            </div>
            <div className="insight-item">
              <strong>입력 확인</strong>
              <p className="fine-print">{name || "프로젝트명 없음"} · {domain || "도메인 없음"} · 폴더 {files.length}개 연결</p>
            </div>
            <div className="insight-item">
              <strong>주제 후보</strong>
              <p className="fine-print">
                {preview.topics.slice(0, 3).map((topic) => topic.title).join(", ") || "주제 후보 없음"}
              </p>
            </div>
            <SourceAnalysisPanel
              analysis={preview.sourceAnalysis}
              title="수집된 소스 근거"
              description="저장 전에 어떤 파일과 excerpt가 실제 컨텍스트 초안에 반영되는지 먼저 확인합니다."
            />
            <div className="insight-item">
              <strong>다음 단계 안내</strong>
              <p className="fine-print">
                Step 1은 수집 결과만 확인합니다. 브랜드 요약, 타겟, 톤, CTA 수정과 승인은 Step 2에서 진행합니다.
              </p>
            </div>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}
