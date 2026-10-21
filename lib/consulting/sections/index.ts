import type { ConsultingSnapshot, ConsultingStrategy, ConsultingSectionsDTO } from "@/types/consulting";
import { summarySection } from "./summary";
import { focusSection } from "./focus";
import { competitorsSection } from "./competitors";
import { gtmSection } from "./gtm";
import { keywordsSection } from "./keywords";
import { methodologySection } from "./methodology";
/** Pure deterministic aggregation: no DB, vendor or LLM imports. Does not mutate caller input. */
export function buildSections(input: ConsultingSnapshot, strategy: ConsultingStrategy|null = null): {sections: ConsultingSectionsDTO; evidence: ConsultingSnapshot["evidence"]} {
  const snapshot = structuredClone(input);
  const {section:summary,additionalEvidence} = summarySection(snapshot);
  snapshot.evidence = [...snapshot.evidence,...additionalEvidence];
  return {evidence:snapshot.evidence, sections:{summary,focus:focusSection(snapshot),competitors:competitorsSection(snapshot),
    gtm:gtmSection(snapshot,strategy),keywords:keywordsSection(snapshot),methodology:methodologySection(snapshot)}};
}
