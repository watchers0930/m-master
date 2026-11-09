// 채널 연동 — 서버 컴포넌트 (세션 소유자 범위로 초기 데이터 조회 후 ChannelForm에 전달)
// DB 자격증명·카페 타겟은 본인 것만, env 기반 연결 표시는 플랫폼 오너에게만(lib/credentials/channels-view.ts).
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { channelsInitialState } from '@/lib/credentials/channels-view';
import ChannelForm from './ChannelForm';

export default async function ChannelsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const { initial, cafeTargets } = await channelsInitialState(session.user.id);
  return <ChannelForm initial={initial} cafeTargets={cafeTargets} />;
}
