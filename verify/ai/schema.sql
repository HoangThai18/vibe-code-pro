-- Ngân sách AI theo tenant (micro-USD; 5_000_000 = 5 USD/tháng)
ALTER TABLE tenants ADD COLUMN ai_monthly_budget_micro_usd bigint NOT NULL DEFAULT 5000000
  CHECK (ai_monthly_budget_micro_usd >= 0);

CREATE TABLE ai_usage (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  user_id            uuid NOT NULL,
  feature            text NOT NULL,
  model              text NOT NULL,
  input_tokens       integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens      integer NOT NULL CHECK (output_tokens >= 0),
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cost_micro_usd     bigint  NOT NULL CHECK (cost_micro_usd >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_tenant_created ON ai_usage (tenant_id, created_at);
-- Hệ thống dùng RLS thì thêm policy theo tenant như mọi bảng khác (skill backend, postgres-rls.md)
