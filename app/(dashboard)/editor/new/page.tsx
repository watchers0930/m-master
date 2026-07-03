import { EditorWorkspace } from '../components/EditorWorkspace';

export default function NewDocPage() {
  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>새 문서</h1>
      </div>
      <EditorWorkspace />
    </div>
  );
}
