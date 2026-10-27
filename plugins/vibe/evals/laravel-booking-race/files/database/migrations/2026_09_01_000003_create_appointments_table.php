<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->string('status', 20)->default('booked');
            $table->timestamps();
            $table->primary(['tenant_id', 'id']);
            $table->foreign(['tenant_id', 'customer_id'])->references(['tenant_id', 'id'])->on('customers');
            $table->foreign(['tenant_id', 'staff_user_id'])->references(['tenant_id', 'user_id'])->on('memberships');
            $table->index(['tenant_id', 'staff_user_id', 'starts_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appointments');
    }
};
