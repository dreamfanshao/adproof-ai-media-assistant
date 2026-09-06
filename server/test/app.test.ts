import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadServerConfig } from "../src/config.js";
import type { ServerConfig } from "../src/config.js";
import type { AuthVerifier } from "../src/plugins/auth.js";
import type { ProfileRepository, UserProfile } from "../src/services/profile-repository.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getKnowledgeDocumentContent, getPrivateKnowledgeDocumentContent } from "../src/services/knowledge-content-service.js";
import type {
  PlatformConnection,
  XhsConnectionService,
} from "../src/services/xhs-connection-service.js";
import { XhsSessionCipher } from "../src/services/xhs-session-persistence.js";
import { RedfoxApiKeyCipher, type RedfoxCredentialStore } from "../src/services/redfox-credential-service.js";
import type { FeedbackRepository, FeedbackTicket, CreateFeedbackInput } from "../src/services/feedback-repository.js";

const config: ServerConfig = {
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "sb_publishable_test",
  host: "127.0.0.1",
  port: 3001,
  webOrigins: ["http://127.0.0.1:5173"],
};

const profile: UserProfile = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "tester@example.invalid",
  display_name: "测试媒介",
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:00:00.000Z",
};

const verifier: AuthVerifier = {
  async verify() {
    return { userId: profile.id, email: profile.email };
  },
};

const repository: ProfileRepository = {
  async get() { return profile; },
  async update(_token, _userId, _email, displayName) { return { ...profile, display_name: displayName }; },
};

function createFeedbackRepository(): FeedbackRepository {
  const rows: FeedbackTicket[] = [];
  return {
    async list(userId) { return rows.filter((row) => row.user_id === userId); },
    async create(userId, input: CreateFeedbackInput) {
      const row: FeedbackTicket = {
        id: `ticket-${rows.length + 1}`,
        user_id: userId,
        ...input,
        page_path: input.page_path ?? null,
        status: "open",
        priority: "normal",
        admin_reply: null,
        created_at: "2026-09-04T00:00:00.000Z",
        updated_at: "2026-09-04T00:00:00.000Z",
        resolved_at: null,
      };
      rows.push(row);
      return row;
    },
  };
}

function createConnectionService(): XhsConnectionService & { disconnectCount: number } {
  const now = "2026-08-17T01:00:00.000Z";
  let connection: PlatformConnection = {
    id: null,
    task_id: null,
    platform: "xiaohongshu",
    status: "disconnected",
    qr_image_url: null,
    qr_expires_at: null,
    session_expires_at: null,
    last_verified_at: null,
    account_display_name: null,
    account_handle_masked: null,
    avatar_url: null,
    message_code: null,
    created_at: now,
    updated_at: now,
  };

  return {
    disconnectCount: 0,
    async create() {
      connection = {
        ...connection,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        task_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "qr_pending",
        qr_image_url: "data:image/png;base64,dGVzdA==",
        qr_expires_at: "2026-08-17T01:02:00.000Z",
        message_code: "XHS_QR_READY",
      };
      return { ...connection };
    },
    async get() { return { ...connection }; },
    async showVerificationWindow() { return { ...connection }; },
    async disconnect() {
      this.disconnectCount += 1;
      connection = { ...connection, status: "disconnected", qr_image_url: null };
    },
    async closeAll() {},
  };
}

test("readiness fails closed when database is not configured", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/ready" });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().data.status, "not_ready");
  } finally { await app.close(); }
});

test("readiness returns sanitized 503 when database is unavailable", async () => {
  const app = await buildApp({ config: { ...config, databaseUrl: "postgresql://unit:private-test-value@127.0.0.1:1/unit" }, authVerifier: verifier, profileRepository: repository });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/ready" });
    assert.equal(response.statusCode, 503);
    assert(!response.body.includes("private-test-value"));
  } finally { await app.close(); }
});

test("GET /api/v1/health is public and contract-shaped", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  const response = await app.inject({ method: "GET", url: "/api/v1/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.status, "ok");
  assert.match(body.meta.request_id, /^[0-9a-f-]{36}$/i);
  await app.close();
});

test("feedback tickets require auth and are scoped to the authenticated user", async () => {
  const feedbackRepository = createFeedbackRepository();
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository, feedbackRepository });
  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/feedback-tickets" });
  assert.equal(unauthorized.statusCode, 401);
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/feedback-tickets",
    headers: { authorization: "Bearer verified-token" },
    payload: { category: "bug", title: "评测状态未保持", description: "点击刷新后测试状态消失", page_path: "/admin" },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().data.user_id, profile.id);
  const listed = await app.inject({ method: "GET", url: "/api/v1/feedback-tickets", headers: { authorization: "Bearer verified-token" } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().meta.total, 1);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/feedback-tickets",
    headers: { authorization: "Bearer verified-token" },
    payload: { category: "bug", title: "", description: "x" },
  });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});

test("GET /api/v1/me rejects a missing bearer token", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  const response = await app.inject({ method: "GET", url: "/api/v1/me" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_REQUIRED");
  await app.close();
});

test("GET /api/v1/me derives identity from the verified token", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: { authorization: "Bearer verified-token" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, profile);
  await app.close();
});

test("RedFox API keys use authenticated encryption scoped to the owning user", () => {
  const cipher = new RedfoxApiKeyCipher(Buffer.alloc(32, 9).toString("base64"));
  const encrypted = cipher.encrypt(profile.id, "redfox-secret-key-for-tests");
  assert.notEqual(encrypted.ciphertext.toString("utf8"), "redfox-secret-key-for-tests");
  assert.equal(cipher.decrypt(profile.id, encrypted), "redfox-secret-key-for-tests");
  assert.throws(() => cipher.decrypt("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", encrypted));
});

test("RedFox credential endpoint stores a user override without echoing the key", async () => {
  const saved = new Map<string, string>();
  const redfoxCredentialStore: RedfoxCredentialStore = {
    async status(userId) {
      return saved.has(userId)
        ? { configured: true, fingerprint: "A1B2C3D4E5", updatedAt: "2026-08-31T00:00:00.000Z" }
        : { configured: false, fingerprint: null, updatedAt: null };
    },
    async save(userId, apiKey) {
      saved.set(userId, apiKey);
      return { configured: true, fingerprint: "A1B2C3D4E5", updatedAt: "2026-08-31T00:00:00.000Z" };
    },
    async resolve(userId) { return saved.get(userId) ?? null; },
  };
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository, redfoxCredentialStore });
  const apiKey = "redfox-secret-key-for-tests";
  const response = await app.inject({
    method: "PUT",
    url: "/api/v1/redfox-credential",
    headers: { authorization: "Bearer verified-token" },
    payload: { api_key: apiKey },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.source, "user");
  assert.equal(response.json().data.fingerprint, "A1B2C3D4E5");
  assert.ok(!response.body.includes(apiKey));
  assert.equal(await redfoxCredentialStore.resolve(profile.id), apiKey);

  const status = await app.inject({
    method: "GET",
    url: "/api/v1/redfox-credential",
    headers: { authorization: "Bearer verified-token" },
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.source, "user");
  assert.ok(!status.body.includes(apiKey));
  const invalid = await app.inject({
    method: "PUT",
    url: "/api/v1/redfox-credential",
    headers: { authorization: "Bearer verified-token" },
    payload: { api_key: "short" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "VALIDATION_INVALID_REQUEST");
  await app.close();
});

test("RedFox credential endpoint requires authentication and reports unavailable secure storage", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/redfox-credential" });
  assert.equal(unauthorized.statusCode, 401);
  const invalid = await app.inject({
    method: "PUT",
    url: "/api/v1/redfox-credential",
    headers: { authorization: "Bearer verified-token" },
    payload: { api_key: "short" },
  });
  assert.equal(invalid.statusCode, 503);
  assert.equal(invalid.json().error.code, "REDFOX_CREDENTIAL_STORAGE_UNAVAILABLE");
  await app.close();
});

test("PATCH /api/v1/me validates and trims display_name", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  const response = await app.inject({
    method: "PATCH",
    url: "/api/v1/me",
    headers: { authorization: "Bearer verified-token" },
    payload: { display_name: "  新名称  " },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.display_name, "新名称");
  await app.close();
});

test("PATCH /api/v1/me rejects unknown fields", async () => {
  const app = await buildApp({ config, authVerifier: verifier, profileRepository: repository });
  const response = await app.inject({
    method: "PATCH",
    url: "/api/v1/me",
    headers: { authorization: "Bearer verified-token" },
    payload: { display_name: "有效名称", user_id: "forged" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_INVALID_REQUEST");
  await app.close();
});

test("POST /api/v1/platform-connections/xiaohongshu reports that RedFox does not require QR login", async () => {
  const xhsConnectionService = createConnectionService();
  const app = await buildApp({
    config,
    authVerifier: verifier,
    profileRepository: repository,
    xhsConnectionService,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/platform-connections/xiaohongshu",
    headers: { authorization: "Bearer verified-token" },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "XHS_QR_NOT_REQUIRED");
  await app.close();
});

test("GET /api/v1/platform-connections/xiaohongshu requires authentication", async () => {
  const app = await buildApp({
    config,
    authVerifier: verifier,
    profileRepository: repository,
    xhsConnectionService: createConnectionService(),
  });
  const response = await app.inject({ method: "GET", url: "/api/v1/platform-connections/xiaohongshu" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_REQUIRED");
  await app.close();
});

test("DELETE /api/v1/platform-connections/xiaohongshu remains idempotent for the RedFox data source", async () => {
  const xhsConnectionService = createConnectionService();
  const app = await buildApp({
    config,
    authVerifier: verifier,
    profileRepository: repository,
    xhsConnectionService,
  });
  const response = await app.inject({
    method: "DELETE",
    url: "/api/v1/platform-connections/xiaohongshu",
    headers: { authorization: "Bearer verified-token" },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(xhsConnectionService.disconnectCount, 0);
  await app.close();
});


test("POST /api/v1/platform-connections/xiaohongshu/verify requires authentication", async () => {
  const app = await buildApp({
    config,
    authVerifier: verifier,
    profileRepository: repository,
    xhsConnectionService: createConnectionService(),
  });
  const response = await app.inject({ method: "POST", url: "/api/v1/platform-connections/xiaohongshu/verify" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_REQUIRED");
  await app.close();
});

test("POST /api/v1/platform-connections/xiaohongshu/verify reports that RedFox does not require QR verification", async () => {
  const xhsConnectionService = createConnectionService();
  const app = await buildApp({
    config,
    authVerifier: verifier,
    profileRepository: repository,
    xhsConnectionService,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/platform-connections/xiaohongshu/verify",
    headers: { authorization: "Bearer verified-token" },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "XHS_QR_NOT_REQUIRED");
  await app.close();
});

test("XHS storage state uses authenticated encryption and rejects tampering", () => {
  const cipher = new XhsSessionCipher(Buffer.alloc(32, 7).toString("base64"));
  const storageState = {
    cookies: [{ name: "test", value: "sensitive", domain: ".example.invalid", path: "/" }],
    origins: [],
  };
  const encrypted = cipher.encrypt(storageState);
  assert.notEqual(encrypted.ciphertext.toString("utf8"), JSON.stringify(storageState));
  assert.deepEqual(cipher.decrypt(encrypted), storageState);

  const tampered = { ...encrypted, tag: Buffer.from(encrypted.tag) };
  tampered.tag[0] ^= 0xff;
  assert.throws(() => cipher.decrypt(tampered));
});

test("loadServerConfig accepts paired session persistence keys", () => {
  const parsed = loadServerConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_role_key",
    XHS_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("hex"),
  });
  assert.equal(parsed.supabaseServiceRoleKey, "sb_secret_test_role_key");
  assert.equal(parsed.xhsSessionEncryptionKey?.length, 64);
});

test("loadServerConfig rejects a single persistence key without its pair", () => {
  assert.throws(
    () => loadServerConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_role_key",
    }),
    /XHS_SESSION_ENCRYPTION_KEY/,
  );
});

test("XhsSessionCipher rejects keys that do not decode to 32 bytes", () => {
  assert.throws(() => new XhsSessionCipher("too-short"), /must decode to exactly 32 bytes/);
  assert.throws(() => new XhsSessionCipher("ff"), /must decode to exactly 32 bytes/);
});

function createKnowledgeContentClient(document: Record<string, unknown> | null) {
  const filters: Array<{ table: string; field: string; value: unknown }> = [];
  const chunks = [{ id: "chunk-1", chunk_index: 0, content: "企业内容不得使用绝对化用语。", source_locator: "第 1 条", metadata: {} }];
  const client = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { filters.push({ table, field, value }); return query; },
        order() { return query; },
        maybeSingle() { return Promise.resolve({ data: document, error: null }); },
        range() { return Promise.resolve({ data: chunks, count: chunks.length, error: null }); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, filters };
}

function createScopedKnowledgeContentClient(input: {
  document: Record<string, unknown> | null;
  knowledgeBase: Record<string, unknown> | null;
}) {
  const filters: Array<{ table: string; field: string; value: unknown }> = [];
  const chunks = [{ id: "public-chunk-1", chunk_index: 0, content: "公共审核依据示例", source_locator: "第 1 条", metadata: {} }];
  const client = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { filters.push({ table, field, value }); return query; },
        is(field: string, value: unknown) { filters.push({ table, field, value }); return query; },
        order() { return query; },
        maybeSingle() {
          return Promise.resolve({ data: table === "knowledge_documents" ? input.document : input.knowledgeBase, error: null });
        },
        range() { return Promise.resolve({ data: chunks, count: chunks.length, error: null }); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, filters };
}

test("public knowledge content is readable but remains scoped to public rows", async () => {
  const documentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const { client, filters } = createScopedKnowledgeContentClient({
    document: {
      id: documentId,
      knowledge_base_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      file_name: "广告法核心条款.md",
      mime_type: "text/markdown",
      size_bytes: 128,
      page_count: null,
      chunk_count: 1,
      status: "ready",
      version: 1,
      created_at: "2026-08-30T00:00:00.000Z",
      updated_at: "2026-08-30T00:00:00.000Z",
      user_id: null,
    },
    knowledgeBase: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", scope: "public_law", user_id: null },
  });
  const result = await getKnowledgeDocumentContent(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    documentId,
    offset: 0,
    limit: 50,
  });
  assert.equal(result.scope, "public_law");
  assert.equal(result.chunks[0]?.content, "公共审核依据示例");
  assert.ok(filters.some((item) => item.table === "knowledge_chunks" && item.field === "user_id" && item.value === null));
});

test("private knowledge content rejects a document owned by another user", async () => {
  const { client } = createScopedKnowledgeContentClient({
    document: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", knowledge_base_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", version: 1 },
    knowledgeBase: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", scope: "private", user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
  });
  await assert.rejects(
    getKnowledgeDocumentContent(client, { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", offset: 0, limit: 50 }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "DOCUMENT_NOT_FOUND"),
  );
});

test("private knowledge content is scoped to the current user and document version", async () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const documentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const { client, filters } = createKnowledgeContentClient({
    id: documentId,
    knowledge_base_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    file_name: "品牌规则.md",
    mime_type: "text/markdown",
    size_bytes: 128,
    page_count: null,
    chunk_count: 1,
    status: "ready",
    version: 3,
    created_at: "2026-08-30T00:00:00.000Z",
    updated_at: "2026-08-30T00:00:00.000Z",
  });

  const result = await getPrivateKnowledgeDocumentContent(client, { userId, documentId, offset: 0, limit: 50 });
  assert.equal(result.total, 1);
  assert.equal(result.chunks[0]?.content, "企业内容不得使用绝对化用语。");
  assert.ok(filters.some((item) => item.table === "knowledge_documents" && item.field === "user_id" && item.value === userId));
  assert.ok(filters.some((item) => item.table === "knowledge_chunks" && item.field === "user_id" && item.value === userId));
  assert.ok(filters.some((item) => item.table === "knowledge_chunks" && item.field === "document_version" && item.value === 3));
});

test("private knowledge content does not disclose an inaccessible document", async () => {
  const { client } = createKnowledgeContentClient(null);
  await assert.rejects(
    getPrivateKnowledgeDocumentContent(client, {
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      offset: 0,
      limit: 50,
    }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "DOCUMENT_NOT_FOUND"),
  );
});
