-- 用户自带 RedFox API Key：仅可信服务端可访问，浏览器与 PostgREST 不暴露。
create table if not exists private.redfox_api_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_api_key bytea not null,
  encrypted_api_key_nonce bytea not null,
  encrypted_api_key_tag bytea not null,
  key_fingerprint text not null check (char_length(key_fingerprint) = 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.redfox_api_credentials from anon, authenticated;
