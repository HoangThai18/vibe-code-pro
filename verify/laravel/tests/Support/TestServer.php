<?php

namespace Tests\Support;

use Illuminate\Process\InvokedProcess;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use RuntimeException;

// A real server in other processes, on the test database. PHP's built-in server (what `php artisan serve` runs)
// handles ONE request at a time unless PHP_CLI_SERVER_WORKERS > 1; `artisan serve` also needs --no-reload for it.
final class TestServer
{
    public static function start(int $workers): array
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0');   // a free port
        $port = (int) substr(strrchr(stream_socket_get_name($socket, false), ':'), 1);
        fclose($socket);
        $process = Process::path(public_path())->env(['PHP_CLI_SERVER_WORKERS' => (string) $workers])
            ->start([PHP_BINARY, '-S', "127.0.0.1:{$port}", 'index.php']);
        $url = "http://127.0.0.1:{$port}";
        foreach (range(1, 100) as $_) {
            try {
                if (Http::timeout(1)->get("{$url}/up")->ok()) {
                    return [$process, $url];
                }
            } catch (\Throwable) {
                usleep(100_000);
            }
        }
        $process->stop();
        throw new RuntimeException('server did not start: '.$process->errorOutput());
    }

    public static function stop(InvokedProcess $process): void
    {
        $process->stop();   // SIGTERM to the php -S master stops its workers too
    }
}
