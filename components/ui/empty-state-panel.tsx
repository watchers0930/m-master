type EmptyStatePanelProps = {
  title: string;
  description: string;
};

export function EmptyStatePanel({ title, description }: EmptyStatePanelProps) {
  return (
    <div className="empty-state">
      <strong className="empty-state-title">{title}</strong>
      <p className="fine-print empty-state-copy">{description}</p>
    </div>
  );
}
