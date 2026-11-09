import { CredentialCryptoError } from '@/lib/crypto/credentials';
/** An explicit upstream refusal is safe to retry; transport/response uncertainty is not. */
export class ChannelRejection extends Error {
  constructor() { super('channel_rejected'); }
}

/**
 * 발행 자격증명 로드 경계. 저장 자격증명 복호화 실패(CredentialCryptoError: 키 불일치·env 누락·변조)는
 * 아무것도 전송하지 않은 확정 실패이므로 자격증명 없음과 같은 ChannelRejection으로 번역한다
 * (executeClaim이 claim을 'unknown'이 아닌 'failed'로 기록). 사유 코드만 로그에 남긴다.
 */
export async function loadCredentials<T>(load: () => Promise<T>, channel: string): Promise<T> {
  try { return await load(); }
  catch (error) {
    if (!(error instanceof CredentialCryptoError)) throw error;
    console.error('[credentials] decrypt failed', { channel, reason: error.reason });
    throw new ChannelRejection();
  }
}
