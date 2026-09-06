import type { Creator, KnowledgeBase } from "./types";

/**
 * Fallback state for the demo provider.
 *
 * Production pages load creators and knowledge bases from the API. Keeping
 * these arrays typed and empty lets the demo shell compile without bundling
 * local runtime data or presenting fake search results.
 */
export const initialCreators: Creator[] = [];
export const initialKnowledgeBases: KnowledgeBase[] = [];
