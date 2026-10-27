import { AppError } from '../../shared/errors.js';
import { customerRepository } from './customer.repository.js';

function normalizePhone(input) {
  let digits = String(input ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);
  return /^0[35789]\d{8}$/.test(digits) ? digits : null;
}

export const customerService = {
  create(input) {
    const fullName = String(input.fullName ?? '').trim();
    const phone = normalizePhone(input.phone);
    if (!fullName || !phone) throw new AppError('validation_failed', 400);
    if (customerRepository.findByPhone(phone)) throw new AppError('customer_phone_taken', 409);
    return customerRepository.insert({ fullName, phone });
  },
  list() {
    return customerRepository.list();
  },
};
