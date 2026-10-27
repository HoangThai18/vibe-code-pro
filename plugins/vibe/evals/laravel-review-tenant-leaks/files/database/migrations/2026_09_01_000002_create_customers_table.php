<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained();
            $table->string('full_name', 200);
            $table->string('phone', 11);
            $table->string('email')->nullable();
            $table->date('birthday')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'phone']);
            $table->index(['tenant_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
