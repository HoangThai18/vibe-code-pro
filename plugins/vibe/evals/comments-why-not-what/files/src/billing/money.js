// VND has no minor unit: amounts are integers in đồng everywhere.
export function assertVnd(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`invalid VND amount: ${amount}`);
  return amount;
}

export function roundVnd(value) {
  return Math.round(value);
}
