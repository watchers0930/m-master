import { APIError, APIConnectionError } from "openai";

/** Only an actual SDK HTTP rejection proves non-execution; never infer from error text. */
export function isDefinitiveRejection(error: unknown) {
    return error instanceof APIError && error.status !== undefined &&
        [400, 401, 403, 404, 413, 422, 429].includes(error.status);
}

/**
 * Failures with no provider response at all (connection refused/reset, client timeout) or a definitive
 * HTTP rejection. Callers whose retry is cheap and bounded (weekly topics) treat these as re-claimable
 * `failed`; a timed-out request might still have been processed upstream, so consulting stays stricter.
 */
export function isUnbilledFailure(error: unknown) {
    return error instanceof APIConnectionError || isDefinitiveRejection(error);
}
