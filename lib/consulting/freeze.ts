import type { ConsultingSnapshot } from "@/types/consulting";
import { consultingSnapshotV2Schema, consultingSnapshotV3Schema } from "@/schemas/consulting";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { fitSnapshot } from "./prompt";
import { buildSections } from "./sections";
import type { ConsultingGa4, ConsultingLlmGa4 } from "@/schemas/ga4-consulting";
/** Allowlist: only non-identifying provenance reaches the external LLM (never owner/domain/binding/property/credential). */
const LLM_PROVENANCE_KEYS: readonly string[] = ['host','collectedAt','range','timeZone','queryVersion','completeness','quality','scopeLevel'];
export function toLlmGa4(ga4: ConsultingGa4): ConsultingLlmGa4 {
  const provenance = Object.fromEntries(Object.entries(ga4.provenance).filter(([key]) => LLM_PROVENANCE_KEYS.includes(key)));
  return { ...ga4, provenance: provenance as ConsultingLlmGa4['provenance'] };
}
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** Full chart evidence and fitted LLM projection are frozen separately before hashing. */
export function freezeSnapshot(input: ConsultingSnapshot, version: 'v2' | 'v3' = input.schemaVersion ?? 'v2'): ConsultingSnapshot {
  const {structuredMetrics,sections:_sections,llmInput:_llm,schemaVersion:_version,...legacy} = structuredClone(input);
  const base = {...legacy,structuredMetrics:structuredMetrics ?? {keywords:[],demand:[],location:MARKET_LOCATIONS[input.market].location_code,period:null}};
  const built=buildSections(base);
  const llmInput=fitSnapshot({...legacy, ...(legacy.ga4 ? { ga4:toLlmGa4(legacy.ga4) } : {}), evidence:[...legacy.evidence.filter(e=>e.source==='ga4'),...legacy.evidence.filter(e=>e.source!=='ga4')].slice(0,700),
    limitations:legacy.evidence.length>700 ? [...legacy.limitations.slice(0,19), "LLM 입력은 근거 700개까지 선택했으며 전체 차트 근거는 별도 보존합니다."] : legacy.limitations});
  const snapshot={...base,...built,llmInput,schemaVersion:version};
  if (Buffer.byteLength(JSON.stringify(snapshot))>MAX_SNAPSHOT_BYTES) throw new Error("snapshot_size_limit");
  return (version === 'v3' ? consultingSnapshotV3Schema : consultingSnapshotV2Schema).parse(snapshot) as ConsultingSnapshot;
}
