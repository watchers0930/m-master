import type { ConsultingSnapshot } from "@/types/consulting";
import { consultingSnapshotV2Schema } from "@/schemas/consulting";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { fitSnapshot } from "./prompt";
import { buildSections } from "./sections";
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** Full chart evidence and fitted LLM projection are frozen separately before hashing. */
export function freezeSnapshot(input: ConsultingSnapshot): ConsultingSnapshot {
  const {structuredMetrics,sections:_sections,llmInput:_llm,schemaVersion:_version,...legacy} = structuredClone(input);
  const base = {...legacy,structuredMetrics:structuredMetrics ?? {keywords:[],demand:[],location:MARKET_LOCATIONS[input.market].location_code,period:null}};
  const built=buildSections(base);
  const llmInput=fitSnapshot({...legacy, evidence:legacy.evidence.slice(0,700),
    limitations:legacy.evidence.length>700 ? [...legacy.limitations.slice(0,19), "LLM 입력은 근거 700개까지 선택했으며 전체 차트 근거는 별도 보존합니다."] : legacy.limitations});
  const snapshot={...base,...built,llmInput,schemaVersion:"v2" as const};
  if (Buffer.byteLength(JSON.stringify(snapshot))>MAX_SNAPSHOT_BYTES) throw new Error("snapshot_size_limit");
  return consultingSnapshotV2Schema.parse(snapshot) as ConsultingSnapshot;
}
