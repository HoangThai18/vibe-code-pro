<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// php artisan migrate --database=pgsql --path=database/migrations-pgsql (as the owner). The schema builder has
// no RLS: raw statements, in the same migration as the table so it never exists without its policy.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
              SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
            $$
            SQL);
        DB::statement(<<<'SQL'
            CREATE TABLE customers (
              tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
              id        uuid NOT NULL DEFAULT gen_random_uuid(),
              full_name text NOT NULL,
              phone     text NOT NULL CHECK (phone ~ '^0[0-9]{9,10}$'),
              PRIMARY KEY (tenant_id, id),
              UNIQUE (tenant_id, phone)
            )
            SQL);
        DB::statement('ALTER TABLE customers ENABLE ROW LEVEL SECURITY');
        DB::statement('ALTER TABLE customers FORCE ROW LEVEL SECURITY');
        DB::statement('CREATE POLICY tenant_isolation ON customers
            USING (tenant_id = (SELECT app_current_tenant())) WITH CHECK (tenant_id = (SELECT app_current_tenant()))');
        DB::statement('GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO app_user');
    }
};
