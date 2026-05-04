import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  description: string;
  badge?: string;
  tone?: "default" | "soft";
  children: ReactNode;
};

export function SectionCard({
  title,
  description,
  badge,
  tone = "default",
  children,
}: SectionCardProps) {
  return (
    <section className={`card ${tone === "soft" ? "soft" : ""}`}>
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-copy">{description}</p>
        </div>
        {badge ? <span className="status-pill active">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}
