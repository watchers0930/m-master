"use client";

import type { SeoComplianceResult } from "../types";

function statusIcon(status: "pass" | "warn" | "fail") {
  if (status === "pass") return "✓";
  if (status === "warn") return "△";
  return "✕";
}

function statusClass(status: "pass" | "warn" | "fail") {
  if (status === "pass") return "seo-item-pass";
  if (status === "warn") return "seo-item-warn";
  return "seo-item-fail";
}

export function SeoComplianceIndicator({
  result,
}: {
  result: SeoComplianceResult;
}) {
  return (
    <div className="seo-compliance">
      <div className="seo-score-bar">
        <div className="seo-score-fill" style={{ width: `${result.score}%` }} />
        <span className="seo-score-label">SEO {result.score}점</span>
      </div>
      <ul className="seo-checklist">
        {result.items.map((item) => (
          <li key={item.key} className={`seo-checklist-item ${statusClass(item.status)}`}>
            <span className="seo-checklist-icon">{statusIcon(item.status)}</span>
            <span className="seo-checklist-label">{item.label}</span>
            {item.detail && <span className="seo-checklist-detail">{item.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
