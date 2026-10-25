import { AppError } from '../../shared/errors.js';
import { normalizePhone } from '../../shared/phone.js';
import { staffRepository } from './staff.repository.js';

export const staffService = {
  create(input) {
    const name = String(input.name ?? '').trim();
    const phone = normalizePhone(input.phone);
    if (!name || !phone) throw new AppError('validation_failed', 400, { fields: ['name', 'phone'] });
    if (staffRepository.findByPhone(phone)) throw new AppError('staff_phone_taken', 409);
    return staffRepository.insert({ name, phone });
  },
};
