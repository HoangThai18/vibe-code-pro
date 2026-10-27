<?php

namespace Tests\Feature;

use App\Jobs\SendAppointmentReminder;
use App\Models\Appointment;
use App\Models\Customer;
use App\Models\Notification;
use App\Models\Tenant;
use App\Reminders\SmsSender;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\FakeSms;
use Tests\TestCase;

// The database queue for real: jobs rows, an in-process `queue:work`, failed_jobs
final class RemindersTest extends TestCase
{
    private FakeSms $sms;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('jobs')->delete();
        DB::table('failed_jobs')->delete();
        Tenant::query()->update(['status' => 'closed']);   // only this test's tenants are active
        $this->app->instance(SmsSender::class, $this->sms = new FakeSms);
    }

    private function appointmentIn(array $m, string $customer, float $hours, string $status = 'booked'): string
    {
        return $this->inTenant($m, fn () => Appointment::create(['customer_id' => $customer, 'staff_user_id' => $m['userId'],
            'starts_at' => now()->addMinutes((int) ($hours * 60)), 'ends_at' => now()->addMinutes((int) ($hours * 60) + 60), 'status' => $status]))->id;
    }

    private function work(): void
    {
        Artisan::call('queue:work', ['--stop-when-empty' => true, '--sleep' => 0]);
    }

    private function notifications(array $m): array
    {
        return $this->inTenant($m, fn () => Notification::query()->pluck('status', 'appointment_id')->all());
    }

    public function test_enqueue_picks_the_2_to_24_hour_window_of_active_tenants_once(): void
    {
        $a = $this->member();
        $suspended = $this->member();
        $c = $this->customer($a, 'Thảo', '0915000001');
        [$in1h, $in10h, $in30h, $cancelled] = [$this->appointmentIn($a, $c, 1), $this->appointmentIn($a, $c, 10),
            $this->appointmentIn($a, $c, 30), $this->appointmentIn($a, $c, 12, 'cancelled')];
        $this->appointmentIn($suspended, $this->customer($suspended, 'Lan', '0915000002'), 10);
        Tenant::whereKey($suspended['tenantId'])->update(['status' => 'suspended']);

        $this->assertSame(0, Artisan::call('reminders:enqueue'));
        $this->assertSame([$in10h => 'pending'], $this->notifications($a));
        $this->assertSame([], $this->notifications($suspended));
        $job = json_decode(DB::table('jobs')->value('payload'), true);
        $this->assertSame(1, DB::table('jobs')->count());
        $this->assertSame(SendAppointmentReminder::class, $job['displayName']);

        $this->assertSame(0, Artisan::call('reminders:enqueue'));   // a rerun (or an overlapping one) adds nothing
        $this->assertSame(1, DB::table('jobs')->count());
    }

    public function test_a_job_dispatched_in_a_rolled_back_transaction_does_not_exist(): void
    {
        $a = $this->member();
        try {
            DB::transaction(function () use ($a) {
                SendAppointmentReminder::dispatch($a['tenantId'], 'x');
                throw new \RuntimeException('rollback');
            });
        } catch (\RuntimeException) {
        }
        $this->assertSame(0, DB::table('jobs')->count());
    }

    public function test_the_worker_sends_one_unaccented_message_in_the_tenant_time_zone(): void
    {
        $a = $this->member();
        $c = $this->customer($a, 'Nguyễn Thị Thảo', '0915000003');
        $this->travelTo(Carbon::parse('2026-11-01T12:00:00Z'));
        $this->inTenant($a, fn () => Appointment::create(['customer_id' => $c, 'staff_user_id' => $a['userId'],
            'starts_at' => '2026-11-02 10:00:00', 'ends_at' => '2026-11-02 11:00:00']));   // UTC = 17:00 in Hà Nội
        Artisan::call('reminders:enqueue');
        $this->inTenant($a, fn () => Customer::whereKey($c)->update(['full_name' => 'Đặng Thị Thảo']));   // after enqueue

        $this->work();
        $notification = $this->inTenant($a, fn () => Notification::sole());
        $this->assertSame([['to' => '0915000003', 'text' => 'Chao Dang Thi Thao, nhac lich hen cua ban luc 17:00 02/11/2026.',
            'idempotencyKey' => $notification->id]], $this->sms->sent);
        $this->assertSame('sent', $notification->status);

        SendAppointmentReminder::dispatch($a['tenantId'], $notification->id);   // delivered twice
        $this->work();
        $this->assertCount(1, $this->sms->sent);
    }

    public function test_a_failure_is_retried_after_the_backoff(): void
    {
        $a = $this->member();
        $this->appointmentIn($a, $this->customer($a, 'Lan', '0915000004'), 10);
        $this->sms->failures = 1;
        Artisan::call('reminders:enqueue');
        $this->work();
        $this->assertSame([], $this->sms->sent);
        $this->assertSame(1, DB::table('jobs')->whereNull('reserved_at')->where('attempts', 1)->count());   // released for 30 s
        $this->travel(31)->seconds();
        $this->work();
        $this->assertCount(1, $this->sms->sent);
    }

    public function test_after_five_failures_the_job_is_in_failed_jobs_and_the_reminder_stays_pending(): void
    {
        $a = $this->member();
        $appointment = $this->appointmentIn($a, $this->customer($a, 'Mai', '0915000005'), 10);
        $this->sms->failures = 99;
        Artisan::call('reminders:enqueue');
        foreach ([0, 30, 120, 600, 1800] as $wait) {
            $this->travel($wait + 1)->seconds();
            $this->work();
        }
        $this->assertSame(0, DB::table('jobs')->count());
        $this->assertSame(1, DB::table('failed_jobs')->count());
        $this->assertSame([$appointment => 'pending'], $this->notifications($a));
    }

    public function test_another_tenants_notification_or_a_cancelled_appointment_sends_nothing(): void
    {
        $a = $this->member();
        $b = $this->member();
        $bAppointment = $this->appointmentIn($b, $this->customer($b, 'Hoa', '0915000006'), 10);
        Artisan::call('reminders:enqueue');
        $bNotification = $this->inTenant($b, fn () => Notification::where('appointment_id', $bAppointment)->value('id'));
        DB::table('jobs')->delete();

        SendAppointmentReminder::dispatch($a['tenantId'], $bNotification);   // B's id, A's tenant
        $this->work();
        $this->inTenant($b, fn () => Appointment::whereKey($bAppointment)->update(['status' => 'cancelled']));
        SendAppointmentReminder::dispatch($b['tenantId'], $bNotification);
        $this->work();

        $this->assertSame([], $this->sms->sent);
        $this->assertSame([$bAppointment => 'skipped'], $this->notifications($b));
    }

    public function test_the_scan_is_scheduled_every_ten_minutes_without_overlap(): void
    {
        $event = collect($this->app->make(Schedule::class)->events())->first(fn ($e) => str_contains($e->command, 'reminders:enqueue'));
        $this->assertSame('*/10 * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
    }
}
