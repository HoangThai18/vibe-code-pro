// Bản v1: danh sách đối tác cung cấp hàng (vendor). Chưa chuyển sang src/modules/.
export const vendors = [];

export function addVendor(name, phone) {
  if (vendors.some((v) => v.name === name)) throw new Error('Vendor exists');
  const v = { id: vendors.length + 1, name, phone };
  vendors.push(v);
  return v;
}

export function listVendors() {
  return vendors;
}
