-- Per-tenant AI budget (micro-USD; 5_000_000 = 5 USD/month)
ALTER TABLE tenants ADD COLUMN ai_monthly_budget_micro_usd bigint NOT NULL DEFAULT 5000000
  CHECK (ai_monthly_budget_micro_usd >= 0);

-- One row per billed attempt: a call that fell back to another model writes one row per model
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
  cost_micro_usd     bigint CHECK (cost_micro_usd >= 0),   -- NULL: no price for the model yet; backfill once added
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_tenant_created ON ai_usage (tenant_id, created_at);
-- FORCE RLS with a tenant policy like every other table (the vibe-backend skill, references/postgres-rls.md)
