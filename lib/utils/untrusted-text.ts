/**
 * Sanitizers for untrusted strings that end up inside LLM prompts.
 * Removes C0/DEL/C1 controls and Unicode bidi/invisible format controls (LRE..RLO, LRI..PDI,
 * LRM/RLM/ALM, zero-width chars, BOM, interlinear annotation) that can hide or reorder prompt text.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
export function stripUnsafeControls(value: string): string {
  return value.replace(CONTROL, '');
}
/** JSON for embedding between prompt delimiters: no raw `<`/`>`, so `</tag>` can never close the block. */
export function delimiterSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
