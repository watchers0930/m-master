import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

const CH_LABEL: Record<string, string> = {
  blog: '블로그', instagram: '인스타', facebook: '페이스북', naver_cafe: '네이버카페',
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  draft:     { bg: '#f1f5f9', color: '#475569' },
  completed: { bg: '#dcfce7', color: '#15803d' },
};

const JOB_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:    { bg: '#eff6ff', color: '#1d4ed8', label: '예약 대기' },
  processing: { bg: '#fff7ed', color: '#c2410c', label: '발행 중' },
  done:       { bg: '#f0fdf4', color: '#15803d', label: '발행 완료' },
  failed:     { bg: '#fef2f2', color: '#b91c1c', label: '발행 실패' },
};

export default async function EditorListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const docs = await prisma.ideaDocument.findMany({
    where: { ownerId: session.user.id },
    include: { publishJob: { select: { id: true, status: true, scheduledAt: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>문서 편집기</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>총 {docs.length}개</p>
        </div>
        <Link href="/editor/new"
          style={{ padding: '9px 18px', background: '#2563eb', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          + 새 문서
        </Link>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e4ebf5', borderRadius: 14, overflow: 'hidden' }}>
        {docs.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            아직 문서가 없습니다. 새 문서를 작성해보세요.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['작성일', '제목', '채널', '상태', '발행 예약'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e4ebf5', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => {
                const job = doc.publishJob;
                const js = job ? JOB_STYLE[job.status] : null;
                const ss = STATUS_STYLE[doc.status] ?? STATUS_STYLE.draft;
                return (
                  <tr key={doc.id} style={{ cursor: 'pointer' }}
                    onClick={() => { /* client navigation handled by Link wrapper */ }}>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {fmtDate(doc.createdAt)}
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                      <Link href={`/editor/${doc.id}`} style={{ color: '#0f172a', fontWeight: 600, textDecoration: 'none' }}
                        prefetch={false}>
                        {doc.title || '(제목 없음)'}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', color: '#475569' }}>
                      {CH_LABEL[doc.channel] ?? doc.channel}
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: ss.bg, color: ss.color }}>
                        {doc.status === 'completed' ? '완료' : '작성중'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                      {js ? (
                        <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: js.bg, color: js.color }}>
                          {js.label}{job?.scheduledAt ? ` · ${fmtDate(job.scheduledAt)}` : ''}
                        </span>
                      ) : <span style={{ color: '#94a3b8' }}>-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
