// test/helpers/tenants.ts (example: vitest + supertest; adapt to the project stack)
import { createCustomer, createTenantWithUser } from './factories';

export async function seedTwoTenants() {
  const a = await createTenantWithUser('tenant-a');   // { tenantId, userId, token }
  const b = await createTenantWithUser('tenant-b');
  const aCustomer = await createCustomer(a, { fullName: 'Khách của A', phone: '0912345678' });
  const bCustomer = await createCustomer(b, { fullName: 'Khách của B', phone: '0987654321' });
  return { a, b, aCustomer, bCustomer };
}
