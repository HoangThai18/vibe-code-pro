<?php

namespace Tests\Feature;

use Tests\TestCase;

final class CustomersApiTest extends TestCase
{
    public function test_create_normalizes_the_phone_and_a_duplicate_in_the_tenant_is_409(): void
    {
        $a = $this->member();
        $b = $this->member();
        $url = "/v1/t/{$a['tenantId']}/customers";
        $res = $this->as($a)->postJson($url, ['fullName' => 'Nguyễn Thị Thảo', 'phone' => '+84 912 345 678'])->assertCreated();
        $res->assertJsonPath('data.phone', '0912345678')->assertJsonPath('data.email', null);
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $res->json('data.createdAt'));

        $this->as($a)->postJson($url, ['fullName' => 'Người khác', 'phone' => '0912 345 678'])
            ->assertStatus(409)->assertExactJson(['error' => ['code' => 'customer_phone_taken', 'message' => 'Số điện thoại này đã có trong workspace.']]);
        // Unique per tenant, not global: another spa may have the same customer
        $this->as($b)->postJson("/v1/t/{$b['tenantId']}/customers", ['fullName' => 'Thảo', 'phone' => '0912345678'])->assertCreated();
    }

    public function test_validation_errors_are_400_with_details(): void
    {
        $a = $this->member();
        $this->as($a)->postJson("/v1/t/{$a['tenantId']}/customers", ['fullName' => '', 'phone' => '12345'])
            ->assertStatus(400)->assertJsonPath('error.code', 'validation_failed')
            ->assertJsonStructure(['error' => ['details' => ['fullName', 'phone']]]);
    }

    public function test_cursor_pagination_returns_every_row_once(): void
    {
        $a = $this->member();
        foreach (range(1, 25) as $i) {
            $this->customer($a, "Khách $i", sprintf('09000000%02d', $i));
        }
        [$seen, $cursor, $pages] = [[], null, 0];
        do {
            $res = $this->as($a)->getJson("/v1/t/{$a['tenantId']}/customers?limit=10".($cursor ? "&cursor=$cursor" : ''))->assertOk();
            $seen = [...$seen, ...$res->json('data.*.id')];
            $cursor = $res->json('nextCursor');
            $pages++;
        } while ($cursor !== null);
        $this->assertSame(3, $pages);
        $this->assertCount(25, array_unique($seen));
        $this->as($a)->getJson("/v1/t/{$a['tenantId']}/customers?limit=101")->assertStatus(400);
    }

    public function test_patch_changes_only_the_fields_sent_and_keeps_phones_unique(): void
    {
        $a = $this->member();
        $id = $this->customer($a, 'Lan', '0911000001');
        $this->customer($a, 'Mai', '0911000002');
        $this->as($a)->patchJson("/v1/t/{$a['tenantId']}/customers/{$id}", ['fullName' => 'Lan Anh'])
            ->assertOk()->assertJsonPath('data.fullName', 'Lan Anh')->assertJsonPath('data.phone', '0911000001');
        $this->as($a)->patchJson("/v1/t/{$a['tenantId']}/customers/{$id}", ['phone' => '0911000002'])
            ->assertStatus(409)->assertJsonPath('error.code', 'customer_phone_taken');
    }

    public function test_no_token_is_401(): void
    {
        $a = $this->member();
        $this->app['auth']->forgetGuards();
        $this->getJson("/v1/t/{$a['tenantId']}/customers")->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }
}
