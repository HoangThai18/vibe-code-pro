// In-memory tables for the example; only repositories use this module.
const tables = new Map();
export function table(name) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
}
export function resetDb() {
  tables.clear();
}
