import { AppError } from '../../shared/errors.js';
import { customerRepository } from './customer.repository.js';

export const customerService = {
  create(input) {
    const email = String(input.email ?? '').trim().toLowerCase();
    const name = String(input.name ?? '').trim();
    if (!email || !name) throw new AppError('validation_failed', 400, { fields: ['email', 'name'] });
    if (customerRepository.findByEmail(email)) throw new AppError('customer_email_taken', 409);
    return customerRepository.insert({ email, name });
  },
  list() {
    return customerRepository.list();
  },
};
