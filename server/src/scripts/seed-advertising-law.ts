// T08 Phase 2｜广告法公共知识库种子：核心条款按"条"切分入库
// 注意：此处为便于 MVP 验证的核心条款子集（条款内容摘自现行《广告法》要点）；
// 完整官方文本待用户提供后替换/补全（替换时用同一 checksum 去重机制升级版本）。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
}

const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ARTICLES: Array<{ article: string; text: string }> = [
  {
    article: "第四条",
    text: "广告不得含有虚假或者引人误解的内容，不得欺骗、误导消费者。广告主应当对广告内容的真实性负责。",
  },
  {
    article: "第五条",
    text: "广告主、广告经营者、广告发布者从事广告活动，应当遵守法律、法规，诚实信用，公平竞争。",
  },
  {
    article: "第八条",
    text: "广告中对商品的性能、功能、产地、用途、质量、成分、价格、生产者、有效期限、允诺等或者对服务的内容、提供者、形式、质量、价格、允诺等有表示的，应当准确、清楚、明白。广告中表明推销的商品或者服务附带赠送的，应当明示所附带赠送商品或者服务的品种、规格、数量、期限和方式。",
  },
  {
    article: "第九条",
    text: "广告不得有下列情形：（一）使用或者变相使用中华人民共和国的国旗、国歌、国徽，军旗、军歌、军徽；（二）使用或者变相使用国家机关、国家机关工作人员的名义或者形象；（三）使用\"国家级\"、\"最高级\"、\"最佳\"等用语；（四）损害国家的尊严或者利益，泄露国家秘密；（五）妨碍社会安定，损害社会公共利益；（六）危害人身、财产安全，泄露个人隐私；（七）妨碍社会公共秩序或者违背社会良好风尚；（八）含有淫秽、色情、赌博、迷信、恐怖、暴力的内容；（九）含有民族、种族、宗教、性别歧视的内容；（十）妨碍环境、自然资源或者文化遗产保护；（十一）法律、行政法规规定禁止的其他情形。",
  },
  {
    article: "第十一条",
    text: "广告内容涉及的事项需要取得行政许可的，应当与许可的内容相符合。广告使用数据、统计资料、调查结果、文摘、引用语等引证内容的，应当真实、准确，并表明出处。引证内容有适用范围和有效期限的，应当明确表示。",
  },
  {
    article: "第十六条",
    text: "医疗、药品、医疗器械广告不得含有下列内容：（一）表示功效、安全性的断言或者保证；（二）说明治愈率或者有效率；（三）与其他药品、医疗器械的功效和安全性或者其他医疗机构比较；（四）利用广告代言人作推荐、证明；（五）法律、行政法规规定禁止的其他内容。医疗、药品、医疗器械广告应当显著标明广告批准文号。",
  },
  {
    article: "第十七条",
    text: "除医疗、药品、医疗器械广告外，禁止其他任何广告涉及疾病治疗功能，并不得使用医疗用语或者易使推销的商品与药品、医疗器械相混淆的用语。",
  },
  {
    article: "第二十八条",
    text: "广告以虚假或者引人误解的内容欺骗、误导消费者的，构成虚假广告。广告有下列情形之一的，为虚假广告：（一）商品或者服务不存在的；（二）商品的性能、功能、产地、用途、质量、规格、成分、价格、生产者、有效期限、销售状况、曾获荣誉等信息，或者服务的内容、提供者、形式、质量、价格、销售状况、曾获荣誉等信息，以及与商品或者服务有关的允诺等信息与实际情况不符，对购买行为有实质性影响的；（三）使用虚构、伪造或者无法验证的科研成果、统计资料、调查结果、文摘、引用语等信息作证明材料的；（四）虚构使用商品或者接受服务的效果的；（五）以虚假或者引人误解的内容欺骗、误导消费者的其他情形。",
  },
];

const fullText = ARTICLES.map((a) => `第${a.article} ${a.text}`).join("\n\n");
const checksum = createHash("sha256").update(fullText, "utf8").digest("hex");

async function main(): Promise<void> {
  // 1. 公共知识库（幂等）
  const { data: existingKb } = await client.from("knowledge_bases").select("id").eq("scope", "public_law").maybeSingle();
  let kbId: string;
  if (existingKb) {
    kbId = existingKb.id as string;
    console.log("public law KB exists:", kbId.slice(0, 8));
  } else {
    const { data: kb, error } = await client
      .from("knowledge_bases")
      .insert({ scope: "public_law", name: "中华人民共和国广告法（核心条款）", description: "公共规则库：现行《广告法》核心条款子集，完整文本待补充" })
      .select("id")
      .single();
    if (error) throw new Error(`create kb: ${error.message}`);
    kbId = kb.id;
    console.log("public law KB created:", kbId.slice(0, 8));
  }

  // 2. 文档（checksum 去重）
  const { data: existingDoc } = await client
    .from("knowledge_documents")
    .select("id")
    .eq("knowledge_base_id", kbId)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (existingDoc) {
    console.log("seed document already exists; skipping.");
    return;
  }
  const { data: doc, error: docError } = await client
    .from("knowledge_documents")
    .insert({
      knowledge_base_id: kbId,
      file_name: "广告法核心条款种子.txt",
      storage_path: "seeded/advertising-law-core.txt",
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(fullText, "utf8"),
      checksum_sha256: checksum,
      status: "ready",
      version: 1,
      chunk_count: ARTICLES.length,
    })
    .select("id")
    .single();
  if (docError) throw new Error(`create doc: ${docError.message}`);

  // 3. 按"条"切分落库
  const rows = ARTICLES.map((a, index) => ({
    knowledge_base_id: kbId,
    document_id: doc.id,
    document_version: 1,
    chunk_index: index,
    content: `第${a.article} ${a.text}`,
    source_locator: a.article,
    metadata: { law: "中华人民共和国广告法", article: a.article },
  }));
  const { error: chunkError } = await client.from("knowledge_chunks").insert(rows);
  if (chunkError) throw new Error(`insert chunks: ${chunkError.message}`);

  // 4. 知识库 ready/可检索
  const { error: kbUpdateError } = await client
    .from("knowledge_bases")
    .update({ status: "ready", document_count: 1, ready_document_count: 1, selectable: true, updated_at: new Date().toISOString() })
    .eq("id", kbId);
  if (kbUpdateError) throw new Error(`update kb: ${kbUpdateError.message}`);

  console.log(`SEED OK: kb=${kbId.slice(0, 8)} doc=${doc.id.slice(0, 8)} chunks=${ARTICLES.length} checksum=${checksum.slice(0, 12)}…`);
}

main().catch((error) => {
  console.error("SEED FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
