<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->asciiUuid('tenant_id');
            $table->asciiUuid('id');
            $table->string('full_name', 200);
            $table->string('phone', 11)->charset('ascii')->collation('ascii_bin');   // stored as 0912345678
            $table->string('email')->nullable();
            $table->date('birthday')->nullable();
            $table->dateTime('created_at')->useCurrent();
            $table->primary(['tenant_id', 'id']);                 // tenant first: InnoDB clusters each tenant's rows
            $table->unique(['tenant_id', 'phone']);               // customers_tenant_id_phone_unique → 409
            $table->index(['tenant_id', 'created_at', 'id']);     // the list order
            $table->foreign('tenant_id')->references('id')->on('tenants');
        });
        DB::statement("ALTER TABLE customers ADD CONSTRAINT customers_phone CHECK (phone REGEXP '^0[0-9]{9,10}$')");
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
