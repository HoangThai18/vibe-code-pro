<?php

namespace Tests\Feature;

use App\Models\Tenant;
use Tests\TestCase;

// The rest of references/isolation-tests.md section 2: lists, a tenantId in the body, cross-tenant references
final class IsolationCasesTest extends TestCase
{
    public function test_list_has_own_rows_only_and_other_tenant_list_is_404(): void
    {
        [$a, $b, $aCustomer, $bCustomer] = $this->seedTwoTenants();
        $ids = $this->as($a)->getJson("/v1/t/{$a['tenantId']}/customers?limit=100")->assertOk()->json('data.*.id');
        $this->assertContains($aCustomer, $ids);   // control: an empty list fails here
        $this->assertNotContains($bCustomer, $ids);
        $this->as($a)->getJson("/v1/t/{$b['tenantId']}/customers")->assertNotFound();
    }

    public function test_tenant_id_in_the_body_is_ignored(): void
    {
        [$a, $b] = $this->seedTwoTenants();
        $id = $this->as($a)->postJson("/v1/t/{$a['tenantId']}/customers",
            ['fullName' => 'Tạo lậu', 'phone' => '0911111111', 'tenantId' => $b['tenantId'], 'tenant_id' => $b['tenantId']])
            ->assertCreated()->json('data.id');
        $this->as($a)->getJson("/v1/t/{$a['tenantId']}/customers/{$id}")->assertOk();
        $this->as($b)->getJson("/v1/t/{$b['tenantId']}/customers/{$id}")->assertNotFound();
    }

    public function test_cannot_book_with_another_tenants_customer(): void
    {
        [$a, , $aCustomer, $bCustomer] = $this->seedTwoTenants();
        $slot = ['staffUserId' => $a['userId'], 'startsAt' => '2026-11-02T03:00:00Z', 'endsAt' => '2026-11-02T04:00:00Z'];
        $this->as($a)->postJson("/v1/t/{$a['tenantId']}/appointments", ['customerId' => $bCustomer, ...$slot])
            ->assertStatus(422)->assertJsonPath('error.code', 'invalid_reference');
        $this->as($a)->postJson("/v1/t/{$a['tenantId']}/appointments", ['customerId' => $aCustomer, ...$slot])->assertCreated();
    }

    public function test_malformed_unknown_or_suspended_tenant_is_404(): void
    {
        $a = $this->member();
        foreach (['not-a-uuid', '019a0000-0000-7000-8000-000000000000'] as $tenantId) {
            $this->as($a)->getJson("/v1/t/{$tenantId}/customers")->assertNotFound()->assertJsonPath('error.code', 'not_found');
        }
        Tenant::whereKey($a['tenantId'])->update(['status' => 'suspended']);
        $this->as($a)->getJson("/v1/t/{$a['tenantId']}/customers")->assertNotFound();
    }
}
