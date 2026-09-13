create schema if not exists private;

create table if not exists private.user_model_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'deepseek', 'qwen', 'glm')),
  model_id text not null check (char_length(model_id) between 1 and 160),
  base_url text not null,
  encrypted_api_key bytea not null,
  encrypted_api_key_nonce bytea not null,
  encrypted_api_key_tag bytea not null,
  key_fingerprint text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create unique index if not exists user_model_settings_one_active_per_user
  on private.user_model_settings (user_id)
  where is_active;

revoke all on table private.user_model_settings from anon, authenticated;

comment on table private.user_model_settings is
  'Per-user LLM model preferences and AES-256-GCM encrypted API keys. Accessed only by trusted backend services.';
