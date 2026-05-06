"use client";

import type { FormEvent } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import type { ProjectPreview, SourceFileDraft } from "@/features/dashboard/types";

type ProjectIntakeFormProps = {
  name: string;
  domain: string;
  industry: string;
  workingPath: string;
  files: SourceFileDraft[];
  preview: ProjectPreview | null;
  loading: boolean;
  folderSupported: boolean | null;
  error?: string | null;
  onNameChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onPickFolder: () => Promise<void>;
  onPreview: () => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function ProjectIntakeForm(props: ProjectIntakeFormProps) {
  const {
    name,
    domain,
    industry,
    workingPath,
    files,
    preview,
    loading,
    folderSupported,
    error,
    onNameChange,
    onDomainChange,
    onIndustryChange,
    onPickFolder,
    onPreview,
    onSubmit,
  } = props;

  return (
    <SectionCard
      title="사이트 등록"
      description="사이트 주소를 넣으면 브랜드 콘텍스트 초안과 작성 테마 후보를 만듭니다. 추가 문서가 있으면 폴더로 연결하고, 없으면 URL만으로 바로 시작하면 됩니다."
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
            placeholder="예: Vestra 서비스 소개"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="project-domain">
            사이트 주소
          </label>
          <input
            id="project-domain"
            className="text-input"
            placeholder="예: https://example.com"
            value={domain}
            onChange={(event) => onDomainChange(event.target.value)}
          />
          <p className="fine-print">전체 URL이나 도메인 모두 입력할 수 있습니다. 입력한 사이트를 읽어 브랜드 컨텍스트와 주제 후보를 자동 추출합니다.</p>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="project-industry">
            업종 분류
          </label>
          <select
            id="project-industry"
            className="text-input"
            value={industry}
            onChange={(event) => onIndustryChange(event.target.value)}
          >
            <option value="general">일반</option>
            <option value="real-estate">부동산</option>
            <option value="marketing">마케팅</option>
            <option value="saas">SaaS</option>
            <option value="finance">금융</option>
          </select>
          <p className="fine-print">선택한 업종은 해시태그 추천과 채널 초안의 실무 가이드 우선순위에 반영됩니다.</p>
        </div>

        <div className="field-group">
          <details className="inline-details">
            <summary>추가 자료 연결은 선택 사항입니다</summary>
            <div className="inline-details-body">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <label className="field-label">브로슈어·소개서 폴더 선택</label>
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
                      ? "소개서, 서비스 문서, 안내문을 연결하면 사이트 분석과 함께 읽어서 더 정확한 콘텍스트와 테마를 만듭니다."
                      : "현재 브라우저는 폴더 선택 API를 지원하지 않습니다. 이 경우에도 사이트 주소만으로 기본 콘텍스트 초안을 만들 수 있습니다."}
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
            {loading ? "생성 중" : "사이트 분석 시작"}
          </button>
          <button className="button" disabled={loading} type="button" onClick={() => void onPreview()}>
            {loading ? "수집 결과 생성 중" : "분석 결과 미리 보기"}
          </button>
        </div>

        {preview ? (
          <div className="insight-list">
            <div className="step-focus-card">
              <strong>이제 확인할 것</strong>
              <p className="fine-print">
                사이트에서 어떤 콘텍스트와 테마 후보를 읽었는지만 빠르게 보고 괜찮으면 바로 시작하면 됩니다.
              </p>
            </div>
            <div className="insight-item">
              <strong>입력 확인</strong>
              <p className="fine-print">{name || "프로젝트명 없음"} · {domain || "사이트 주소 없음"} · 참고 문서 {files.length}개 연결</p>
            </div>
            <div className="insight-item">
              <strong>작성 테마 후보</strong>
              <p className="fine-print">
                {preview.topics.slice(0, 3).map((topic) => topic.title).join(", ") || "테마 후보 없음"}
              </p>
            </div>
            <SourceAnalysisPanel
              analysis={preview.sourceAnalysis}
              title="수집된 소스 근거"
              description="어떤 사이트 정보와 문서 내용이 실제 콘텍스트 초안에 반영되는지 확인합니다."
            />
            <div className="insight-item">
              <strong>다음 단계 안내</strong>
              <p className="fine-print">
                다음 단계에서 브랜드 콘텍스트를 정리하고, 그 다음 단계에서 이번에 만들 콘텐츠 테마를 고르게 됩니다.
              </p>
            </div>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}
