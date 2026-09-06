import { createRedfoxXhsClient } from "../worker/src/redfox-xhs-client.js";

const keyword = process.argv.slice(2).find((value) => !value.startsWith("--"))?.trim()
  || "光子嫩肤 素人 分享";
const client = createRedfoxXhsClient(process.env);
const result = await client.searchNextNoteBatch([keyword], {
  desiredCreators: 20,
  pageBudget: 1,
});
const hydrate = process.argv.includes("--hydrate");
const hydrationTarget = result.notes.find((note) => note.likes >= 10) ?? result.notes[0];
const hydration = hydrate && hydrationTarget
  ? await client.hydrateCreatorProfile(hydrationTarget, { includePostedNotes: false })
  : null;

console.log(JSON.stringify({
  keyword,
  notes: result.notes.map((note) => ({
    noteId: note.noteId,
    userId: note.userId,
    nickname: note.nickname,
    likes: note.likes,
    publishedAt: note.publishedAt,
    noteType: note.noteType,
  })),
  pages: result.pages,
  sourceExhausted: result.sourceExhausted,
  keywordFailures: result.keywordFailures,
  requestCount: result.requestCount,
  requestCountByEndpoint: result.requestCountByEndpoint,
  hydration: hydration ? {
    creatorId: hydrationTarget?.userId,
    followers: hydration.profile?.fields.followers ?? null,
    postCount: hydration.profile?.fields.posts.length ?? 0,
    noteDetailError: hydration.noteDetailError,
    accountDetailError: hydration.accountDetailError,
  } : null,
  finalMetrics: client.getMetrics(),
}, null, 2));
