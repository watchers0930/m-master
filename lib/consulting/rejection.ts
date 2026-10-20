import { APIError } from "openai";

/** Only an actual SDK HTTP rejection proves non-execution; never infer from error text. */
export function isDefinitiveRejection(error: unknown) {
    return error instanceof APIError && error.status !== undefined &&
        [400, 401, 403, 404, 413, 422, 429].includes(error.status);
}
