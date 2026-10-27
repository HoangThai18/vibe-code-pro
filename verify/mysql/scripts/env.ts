// MYSQL_URL: a user that may create databases and users (run.sh passes it); VERIFY_DB: the database to create
const base = new URL(process.env.MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3306');
export const DB = process.env.VERIFY_DB ?? 'verify_mysql';
export const APP_USER = `${DB}_app`.slice(0, 32);
const withDb = (user: string, password: string) => {
  const u = new URL(base.href);
  u.username = user;
  u.password = password;
  u.pathname = `/${DB}`;
  return u.href;
};
// Owner: migrations (DDL). App: the running app and workers, DML only, like app_user on PostgreSQL.
export const OWNER_URL = withDb(decodeURIComponent(base.username), decodeURIComponent(base.password));
export const APP_URL = withDb(APP_USER, 'app-secret');
export const ADMIN_URL = base.href;
