'use client';
// Test UI: the page must use the action, or the build drops it
import { useState, useTransition } from 'react';

export function RenameForm({ action, customerId }: { action: (input: unknown) => Promise<{ ok: boolean }>; customerId: string }) {
  const [name, setName] = useState('');
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); start(async () => { await action({ customerId, fullName: name }); }); }}>
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Tên mới" />
      <button disabled={pending}>Đổi tên</button>
    </form>
  );
}
