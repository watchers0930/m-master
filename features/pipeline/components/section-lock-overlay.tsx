"use client";

export function SectionLockOverlay({ message }: { message?: string }) {
  return (
    <div className="section-lock-overlay">
      <p className="fine-print">{message || "이전 단계를 먼저 완료해 주세요."}</p>
    </div>
  );
}
