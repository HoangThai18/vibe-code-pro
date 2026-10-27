// src/i18n/time-zones.ts — options for the tenant time zone picker, from the database that stores the value
import type { Pool, PoolClient } from 'pg';

// Same pattern as the tenants.time_zone CHECK: Area/City only. Drops Etc/GMT+7 (= UTC-7), UTC, EST5EDT, posixrules
export const ZONE_NAME = '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z0-9_/+-]+$';

export async function listTimeZones(db: Pool | PoolClient): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    'SELECT name FROM pg_timezone_names WHERE name ~ $1 ORDER BY name', [ZONE_NAME]);
  return rows.map((r) => r.name);
}

// ICU (Node 22, Chromium 153) reports these old names, e.g. Intl...resolvedOptions().timeZone === 'Asia/Saigon';
// PostgreSQL with system tzdata knows only the current ones. Every Intl.supportedValuesOf('timeZone') entry
// missing from pg_timezone_names on Ubuntu 24.04 is listed (tested).
const ICU_TO_IANA: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca', 'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk', 'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy', 'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza', 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv', 'Pacific/Enderbury': 'Pacific/Kanton', 'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

// Preselect the browser's zone in the picker; null when the list doesn't have it (the user picks)
export function suggestTimeZone(browserZone: string, options: readonly string[]): string | null {
  const name = ICU_TO_IANA[browserZone] ?? browserZone;
  return options.includes(name) ? name : null;
}
