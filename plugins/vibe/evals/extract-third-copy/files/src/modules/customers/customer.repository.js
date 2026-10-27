import { randomUUID } from 'node:crypto';
import { table } from '../../shared/db.js';

const rows = () => table('customers');

export const customerRepository = {
  insert(data) {
    const row = { id: randomUUID(), ...data, createdAt: new Date().toISOString() };
    rows().set(row.id, row);
    return row;
  },
  findByPhone(phone) {
    return [...rows().values()].find((r) => r.phone === phone) ?? null;
  },
  list() {
    return [...rows().values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
};
