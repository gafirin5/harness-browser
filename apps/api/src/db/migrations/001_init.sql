-- 001_init.sql
CREATE TABLE users (
  id                    bigserial PRIMARY KEY,
  email                 varchar(100) NOT NULL,
  password_hash         varchar(255) NOT NULL,
  name                  varchar(100) NOT NULL,
  role                  varchar(20)  NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('ADMIN')),
  is_active             boolean      NOT NULL DEFAULT true,
  failed_login_attempts integer      NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  password_changed_at   timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_ux ON users (lower(email));

CREATE TABLE providers (
  id                 bigserial PRIMARY KEY,
  user_id            bigint        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name               varchar(100)  NOT NULL,
  provider_type      varchar(20)   NOT NULL CHECK (provider_type IN ('OPENAI','ANTHROPIC','LITELLM','CUSTOM')),
  base_url           varchar(255)  NOT NULL CHECK (base_url ~ '^https?://'),
  api_key_encrypted  text          NOT NULL,
  default_model      varchar(100)  NOT NULL,
  cost_per_1k_tokens numeric(10,4) NOT NULL CHECK (cost_per_1k_tokens >= 0),
  is_active          boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX providers_name_lower_ux ON providers (lower(name));

CREATE TABLE agents (
  id                 bigserial PRIMARY KEY,
  user_id            bigint        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id        bigint        NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  code               varchar(20)   NOT NULL,
  name               varchar(100)  NOT NULL,
  endpoint_url       varchar(255)  NOT NULL CHECK (endpoint_url ~ '^https?://'),
  status             varchar(10)   NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE','BUSY','OFFLINE')),
  max_concurrency    integer       NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 10),
  active_tasks_count integer       NOT NULL DEFAULT 0 CHECK (active_tasks_count >= 0),
  auth_token_hash    varchar(64)   NOT NULL,
  auth_token_encrypted text        NOT NULL,
  last_heartbeat_at  timestamptz,
  last_error         text,
  is_active          boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agents_code_lower_ux ON agents (lower(code));
CREATE INDEX agents_status_ix ON agents (is_active, status);
CREATE INDEX agents_token_ix ON agents (auth_token_hash);

CREATE TABLE tasks (
  id                   bigserial PRIMARY KEY,
  code                 varchar(20)   NOT NULL,
  user_id              bigint        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_id             bigint        NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  provider_id          bigint        NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  title                varchar(150)  NOT NULL,
  prompt               text          NOT NULL CHECK (char_length(prompt) BETWEEN 10 AND 10000),
  priority             integer       NOT NULL DEFAULT 2 CHECK (priority IN (1,2,3)),
  status               varchar(12)   NOT NULL DEFAULT 'QUEUED'
                       CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  token_used           integer       NOT NULL DEFAULT 0 CHECK (token_used >= 0),
  cost_per_1k_snapshot numeric(10,4) NOT NULL CHECK (cost_per_1k_snapshot >= 0),
  cost_usd             numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cancel_reason        varchar(255),
  error_message        text,
  result               text,
  retry_of_task_id     bigint        REFERENCES tasks(id) ON DELETE RESTRICT,
  client_request_id    uuid,
  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CHECK (status <> 'CANCELLED' OR char_length(cancel_reason) BETWEEN 5 AND 255)
);
CREATE UNIQUE INDEX tasks_code_ux ON tasks (code);
CREATE UNIQUE INDEX tasks_client_request_ux ON tasks (client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX tasks_queue_ix ON tasks (status, priority DESC, created_at) WHERE status = 'QUEUED';
CREATE INDEX tasks_agent_status_ix ON tasks (agent_id, status);
CREATE INDEX tasks_finished_ix ON tasks (finished_at, status);
CREATE INDEX tasks_created_ix ON tasks (created_at DESC);
CREATE INDEX tasks_retry_ix ON tasks (retry_of_task_id);

CREATE TABLE task_logs (
  id          bigserial PRIMARY KEY,
  task_id     bigint      NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  user_id     bigint      REFERENCES users(id) ON DELETE RESTRICT,
  actor_type  varchar(10) NOT NULL CHECK (actor_type IN ('USER','SYSTEM','AGENT')),
  from_status varchar(12) CHECK (from_status IS NULL OR from_status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  to_status   varchar(12) NOT NULL CHECK (to_status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  log_level   varchar(5)  NOT NULL DEFAULT 'INFO' CHECK (log_level IN ('INFO','WARN','ERROR')),
  message     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_logs_task_ix ON task_logs (task_id, id);
CREATE INDEX task_logs_created_ix ON task_logs (created_at DESC);

CREATE TABLE task_code_sequences (
  business_date date PRIMARY KEY,
  last_value    integer NOT NULL CHECK (last_value > 0)
);

CREATE TABLE sessions (
  id           varchar(64) PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   varchar(64) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           inet,
  user_agent   text
);
CREATE UNIQUE INDEX sessions_token_hash_ux ON sessions (token_hash);
CREATE INDEX sessions_user_ix ON sessions (user_id, revoked_at);
CREATE INDEX sessions_expiry_ix ON sessions (expires_at);
