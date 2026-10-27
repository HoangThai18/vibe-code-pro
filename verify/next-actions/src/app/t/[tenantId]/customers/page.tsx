// src/app/t/[tenantId]/customers/page.tsx
import { notFound } from 'next/navigation';
import { checkAccess } from '@/lib/access';
import { renameCustomer } from './actions';
import { listCustomers } from './data';
import { RenameForm } from './rename-form';

export default async function CustomersPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await checkAccess(tenantId, 'customer.read');   // per request, before any cached read
  if (!access.ok) notFound();
  const { customers, loadedAt } = await listCustomers(tenantId);
  return (
    <main data-loaded-at={loadedAt}>
      <ul>
        {customers.map((c) => (
          <li key={c.id}>
            {c.full_name} <RenameForm action={renameCustomer.bind(null, tenantId)} customerId={c.id} />
          </li>
        ))}
      </ul>
    </main>
  );
}
