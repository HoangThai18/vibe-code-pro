import { AppError } from '../shared/errors.js';
import { normalizePhone } from '../shared/phone.js';
import { customerRepository } from './customer.repository.js';

export const customerService = {
  create(tenantId, input) {
    const fullName = String(input.fullName ?? '').trim();
    const phone = normalizePhone(input.phone);
    if (!fullName || !phone) throw new AppError('validation_failed', 400, { fields: ['fullName', 'phone'] });
    return customerRepository.insert(tenantId, { fullName, phone });
  },
};
