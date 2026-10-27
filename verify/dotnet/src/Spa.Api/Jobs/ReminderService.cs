namespace Spa.Api.Jobs;

// Runs in every instance; ReminderJob is safe to run concurrently (UNIQUE + SKIP LOCKED + lease)
public sealed class ReminderService(ReminderJob job, IConfiguration config, ILogger<ReminderService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(config.GetValue("Reminders:IntervalSeconds", 600.0)));
        do
        {
            try
            {
                await job.RunOnceAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "Reminder run failed");   // an exception escaping ExecuteAsync stops the whole host
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
