import type { ConsultingSnapshot, ConsultingStrategy, ConsultingSectionsDTO } from "@/types/consulting";
import { sectionMeta } from "./meta";
export function gtmSection(snapshot: ConsultingSnapshot, strategy: ConsultingStrategy|null): ConsultingSectionsDTO["gtm"] {
  const ids = strategy ? [...strategy.diagnosis.strengths,...strategy.diagnosis.issues,...strategy.channelMix,...strategy.priorityActions].flatMap(i=>i.evidenceIds) : [];
  return {meta:sectionMeta(snapshot,ids,strategy!==null),strategy};
}
