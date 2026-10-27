<?php
// php scripts/database.php create|drop: the MySQL database $VERIFY_DB, as the $MYSQL_URL user
$u = parse_url(getenv('MYSQL_URL') ?: 'mysql://root:root@127.0.0.1:3306');
$pdo = new PDO(sprintf('mysql:host=%s;port=%d', $u['host'], $u['port'] ?? 3306), urldecode($u['user'] ?? 'root'),
    urldecode($u['pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db = str_replace('`', '', getenv('VERIFY_DB') ?: 'verify_laravel');
$pdo->exec("DROP DATABASE IF EXISTS `$db`");
if (($argv[1] ?? '') === 'create') {
    $pdo->exec("CREATE DATABASE `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
}
echo "$argv[1] $db on MySQL ", $pdo->query('SELECT VERSION()')->fetchColumn(), "\n";
