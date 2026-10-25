import { randomUUID } from 'node:crypto';
import { table } from '../../shared/db.js';

const customers = () => table('customers');

export const customerRepository = {
  insert({ email, name }) {
    const row = { id: randomUUID(), email, name, createdAt: new Date().toISOString() };
    customers().set(row.id, row);
    return row;
  },
  findByEmail(email) {
    return [...customers().values()].find((c) => c.email === email) ?? null;
  },
  list() {
    return [...customers().values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
};
