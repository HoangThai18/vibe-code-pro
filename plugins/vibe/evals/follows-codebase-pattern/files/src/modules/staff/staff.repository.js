import { randomUUID } from 'node:crypto';
import { table } from '../../shared/db.js';

const staff = () => table('staff');

export const staffRepository = {
  insert({ name, phone }) {
    const row = { id: randomUUID(), name, phone, createdAt: new Date().toISOString() };
    staff().set(row.id, row);
    return row;
  },
  findByPhone(phone) {
    return [...staff().values()].find((s) => s.phone === phone) ?? null;
  },
};
