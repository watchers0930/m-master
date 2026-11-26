/**
 * 외부 데이터 공급사(DataForSEO·SerpApi) 공통 오류.
 * reason은 공급사와 무관한 같은 어휘(vendor_payment_required·vendor_unavailable 등)를 쓴다 —
 * 수집 흐름(lib/visibility/track.ts)이 공급사를 몰라도 실패/재시도를 판정할 수 있게.
 */
export class VendorError extends Error {
  constructor(
    public reason: string,
    public costKrw = 0,
    public taskId?: string,
  ) {
    super(reason);
  }
}
