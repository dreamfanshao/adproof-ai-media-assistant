import { model } from "./llm/model.js";
import type { CreatorCandidate } from "./skills/types.js";
export async function matchCreatorWithLlm(query: string, candidate: CreatorCandidate) {
  const images = (candidate.imageUrls || []).slice(0, 8);
  const image = images.length ? await model({ system: "只描述图片中明确可见的达人内容证据，未知不要猜测。返回 JSON。", prompt: JSON.stringify({ query, candidate }), images }) : { status: "scored" as const, model: "none", data: { status: "no_images" } };
  const result = await model({ system: "逐项做达人语义匹配，返回 {matched,confidence,evidence,reasons}，不要输出最终总分。", prompt: JSON.stringify({ query, candidate, imageEvidence: image.data || image.note }) });
  return { id: candidate.id, matcher: result.status === "scored" && image.status === "scored" ? "llm" : "pending_llm", result: result.data || result.note, imageEvidence: image.data || image.note };
}
