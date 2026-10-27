<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 200);
            $table->string('status', 20)->default('active');
            $table->string('time_zone', 64)->default('Asia/Ho_Chi_Minh');
            $table->dateTime('created_at')->useCurrent();
        });

        // Global: one person can belong to several tenants
        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('email')->unique();
            $table->string('password')->nullable();
            $table->dateTime('created_at')->useCurrent();
        });

        Schema::create('memberships', function (Blueprint $table) {
            $table->foreignUuid('tenant_id')->constrained();
            $table->foreignUuid('user_id')->constrained();
            $table->string('role', 20);
            $table->dateTime('created_at')->useCurrent();
            $table->primary(['tenant_id', 'user_id']);
        });

        // The schema builder has no CHECK constraints: raw statements (enforced since MySQL 8.0.16)
        DB::statement("ALTER TABLE tenants ADD CONSTRAINT tenants_status CHECK (status IN ('active', 'suspended', 'closed'))");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email))");
        DB::statement("ALTER TABLE memberships ADD CONSTRAINT memberships_role CHECK (role IN ('owner', 'manager', 'staff'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('memberships');
        Schema::dropIfExists('users');
        Schema::dropIfExists('tenants');
    }
};
