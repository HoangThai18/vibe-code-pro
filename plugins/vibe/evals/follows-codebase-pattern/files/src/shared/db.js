// DB giả lập trong bộ nhớ: mỗi bảng là một Map. Chỉ repository được dùng module này.
const tables = new Map();
export function table(name) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
}
export function resetDb() {
  tables.clear();
}
