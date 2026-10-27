-- Conversations are private to the user who started them, inside one tenant
CREATE TABLE ai_conversations (
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  context_from integer NOT NULL DEFAULT 0,   -- first message sent to the model; earlier ones stay for the UI
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Append-only: content is exactly what was sent, or the response's content blocks as returned.
-- json, not jsonb: jsonb reorders object keys, and replayed blocks (tool inputs too) must come back as they were
CREATE TABLE ai_messages (
  tenant_id       uuid NOT NULL,
  conversation_id uuid NOT NULL,
  seq             integer NOT NULL,          -- the primary key rejects a second concurrent turn
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         json NOT NULL,
  prompt_tokens   integer,                   -- assistant rows: size of the prompt that produced it
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conversation_id, seq),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES ai_conversations (tenant_id, id) ON DELETE CASCADE
);
-- FORCE RLS with a tenant policy on both tables, like every other tenant table
