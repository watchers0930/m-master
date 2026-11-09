// components/channels/Badge.tsx
// 채널 연결 상태 뱃지(연결됨/미연결).

export default function Badge({ connected }: { connected: boolean }) {
  if (connected) return <span style={{ background: '#E8F5E9', border: '1px solid #A5D6A7', color: '#2E7D32', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>연결됨</span>;
  return <span style={{ background: 'var(--n100)', color: 'var(--sub)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>미연결</span>;
}
