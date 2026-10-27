import { randomUUID } from 'node:crypto';
import { table } from '../shared/store.js';

const customers = (tenantId) => table(tenantId, 'customers');

export const customerRepository = {
  insert(tenantId, { fullName, phone }) {
    const row = { id: randomUUID(), fullName, phone, createdAt: new Date().toISOString() };
    customers(tenantId).set(row.id, row);
    return row;
  },
  findById(tenantId, id) {
    return customers(tenantId).get(id) ?? null;
  },
  findByPhone(tenantId, phone) {
    return [...customers(tenantId).values()].find((c) => c.phone === phone) ?? null;
  },
  update(tenantId, id, changes) {
    const row = customers(tenantId).get(id);
    if (!row) return null;
    Object.assign(row, changes);
    return row;
  },
};
