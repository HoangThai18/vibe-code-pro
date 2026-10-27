<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// The reminder log of references/jobs.md. Laravel's database notification channel also wants a table
// named `notifications` (make:notifications-table): rename one if you use both.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('tenant_id');
            $table->uuid('id');
            $table->uuid('appointment_id');
            $table->string('kind', 40);
            $table->string('status', 20)->default('pending');
            $table->dateTime('sent_at')->nullable();
            $table->dateTime('created_at')->useCurrent();
            $table->primary(['tenant_id', 'id']);
            $table->foreign(['tenant_id', 'appointment_id'])->references(['tenant_id', 'id'])->on('appointments')
                ->cascadeOnDelete();
            $table->unique(['tenant_id', 'appointment_id', 'kind']);   // one reminder of each kind per appointment
        });
        DB::statement("ALTER TABLE notifications ADD CONSTRAINT notifications_status CHECK (status IN ('pending', 'sent', 'skipped'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
