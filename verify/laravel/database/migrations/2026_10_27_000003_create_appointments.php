<?php
// database/migrations/2026_10_27_000003_create_appointments.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('appointments', function (Blueprint $table) {
            $table->uuid('tenant_id');
            $table->uuid('id');
            $table->uuid('customer_id');
            $table->uuid('staff_user_id');
            $table->dateTime('starts_at');                        // UTC
            $table->dateTime('ends_at');
            $table->string('status', 20)->default('booked');
            $table->dateTime('created_at')->useCurrent();
            $table->primary(['tenant_id', 'id']);
            $table->foreign('tenant_id')->references('id')->on('tenants');
            // Composite FKs: the database rejects another tenant's customer or staff member
            $table->foreign(['tenant_id', 'customer_id'])->references(['tenant_id', 'id'])->on('customers');
            $table->foreign(['tenant_id', 'staff_user_id'])->references(['tenant_id', 'user_id'])->on('memberships');
            $table->index(['tenant_id', 'staff_user_id', 'starts_at']);   // the overlap check
            $table->index(['tenant_id', 'starts_at']);
        });
        DB::statement('ALTER TABLE appointments ADD CONSTRAINT appointments_time CHECK (ends_at > starts_at)');
        DB::statement("ALTER TABLE appointments ADD CONSTRAINT appointments_status
            CHECK (status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show'))");
        // No exclusion constraint on MySQL: BookingService locks the staff member instead
    }

    public function down(): void
    {
        Schema::dropIfExists('appointments');
    }
};
