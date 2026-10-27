-- Single-tenant app: each user sees and changes only their own rows
CREATE TABLE public.notes (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  body    text NOT NULL
);
CREATE INDEX notes_user ON public.notes (user_id);   -- the column every policy filters on
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON public.notes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
