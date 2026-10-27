// api-conventions.md section 7: the zod schema and the OpenAPI file describe the same customer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CreateCustomerInput, Customer, ListCustomersQuery } from '../src/contracts/customers';

const openapi = parse(readFileSync('src/contracts/openapi.yaml', 'utf8'));

describe('customer contract', () => {
  it('zod and OpenAPI list the same fields', () => {
    const schema = openapi.components.schemas.Customer;
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(Customer.shape).sort());
    expect([...schema.required].sort()).toEqual(Object.keys(Customer.shape).sort());
  });

  it('accepts a canonical customer and rejects bad phones and dates', () => {
    const ok = { id: '0b6a7c4e-3f0e-4d43-9a2f-5c1e1f0d9b11', fullName: 'Đặng Thị Ánh', phone: '0912345678',
      email: null, birthday: '1990-04-01', createdAt: '2026-10-24T08:30:00Z' };
    expect(Customer.parse(ok)).toEqual(ok);
    expect(Customer.safeParse({ ...ok, phone: '+84912345678' }).success).toBe(false);
    expect(Customer.safeParse({ ...ok, birthday: '01/04/1990' }).success).toBe(false);
    expect(CreateCustomerInput.parse({ fullName: 'Lan', phone: '0912345678' })).toEqual({ fullName: 'Lan', phone: '0912345678' });
    expect(ListCustomersQuery.parse({ limit: '50' })).toEqual({ limit: 50 });
    expect(ListCustomersQuery.safeParse({ limit: '500' }).success).toBe(false);
  });
});
