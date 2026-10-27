# Spa CRM API

Laravel 13, PHP 8.3, MySQL 8.4, Sanctum tokens. Many spas share one database: every tenant table has `tenant_id`,
the tenant is in the URL (`/v1/t/{tenant}/...`) and `SetCurrentTenant` checks the membership.
Queue: database driver, `php artisan queue:work` on a separate server.
