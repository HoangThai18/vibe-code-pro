// In-memory store: one Map per tenant and table. Only repositories use it.
const tenants = new Map();
export function table(tenantId, name) {
  if (!tenants.has(tenantId)) tenants.set(tenantId, new Map());
  const tables = tenants.get(tenantId);
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
}
export function resetStore() {
  tenants.clear();
}
