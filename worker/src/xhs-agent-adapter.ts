import { matchCreatorWithLlm } from "../../agent/creator-matcher.js";
import type { CreatorCandidate } from "../../agent/skills/types.js";

/** The XHS collection workflow hands normalized profile/post/image fields to the creator Skill Agent. */
export async function evaluateCreatorByAgent(candidate: CreatorCandidate, query: string) {
  return matchCreatorWithLlm(query, candidate);
}
