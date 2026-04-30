import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import type { ProjectDetail, StudioDetail } from "@/features/dashboard/types";

type ContentStudioProps = {
  detail?: ProjectDetail | null;
  studio?: StudioDetail | null;
  activeChannel: "blog" | "instagram" | "facebook";
  onChannelChange: (channel: "blog" | "instagram" | "facebook") => void;
  onGenerateContent: () => Promise<void>;
};

const channelLabels = {
  blog: "블로그",
  instagram: "인스타그램",
  facebook: "페이스북",
} as const;

export function ContentStudio({
  detail,
  studio,
  activeChannel,
  onChannelChange,
  onGenerateContent,
}: ContentStudioProps) {
  const activeAsset = studio?.draft.assets.find((asset) => asset.channel === activeChannel);

  return (
    <div className="stack">
      <SectionCard
        title="추천 주제"
        description="검색형, 브랜딩형, 전환형 토픽을 우선순위로 제시하고 콘텐츠 스튜디오의 기준 주제를 고정합니다."
        badge="Step 3"
      >
        {detail?.topics.length ? (
          <div className="topic-chip-wrap">
            {detail.topics.map((topic) => (
              <div className="topic-chip" key={topic.id}>
                <strong>{topic.title}</strong>
                <span className="fine-print">
                  {topic.intentType || "general"} · {topic.score?.toFixed(1) ?? "-"}
                </span>
                <span className="fine-print">{topic.rationale || "추천 이유 없음"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">추천 주제가 아직 없습니다.</div>
        )}
      </SectionCard>

      <SectionCard
        title="콘텐츠 스튜디오"
        description="블로그 원문과 인스타그램·페이스북 파생 초안을 한 화면에서 비교하고 다듬는 공간입니다."
        badge="Step 4"
      >
        {studio ? (
          <>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <strong style={{ display: "block", fontSize: 18, marginBottom: 6 }}>{studio.draft.topic}</strong>
                <span className="fine-print">{studio.draft.objective}</span>
              </div>
              <div className="row">
                <StatusPill active>{studio.project.status}</StatusPill>
                <button className="button ghost" type="button" onClick={() => void onGenerateContent()}>
                  선택 주제로 초안 생성
                </button>
              </div>
            </div>
            <div className="content-tabs">
              {(Object.keys(channelLabels) as Array<keyof typeof channelLabels>).map((channel) => (
                <button
                  key={channel}
                  className={`content-tab ${activeChannel === channel ? "active" : ""}`}
                  type="button"
                  onClick={() => onChannelChange(channel)}
                >
                  {channelLabels[channel]}
                </button>
              ))}
            </div>
            <div className="content-editor">
              <strong style={{ display: "block", fontSize: 16, marginBottom: 10 }}>
                {activeAsset?.title || "채널 초안 없음"}
              </strong>
              {activeAsset?.body || "초안이 아직 준비되지 않았습니다."}
              {activeAsset?.cta ? `\n\nCTA\n${activeAsset.cta}` : ""}
            </div>
          </>
        ) : (
          <div className="empty-state">프로젝트를 선택하면 콘텐츠 스튜디오 초안이 표시됩니다.</div>
        )}
      </SectionCard>

      <SectionCard
        title="검수 패널"
        description="브랜드 일치도, 채널 적합도, 금지 표현 여부를 빠르게 확인하는 MVP 검수 영역입니다."
        badge="Step 5"
      >
        {studio?.brandProfile ? (
          <>
            <div className="kpi-grid">
              <div className="kpi-item">
                <strong>{studio.review.scores.brandAlignment}</strong>
                <span className="fine-print">브랜드 일치도</span>
              </div>
              <div className="kpi-item">
                <strong>{studio.review.scores.formatFit}</strong>
                <span className="fine-print">채널 적합도</span>
              </div>
              <div className="kpi-item">
                <strong>{studio.review.scores.ctaClarity}</strong>
                <span className="fine-print">CTA 명확성</span>
              </div>
            </div>
            <div className="review-list" style={{ marginTop: 16 }}>
              <div className="review-item">
                <strong>리스크 점수</strong>
                <p className="fine-print">{studio.review.scores.riskControl}</p>
              </div>
              {studio.review.findings.length > 0 ? (
                studio.review.findings.map((finding, index) => (
                  <div className="review-item" key={`${finding.channel}-${finding.type}-${index}`}>
                    <strong>{`${finding.channel} · ${finding.type}`}</strong>
                    <p className="fine-print">{finding.message}</p>
                  </div>
                ))
              ) : (
                <div className="review-item">
                  <strong>검수 결과</strong>
                  <p className="fine-print">현재 초안은 내보내기 전 기본 검수 기준을 통과했습니다.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">검수 패널은 프로젝트 생성 후 자동으로 채워집니다.</div>
        )}
      </SectionCard>
    </div>
  );
}
