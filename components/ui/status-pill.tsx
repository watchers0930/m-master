type StatusPillProps = {
  children: string;
  active?: boolean;
};

export function StatusPill({ children, active = false }: StatusPillProps) {
  return <span className={`status-pill ${active ? "active" : ""}`}>{children}</span>;
}
