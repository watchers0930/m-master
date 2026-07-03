import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import Link from 'next/link';
import { EditorWorkspace } from '../components/EditorWorkspace';

export default async function EditDocPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const doc = await prisma.ideaDocument.findUnique({
    where: { id },
    include: { publishJob: true },
  });

  if (!doc || doc.ownerId !== session.user.id) notFound();

  const serialized = {
    ...doc,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    publishJob: doc.publishJob ? {
      ...doc.publishJob,
      scheduledAt: doc.publishJob.scheduledAt?.toISOString() ?? null,
      startedAt: doc.publishJob.startedAt?.toISOString() ?? null,
      finishedAt: doc.publishJob.finishedAt?.toISOString() ?? null,
      createdAt: doc.publishJob.createdAt.toISOString(),
      updatedAt: doc.publishJob.updatedAt.toISOString(),
    } : null,
  };

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Link href="/editor" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>← 목록</Link>
        <span style={{ color: '#cbd5e1' }}>/</span>
        <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>
          {doc.title || '(제목 없음)'}
        </span>
      </div>
      <EditorWorkspace doc={serialized as never} />
    </div>
  );
}
