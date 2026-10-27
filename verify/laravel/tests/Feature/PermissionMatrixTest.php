<?php

namespace Tests\Feature;

use App\Auth\Permissions;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PermissionMatrixTest extends TestCase
{
    public static function matrix(): array
    {
        return [
            ['owner', 'billing.manage', true], ['owner', 'api_key.manage', true],
            ['manager', 'appointment.confirm', true], ['manager', 'customer.import', true],
            ['manager', 'member.role_change', true], ['manager', 'billing.manage', false], ['manager', 'api_key.manage', false],
            ['staff', 'customer.read', true], ['staff', 'customer.write', false], ['staff', 'customer.import', false],
            ['staff', 'appointment.write', true], ['staff', 'appointment.confirm', false], ['staff', 'member.role_change', false],
            ['intern', 'customer.read', false],   // a role missing from the table gets nothing
            [null, 'customer.read', false],
        ];
    }

    #[DataProvider('matrix')]
    public function test_role_action(?string $role, string $action, bool $allowed): void
    {
        $this->assertSame($allowed, Permissions::can($role, $action));
    }

    // The same matrix through HTTP: the Gate abilities read the role of the path tenant's membership
    public function test_staff_reads_but_cannot_write_customers(): void
    {
        $owner = $this->member('owner');
        $staff = $this->member('staff', $owner['tenantId']);
        $id = $this->customer($owner, 'Khách', '0912000001');
        $this->as($staff)->getJson("/v1/t/{$staff['tenantId']}/customers/{$id}")->assertOk();
        $this->as($staff)->postJson("/v1/t/{$staff['tenantId']}/customers", ['fullName' => 'X', 'phone' => '0912000002'])
            ->assertForbidden()->assertJsonPath('error.code', 'forbidden');
        $this->as($staff)->patchJson("/v1/t/{$staff['tenantId']}/customers/{$id}", ['fullName' => 'Y'])->assertForbidden();
    }

    public function test_staff_book_only_for_themselves_managers_for_anyone(): void
    {
        $owner = $this->member('owner');
        $manager = $this->member('manager', $owner['tenantId']);
        $staff = $this->member('staff', $owner['tenantId']);
        $other = $this->member('staff', $owner['tenantId']);
        $customer = $this->customer($owner, 'Khách', '0912000003');
        $book = fn (array $as, string $staffUserId, string $hour) => $this->as($as)->postJson("/v1/t/{$owner['tenantId']}/appointments",
            ['customerId' => $customer, 'staffUserId' => $staffUserId, 'startsAt' => "2026-11-02T{$hour}:00:00Z", 'endsAt' => "2026-11-02T{$hour}:30:00Z"]);

        $book($staff, $other['userId'], '03')->assertForbidden();
        $book($staff, $staff['userId'], '03')->assertCreated();
        $book($manager, $other['userId'], '04')->assertCreated();
    }

    // A membership in tenant B gives no role in tenant A
    public function test_the_role_comes_from_the_path_tenant(): void
    {
        $a = $this->member('staff');
        $ownerOfB = $this->member('owner');
        $this->inTenant($ownerOfB, fn () => \App\Models\Membership::create(['user_id' => $a['userId'], 'role' => 'owner']));
        $this->as($a)->postJson("/v1/t/{$a['tenantId']}/customers", ['fullName' => 'X', 'phone' => '0912000004'])->assertForbidden();
        $this->as($a)->postJson("/v1/t/{$ownerOfB['tenantId']}/customers", ['fullName' => 'X', 'phone' => '0912000004'])->assertCreated();
    }
}
