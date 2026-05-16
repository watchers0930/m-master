import { InputField } from "@/components/ui/input-field";
import { SectionCard } from "@/components/ui/section-card";
import { SourceAnalysisPanel } from "@/components/ui/source-analysis-panel";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  AutomationReadinessReport,
  CredentialHealthReport,
  EditableBrandProfileField,
  ProjectDetail,
  ProjectListItem,
  ProjectOperatorRole,
  ProjectOperatorSession,
  ProjectOperatorSummary,
} from "@/features/dashboard/types";

type ProjectOverviewProps = {
  projects: ProjectListItem[];
  activeProject?: ProjectDetail | null;
  loading?: boolean;
  onSelectProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onRegenerateContext: () => Promise<void>;
  onProjectIndustryChange: (value: string) => void;
  onProjectGa4PropertyIdChange: (value: string) => void;
  onProjectWordpressSiteUrlChange: (value: string) => void;
  onProjectWordpressUsernameChange: (value: string) => void;
  projectWordpressAppPassword: string;
  onProjectWordpressAppPasswordChange: (value: string) => void;
  onProjectWordpressStatusChange: (value: "draft" | "publish") => void;
  onProjectWordpressCategoryNamesChange: (value: string) => void;
  onProjectWordpressTagNamesChange: (value: string) => void;
  onProjectBloggerBlogIdChange: (value: string) => void;
  projectBloggerAccessToken: string;
  onProjectBloggerAccessTokenChange: (value: string) => void;
  onProjectBloggerStatusChange: (value: "draft" | "publish") => void;
  projectMetaAccessToken: string;
  onProjectMetaAccessTokenChange: (value: string) => void;
  onProjectMetaTokenExpiresAtChange: (value: string) => void;
  onProjectFacebookPageIdChange: (value: string) => void;
  onProjectInstagramBusinessAccountIdChange: (value: string) => void;
  projectOperationsAlertWebhook: string;
  onProjectOperationsAlertWebhookChange: (value: string) => void;
  onProjectAlertPolicyModeChange: (value: "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review") => void;
  onProjectAlertQuietHoursStartChange: (value: string) => void;
  onProjectAlertQuietHoursEndChange: (value: string) => void;
  onProjectAlertTimezoneChange: (value: string) => void;
  onProjectAlertOnBlockedReadinessChange: (value: boolean) => void;
  onProjectAutomationModeChange: (value: "draft-only" | "approved-auto-publish" | "full-auto") => void;
  onProjectAutomationRequireReviewChange: (value: boolean) => void;
  onProjectAutomationMinOverallScoreChange: (value: string) => void;
  onProjectAutomationMinRiskScoreChange: (value: string) => void;
  automationReadiness: AutomationReadinessReport | null;
  operatorSession: ProjectOperatorSession | null;
  operators: ProjectOperatorSummary[];
  credentialHealth: CredentialHealthReport | null;
  newOperatorName: string;
  onNewOperatorNameChange: (value: string) => void;
  newOperatorKey: string;
  onNewOperatorKeyChange: (value: string) => void;
  newOperatorRole: ProjectOperatorRole;
  onNewOperatorRoleChange: (value: ProjectOperatorRole) => void;
  onCreateOperator: () => Promise<void>;
  onUpdateOperator: (operatorId: string, patch: { role?: ProjectOperatorRole; active?: boolean }) => Promise<void>;
  onRunCredentialCheck: (service: "blogger" | "meta" | "ga4" | "alerts") => Promise<void>;
  onSaveProjectSettings: () => Promise<void>;
  onBrandProfileChange: (field: EditableBrandProfileField, value: string) => void;
  onSaveContext: () => Promise<void>;
  onApproveContext: () => Promise<void>;
};

function formatProjectTimestamp(value?: string | null) {
  if (!value) {
    return "시각 없음";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getProjectShortId(projectId: string) {
  return projectId.slice(-6);
}

export function ProjectOverview({
  projects,
  activeProject,
  loading = false,
  onSelectProject,
  onDeleteProject,
  onRegenerateContext,
  onProjectIndustryChange,
  onProjectGa4PropertyIdChange,
  onProjectWordpressSiteUrlChange,
  onProjectWordpressUsernameChange,
  projectWordpressAppPassword,
  onProjectWordpressAppPasswordChange,
  onProjectWordpressStatusChange,
  onProjectWordpressCategoryNamesChange,
  onProjectWordpressTagNamesChange,
  onProjectBloggerBlogIdChange,
  projectBloggerAccessToken,
  onProjectBloggerAccessTokenChange,
  onProjectBloggerStatusChange,
  projectMetaAccessToken,
  onProjectMetaAccessTokenChange,
  onProjectMetaTokenExpiresAtChange,
  onProjectFacebookPageIdChange,
  onProjectInstagramBusinessAccountIdChange,
  projectOperationsAlertWebhook,
  onProjectOperationsAlertWebhookChange,
  onProjectAlertPolicyModeChange,
  onProjectAlertQuietHoursStartChange,
  onProjectAlertQuietHoursEndChange,
  onProjectAlertTimezoneChange,
  onProjectAlertOnBlockedReadinessChange,
  onProjectAutomationModeChange,
  onProjectAutomationRequireReviewChange,
  onProjectAutomationMinOverallScoreChange,
  onProjectAutomationMinRiskScoreChange,
  automationReadiness,
  operatorSession,
  operators,
  credentialHealth,
  newOperatorName,
  onNewOperatorNameChange,
  newOperatorKey,
  onNewOperatorKeyChange,
  newOperatorRole,
  onNewOperatorRoleChange,
  onCreateOperator,
  onUpdateOperator,
  onRunCredentialCheck,
  onSaveProjectSettings,
  onBrandProfileChange,
  onSaveContext,
  onApproveContext,
}: ProjectOverviewProps) {
  const readinessStatusLabel =
    automationReadiness?.status === "blocked"
      ? "즉시 보완 필요"
      : automationReadiness?.status === "warning"
        ? "설정 점검 필요"
        : "자동화 준비 완료";

  const getReadinessSeverityLabel = (severity: "blocking" | "warning" | "info") => {
    if (severity === "blocking") return "차단";
    if (severity === "warning") return "경고";
    return "정보";
  };

  const getReadinessSeverityClassName = (severity: "blocking" | "warning" | "info") => {
    if (severity === "blocking") return "readiness-severity blocking";
    if (severity === "warning") return "readiness-severity warning";
    return "readiness-severity info";
  };

  const getReadinessAreaLabel = (
    area: "context" | "analytics" | "meta" | "images" | "automation" | "operations",
  ) => {
    switch (area) {
      case "context":
        return "콘텍스트";
      case "analytics":
        return "분석";
      case "meta":
        return "Meta";
      case "images":
        return "이미지";
      case "automation":
        return "자동화";
      case "operations":
        return "운영";
      default:
        return area;
    }
  };

  return (
    <SectionCard
      title="브랜드 콘텍스트 정리"
      description="사이트에서 읽은 브랜드 요약, 타겟, 톤을 확인합니다. 여기서 정리한 내용이 이후 블로그, 인스타그램, 페이스북 초안의 기준이 됩니다."
      badge="Step 2"
    >
      {activeProject?.brandProfile ? (
        <div className="insight-list">
          <div className="step-focus-card">
            <strong>지금 할 일</strong>
            <p className="fine-print">
              아래 브랜드 요약만 먼저 읽고 필요한 부분만 고친 뒤 승인하세요. 타겟, 톤, CTA, 금지 표현은 필요할 때만 펼쳐 수정하면 됩니다.
            </p>
            <div className="button-row" style={{ marginTop: 12 }}>
              <button className="button ghost" disabled={loading} type="button" onClick={() => void onRegenerateContext()}>
                {loading ? "재생성 중" : "사이트 다시 읽기"}
              </button>
            </div>
          </div>

          <div className="insight-item">
            <strong>{activeProject.project.name}</strong>
            <div className="project-meta">
              <StatusPill active>{activeProject.project.status}</StatusPill>
              <span className="fine-print">{activeProject.project.domain || "사이트 주소 미입력"}</span>
              <span className="fine-print">{activeProject.project.industry || "업종 미지정"}</span>
              <span className="fine-print">{activeProject.project.workingPath || "폴더 미지정"}</span>
              <span className="fine-print">테마 {activeProject.topics.length}개</span>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="project-industry-setting">
              프로젝트 설정
            </label>
            <div className="field-grid-2">
              <div>
                <label className="field-label" htmlFor="project-industry-setting">
                  업종 분류
                </label>
                <select
                  id="project-industry-setting"
                  className="text-input"
                  value={activeProject.project.industry || "general"}
                  onChange={(event) => onProjectIndustryChange(event.target.value)}
                >
                  <option value="general">일반</option>
                  <option value="real-estate">부동산</option>
                  <option value="marketing">마케팅</option>
                  <option value="saas">SaaS</option>
                  <option value="finance">금융</option>
                </select>
              </div>
              <InputField
                id="project-ga4-property-id"
                label="GA4 속성 ID"
                value={activeProject.project.ga4PropertyId || ""}
                onChange={onProjectGa4PropertyIdChange}
                placeholder="예: 123456789"
                hint="프로젝트별 GA4 속성이 있으면 분석 화면에서 전역 GA4_PROPERTY_ID보다 우선 적용됩니다."
              />
            </div>
            <div className="field-grid-2">
              <div>
                <label className="field-label" htmlFor="project-automation-mode">
                  자동화 모드
                </label>
                <select
                  id="project-automation-mode"
                  className="text-input"
                  value={activeProject.project.automationMode || "draft-only"}
                  onChange={(event) =>
                    onProjectAutomationModeChange(
                      event.target.value as "draft-only" | "approved-auto-publish" | "full-auto",
                    )
                  }
                >
                  <option value="draft-only">draft-only</option>
                  <option value="approved-auto-publish">approved-auto-publish</option>
                  <option value="full-auto">full-auto</option>
                </select>
              </div>
              <div className="field-group" style={{ justifyContent: "flex-end" }}>
                <label className="field-label">&nbsp;</label>
                <label className="fine-print" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={activeProject.project.automationRequireReview ?? true}
                    onChange={(event) => onProjectAutomationRequireReviewChange(event.target.checked)}
                  />
                  리뷰 가드레일 강제
                </label>
              </div>
            </div>
            <div className="field-grid-2">
              <InputField
                id="project-automation-min-overall-score"
                label="최소 종합 점수"
                value={String(activeProject.project.automationMinOverallScore ?? 75)}
                onChange={onProjectAutomationMinOverallScoreChange}
                placeholder="75"
              />
              <InputField
                id="project-automation-min-risk-score"
                label="최소 리스크 점수"
                value={String(activeProject.project.automationMinRiskScore ?? 80)}
                onChange={onProjectAutomationMinRiskScoreChange}
                placeholder="80"
              />
            </div>
            <details className="inline-details">
              <summary>채널 자격증명 관리</summary>
              <div className="inline-details-body stack">
                <div className="field-grid-2">
                  <InputField
                    id="project-blogger-blog-id"
                    label="Blogger Blog ID"
                    value={activeProject.project.bloggerBlogId || ""}
                    onChange={onProjectBloggerBlogIdChange}
                    placeholder="1234567890123456789"
                  />
                  <InputField
                    id="project-blogger-access-token"
                    label="Blogger Access Token"
                    type="password"
                    value={projectBloggerAccessToken}
                    onChange={onProjectBloggerAccessTokenChange}
                    placeholder={
                      activeProject.project.hasBloggerAccessToken
                        ? "새 토큰을 입력하면 교체됩니다"
                        : "OAuth access token 입력"
                    }
                    hint={
                      activeProject.project.hasBloggerAccessToken
                        ? "현재 토큰은 저장되어 있습니다. 비워두면 유지됩니다."
                        : "저장 후 Blogger 게시와 연결 테스트에 사용됩니다."
                    }
                  />
                </div>
                <div className="field-grid-2">
                  <div className="field-group">
                    <label className="field-label" htmlFor="project-blogger-status">
                      Blogger 게시 상태
                    </label>
                    <select
                      id="project-blogger-status"
                      className="text-input"
                      value={activeProject.project.bloggerStatus || "draft"}
                      onChange={(event) => onProjectBloggerStatusChange(event.target.value as "draft" | "publish")}
                    >
                      <option value="draft">draft</option>
                      <option value="publish">publish</option>
                    </select>
                  </div>
                </div>
                <div className="field-grid-2">
                  <InputField
                    id="project-meta-access-token"
                    label="Meta Access Token"
                    type="password"
                    value={projectMetaAccessToken}
                    onChange={onProjectMetaAccessTokenChange}
                    placeholder={activeProject.project.hasMetaAccessToken ? "새 토큰을 입력하면 교체됩니다" : "Meta Access Token 입력"}
                    hint={activeProject.project.hasMetaAccessToken ? "현재 토큰은 저장되어 있습니다. 비워두면 유지됩니다." : "인스타그램/페이스북 자동 게시에 사용됩니다."}
                  />
                  <InputField
                    id="project-facebook-page-id"
                    label="Facebook Page ID"
                    value={activeProject.project.facebookPageId || ""}
                    onChange={onProjectFacebookPageIdChange}
                    placeholder="1234567890"
                  />
                </div>
                <InputField
                  id="project-instagram-business-id"
                  label="Instagram Business Account ID"
                  value={activeProject.project.instagramBusinessAccountId || ""}
                  onChange={onProjectInstagramBusinessAccountIdChange}
                  placeholder="1784..."
                />
                <InputField
                  id="project-meta-token-expires-at"
                  label="Meta 토큰 만료 예정 시각"
                  value={activeProject.project.metaTokenExpiresAt || ""}
                  onChange={onProjectMetaTokenExpiresAtChange}
                  placeholder="2026-05-31T15:00:00.000Z"
                  hint="자동 감지가 아닌 운영 메타데이터입니다. 7일 이내면 준비도 경고가 뜹니다."
                />
                <div className="row">
                  <StatusPill active={Boolean(activeProject.project.hasBloggerAccessToken)}>
                    {activeProject.project.hasBloggerAccessToken ? "Blogger 토큰 저장됨" : "Blogger 토큰 미등록"}
                  </StatusPill>
                  <StatusPill active={Boolean(activeProject.project.hasMetaAccessToken)}>
                    {activeProject.project.hasMetaAccessToken ? "Meta 토큰 저장됨" : "Meta 토큰 미등록"}
                  </StatusPill>
                </div>
              </div>
            </details>
            <details className="inline-details">
              <summary>운영자 세션과 권한</summary>
              <div className="inline-details-body stack">
                <div className="row">
                  <StatusPill active={Boolean(operatorSession)}>
                    {operatorSession ? `${operatorSession.name} · ${operatorSession.role}` : "운영자 로그아웃 상태"}
                  </StatusPill>
                </div>
                {!operatorSession ? <p className="fine-print">루트 로그인에서 이 프로젝트로 먼저 로그인한 세션이 있어야 설정 저장, 자동화, 발행 작업을 진행할 수 있습니다.</p> : null}
                {operatorSession?.role === "owner" ? (
                  <>
                    <div className="field-grid-2">
                      <InputField
                        id="new-operator-name"
                        label="새 운영자 이름"
                        value={newOperatorName}
                        onChange={onNewOperatorNameChange}
                        placeholder="reviewer-1"
                      />
                      <InputField
                        id="new-operator-key"
                        label="새 운영자 접근 키"
                        type="password"
                        value={newOperatorKey}
                        onChange={onNewOperatorKeyChange}
                        placeholder="새 접근 키"
                      />
                    </div>
                    <div className="field-grid-2">
                      <div className="field-group">
                        <label className="field-label" htmlFor="new-operator-role">
                          새 운영자 역할
                        </label>
                        <select id="new-operator-role" className="text-input" value={newOperatorRole} onChange={(event) => onNewOperatorRoleChange(event.target.value as ProjectOperatorRole)}>
                          <option value="viewer">viewer</option>
                          <option value="analyst">analyst</option>
                          <option value="reviewer">reviewer</option>
                          <option value="operator">operator</option>
                          <option value="owner">owner</option>
                        </select>
                      </div>
                      <div className="field-group" style={{ justifyContent: "flex-end" }}>
                        <label className="field-label">&nbsp;</label>
                        <button className="button" disabled={loading} type="button" onClick={() => void onCreateOperator()}>
                          운영자 추가
                        </button>
                      </div>
                    </div>
                    {operators.map((operator) => (
                      <div key={operator.id} className="review-item">
                        <strong>{operator.name}</strong>
                        <p className="fine-print">역할 {operator.role} · 상태 {operator.active ? "active" : "inactive"}</p>
                        <div className="button-row">
                          <button className="button ghost" type="button" disabled={loading || operator.role === "owner"} onClick={() => void onUpdateOperator(operator.id, { active: !operator.active })}>
                            {operator.active ? "비활성화" : "재활성화"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </details>
            <details className="inline-details">
              <summary>운영 알림 정책</summary>
              <div className="inline-details-body stack">
                <div className="field-grid-2">
                  <InputField
                    id="project-operations-alert-webhook"
                    label="운영 알림 웹훅"
                    type="password"
                    value={projectOperationsAlertWebhook}
                    onChange={onProjectOperationsAlertWebhookChange}
                    placeholder={activeProject.project.hasOperationsAlertWebhook ? "새 웹훅을 입력하면 교체됩니다" : "Slack/Discord Webhook URL"}
                    hint={activeProject.project.hasOperationsAlertWebhook ? "현재 웹훅은 저장되어 있습니다. 비워두면 유지됩니다." : "프로젝트 단위 웹훅으로 전역 OPERATIONS_ALERT_WEBHOOK_URL보다 우선합니다."}
                  />
                  <div className="field-group">
                    <label className="field-label" htmlFor="project-alert-policy-mode">
                      알림 정책
                    </label>
                    <select
                      id="project-alert-policy-mode"
                      className="text-input"
                      value={activeProject.project.alertPolicyMode || "failures-and-review"}
                      onChange={(event) =>
                        onProjectAlertPolicyModeChange(
                          event.target.value as "disabled" | "all" | "critical-only" | "failures-only" | "failures-and-review",
                        )
                      }
                    >
                      <option value="failures-and-review">failures-and-review</option>
                      <option value="failures-only">failures-only</option>
                      <option value="critical-only">critical-only</option>
                      <option value="all">all</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </div>
                </div>
                <div className="field-grid-2">
                  <InputField
                    id="project-alert-quiet-start"
                    label="조용한 시간 시작"
                    value={activeProject.project.alertQuietHoursStart || ""}
                    onChange={onProjectAlertQuietHoursStartChange}
                    placeholder="23:00"
                  />
                  <InputField
                    id="project-alert-quiet-end"
                    label="조용한 시간 종료"
                    value={activeProject.project.alertQuietHoursEnd || ""}
                    onChange={onProjectAlertQuietHoursEndChange}
                    placeholder="07:00"
                  />
                </div>
                <div className="field-grid-2">
                  <InputField
                    id="project-alert-timezone"
                    label="알림 시간대"
                    value={activeProject.project.alertTimezone || "Asia/Seoul"}
                    onChange={onProjectAlertTimezoneChange}
                    placeholder="Asia/Seoul"
                  />
                  <div className="field-group" style={{ justifyContent: "flex-end" }}>
                    <label className="field-label">&nbsp;</label>
                    <label className="fine-print" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={activeProject.project.alertOnBlockedReadiness ?? true}
                        onChange={(event) => onProjectAlertOnBlockedReadinessChange(event.target.checked)}
                      />
                      readiness 차단도 알림
                    </label>
                  </div>
                </div>
              </div>
            </details>
            <details className="inline-details">
              <summary>연결 테스트와 갱신 이력</summary>
              <div className="inline-details-body stack">
                <div className="button-row">
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onRunCredentialCheck("blogger")}>
                    Blogger 테스트
                  </button>
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onRunCredentialCheck("meta")}>
                    Meta 테스트
                  </button>
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onRunCredentialCheck("ga4")}>
                    GA4 테스트
                  </button>
                  <button className="button ghost" disabled={loading} type="button" onClick={() => void onRunCredentialCheck("alerts")}>
                    알림 테스트
                  </button>
                </div>
                <p className="fine-print">비어 있는 채널은 실패가 아니라 미설정 상태로 기록됩니다. 값이 있는 서비스만 실제 외부 연결을 점검합니다.</p>
                {credentialHealth?.services.map((service) => (
                  <div key={service.service} className="review-item">
                    <strong>{service.service}</strong>
                    <p className="fine-print">
                      {service.latest ? `${service.latest.status} · ${service.latest.summary}` : "아직 점검 이력이 없습니다."}
                    </p>
                    {service.latest?.detail ? <p className="fine-print">{service.latest.detail}</p> : null}
                    {service.latest?.expiresAt ? <p className="fine-print">만료 예정: {service.latest.expiresAt}</p> : null}
                  </div>
                ))}
                {credentialHealth?.history.slice(0, 8).map((item) => (
                  <div key={item.id} className="review-item">
                    <strong>
                      [{item.service}] {item.summary}
                    </strong>
                    <p className="fine-print">
                      {item.kind} · {item.status} · {item.checkedAt}
                    </p>
                    {item.detail ? <p className="fine-print">{item.detail}</p> : null}
                  </div>
                ))}
              </div>
            </details>
            {automationReadiness ? (
              <details className="inline-details">
                <summary>자동화 준비도 경고</summary>
                <div className="inline-details-body stack">
                  <div className={`readiness-summary ${automationReadiness.status}`}>
                    <div>
                      <strong>{readinessStatusLabel}</strong>
                      <p className="fine-print">
                        마지막 점검 {automationReadiness.generatedAt} 기준으로 현재 자동화 운영 상태를 정리했습니다.
                      </p>
                    </div>
                    <div className="readiness-summary-metrics">
                      <div className="readiness-metric">
                        <span>차단</span>
                        <strong>{automationReadiness.blockingCount}건</strong>
                      </div>
                      <div className="readiness-metric">
                        <span>경고</span>
                        <strong>{automationReadiness.warningCount}건</strong>
                      </div>
                      <div className="readiness-metric">
                        <span>정보</span>
                        <strong>{automationReadiness.infoCount}건</strong>
                      </div>
                    </div>
                  </div>
                  {automationReadiness.issues.length === 0 ? (
                    <p className="fine-print">현재 등록된 운영 경고가 없습니다.</p>
                  ) : (
                    <div className="readiness-issue-list">
                      {automationReadiness.issues.map((issue) => (
                        <div key={issue.id} className="readiness-issue-card">
                          <div className="readiness-issue-header">
                            <span className={getReadinessSeverityClassName(issue.severity)}>
                              {getReadinessSeverityLabel(issue.severity)}
                            </span>
                            <span className="readiness-area-chip">{getReadinessAreaLabel(issue.area)}</span>
                          </div>
                          <strong className={issue.severity === "blocking" ? "error-text" : ""}>{issue.title}</strong>
                          <p className="fine-print">{issue.detail}</p>
                          {issue.recommendation ? (
                            <div className="readiness-recommendation">
                              <span>권장 조치</span>
                              <p className="fine-print">{issue.recommendation}</p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ) : null}
            <div className="row">
              <button className="button" disabled={loading} type="button" onClick={() => void onSaveProjectSettings()}>
                {loading ? "저장 중" : "프로젝트 설정 저장"}
              </button>
            </div>
            <p className="fine-print">업종 분류는 해시태그 추천과 채널 초안 우선 태그에 반영되고, GA4 속성 ID는 `/studio/analytics` 조회 대상에 반영됩니다. 자동화 모드는 `draft-only`, `approved-auto-publish`, `full-auto` 순으로 자동 게시 범위를 넓힙니다.</p>
          </div>

          <InputField
            id="brand-summary"
            label="브랜드 요약"
            value={activeProject.brandProfile.summary}
            onChange={(value) => onBrandProfileChange("summary", value)}
            placeholder="브랜드와 서비스 핵심을 요약하세요."
            multiline
            rows={6}
          />

          <details className="inline-details">
            <summary>고급 편집 열기</summary>
            <div className="inline-details-body editor-grid">
              <div className="field-grid-2">
                <InputField
                  id="brand-audience"
                  label="핵심 타겟"
                  value={activeProject.brandProfile.audience || ""}
                  onChange={(value) => onBrandProfileChange("audience", value)}
                  placeholder="예: 운영 자동화가 필요한 중소 SaaS 팀"
                  multiline
                  rows={4}
                />
                <InputField
                  id="brand-tone"
                  label="톤"
                  value={activeProject.brandProfile.tone || ""}
                  onChange={(value) => onBrandProfileChange("tone", value)}
                  placeholder="예: 명료하고 신뢰감 있게"
                  multiline
                  rows={4}
                />
              </div>
              <div className="field-grid-2">
                <InputField
                  id="brand-cta"
                  label="CTA"
                  value={activeProject.brandProfile.cta || ""}
                  onChange={(value) => onBrandProfileChange("cta", value)}
                  placeholder="예: 데모 신청, 문의 유도"
                  multiline
                  rows={4}
                />
                <InputField
                  id="brand-banned-terms"
                  label="금지 표현"
                  value={activeProject.brandProfile.bannedTerms || ""}
                  onChange={(value) => onBrandProfileChange("bannedTerms", value)}
                  placeholder="예: 업계 1위, 무조건, 100% 보장"
                  multiline
                  rows={4}
                />
              </div>
            </div>
          </details>

          <details className="inline-details">
            <summary>수집 근거와 다른 프로젝트 보기</summary>
            <div className="inline-details-body stack">
              <p className="fine-print">
                재생성은 현재 저장된 프로젝트명과 사이트 주소, 그리고 연결된 자료를 기준으로 새 콘텍스트 초안을 만듭니다.
              </p>
              {activeProject.sourceAnalysis ? (
                <SourceAnalysisPanel
                  analysis={activeProject.sourceAnalysis}
                  title="참조 문서 요약"
                  description="콘텍스트 초안이 어떤 사이트/파일 내용을 근거로 만들어졌는지 확인한 뒤 승인합니다."
                />
              ) : null}

              <div className="project-list">
                {projects.length === 0 ? (
                  <div className="empty-state">저장된 프로젝트가 아직 없습니다.</div>
                ) : (
                  projects.map((project) => (
                    <div
                      key={project.id}
                      className={`project-item-shell ${activeProject.project.id === project.id ? "active" : ""}`}
                    >
                      <button
                        className="project-item"
                        style={{ textAlign: "left" }}
                        type="button"
                        onClick={() => void onSelectProject(project.id)}
                      >
                        <strong>{project.name}</strong>
                        <div className="project-meta">
                          <StatusPill active={activeProject.project.id === project.id}>{project.status}</StatusPill>
                          <span className="fine-print">{project.domain || "사이트 주소 미입력"}</span>
                          <span className="fine-print">{project.workingPath || "폴더 미지정"}</span>
                          <span className="fine-print">테마 {project.topicCount}개</span>
                          <span className="fine-print">{`최근 수정 ${formatProjectTimestamp(project.updatedAt)}`}</span>
                          <span className="fine-print">{`ID ${getProjectShortId(project.id)}`}</span>
                        </div>
                      </button>
                      <div className="project-item-actions">
                        <button className="button ghost danger" type="button" onClick={() => onDeleteProject(project.id)}>
                          삭제
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </details>
          <div className="row">
            <StatusPill active={activeProject.brandProfile.approved}>
              {activeProject.brandProfile.approved ? "승인됨" : "검토 필요"}
            </StatusPill>
            <StatusPill>{`Version ${activeProject.brandProfile.version}`}</StatusPill>
            <button className="button" disabled={loading} type="button" onClick={() => void onSaveContext()}>
              {loading ? "저장 중" : "콘텍스트 저장"}
            </button>
            <button className="button primary" disabled={loading} type="button" onClick={() => void onApproveContext()}>
              {loading ? "저장 중" : "이 콘텍스트로 진행"}
            </button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
