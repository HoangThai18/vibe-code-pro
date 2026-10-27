# Spa booking API

Laravel 13, PHP 8.3, MySQL 8.4 (InnoDB, default REPEATABLE READ), Sanctum tokens. Many spas share one database;
the tenant is in the URL (`/v1/t/{tenant}/...`). Production: nginx + php-fpm (pm.max_children = 20), 2 servers.
Tests: `php artisan test` against a MySQL test database.
