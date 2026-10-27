// packages/contracts/src/customers.ts
import { z } from 'zod';

export const Customer = z.object({
  id: z.uuid(),
  fullName: z.string().min(1).max(200),
  phone: z.string().regex(/^0\d{9,10}$/),   // stored as 0912345678
  email: z.email().nullable(),
  birthday: z.iso.date().nullable(),        // 'YYYY-MM-DD', a calendar date
  createdAt: z.iso.datetime(),
});
export type Customer = z.infer<typeof Customer>;

// Create input: email/birthday not required. Note .nullable() does NOT make a field optional,
// so add .optional() to let clients omit the field.
export const CreateCustomerInput = z.object({
  fullName: Customer.shape.fullName,
  phone: Customer.shape.phone,
  email: Customer.shape.email.optional(),
  birthday: Customer.shape.birthday.optional(),
});
export const UpdateCustomerInput = CreateCustomerInput.partial();

export const ListCustomersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const ListCustomersResponse = z.object({
  data: z.array(Customer),
  nextCursor: z.string().nullable(),
});
