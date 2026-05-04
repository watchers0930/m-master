import type { SourceAnalysisSummary } from "@/features/dashboard/types";

type SourceAnalysisPanelProps = {
  analysis: SourceAnalysisSummary;
  title?: string;
  description?: string;
};

export function SourceAnalysisPanel({
  analysis,
  title = "참조 소스 근거",
  description = "실제로 반영된 파일과 excerpt 기반 힌트를 함께 보여줍니다.",
}: SourceAnalysisPanelProps) {
  return (
    <div className="source-analysis-panel">
      <div className="source-analysis-header">
        <strong>{title}</strong>
        <p className="fine-print">{description}</p>
      </div>

      <div className="source-analysis-stats">
        <div className="insight-item">
          <strong>{analysis.totalFiles}</strong>
          <p className="fine-print">총 반영 파일 수</p>
        </div>
        <div className="insight-item">
          <strong>{analysis.filesWithExcerpt}</strong>
          <p className="fine-print">excerpt 확보 파일</p>
        </div>
        <div className="insight-item">
          <strong>{analysis.fileTypeBreakdown.map((item) => `${item.key} ${item.count}`).join(", ") || "없음"}</strong>
          <p className="fine-print">형식 분포</p>
        </div>
      </div>

      <div className="source-analysis-grid">
        <div className="insight-item">
          <strong>상위 참조 파일</strong>
          {analysis.topSourceFiles.length > 0 ? (
            <div className="file-chip-wrap" style={{ marginTop: 12 }}>
              {analysis.topSourceFiles.map((file) => (
                <div className="file-chip" key={`${file.relativePath || file.name}-${file.excerptLength}`}>
                  <strong>{file.name}</strong>
                  <span className="fine-print">
                    {file.relativePath || "root"} · excerpt {file.excerptLength} chars
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="fine-print">표시할 참조 파일이 없습니다.</p>
          )}
        </div>

        <div className="insight-item">
          <strong>키워드 힌트</strong>
          <p className="fine-print">{analysis.keywordHints.join(", ") || "키워드 없음"}</p>
        </div>
      </div>

      <div className="insight-item">
        <strong>excerpt digest</strong>
        <div className="source-digest">{analysis.excerptDigest || "표시할 excerpt digest가 없습니다."}</div>
      </div>
    </div>
  );
}
