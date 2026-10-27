import { AppError } from '../shared/errors.js';
import { normalizePhone } from '../shared/phone.js';
import { customerRepository } from './customer.repository.js';

export const customerService = {
  create(tenantId, input) {
    const fullName = String(input.fullName ?? '').trim();
    const phone = normalizePhone(input.phone);
    if (!fullName || !phone) throw new AppError('validation_failed', 400, { fields: ['fullName', 'phone'] });
    if (customerRepository.findByPhone(tenantId, phone)) throw new AppError('customer_phone_taken', 409);
    return customerRepository.insert(tenantId, { fullName, phone });
  },
  update(tenantId, id, input) {
    const changes = {};
    if (input.fullName !== undefined) changes.fullName = String(input.fullName).trim();
    if (input.phone !== undefined) {
      changes.phone = normalizePhone(input.phone);
      if (!changes.phone) throw new AppError('validation_failed', 400, { fields: ['phone'] });
    }
    const row = customerRepository.update(tenantId, id, changes);
    if (!row) throw new AppError('not_found', 404);
    return row;
  },
};
