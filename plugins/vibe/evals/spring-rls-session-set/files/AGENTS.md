# Spa CRM API

Spring Boot 4.1, Java 21, Spring Data JPA, Flyway, PostgreSQL 16 with RLS (FORCE) on every tenant table.
The app connects as `spa_app` (NOSUPERUSER NOBYPASSRLS); Flyway runs as `spa_owner`.
Each login belongs to one spa: the JWT claim `tenant_id` is the spa.

Tests: `mvn test` (needs a local PostgreSQL; not available in every environment).
