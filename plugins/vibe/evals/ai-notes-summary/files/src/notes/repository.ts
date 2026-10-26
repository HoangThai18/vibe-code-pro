export interface CustomerNote {
  id: string;
  createdAt: string;
  author: string;
  text: string;   // nhân viên tự nhập, có thể chứa bất cứ thứ gì
}

export interface NotesRepository {
  // Chỉ trả ghi chú của customer thuộc đúng tenant; customer của tenant khác trả []
  listRecent(tenantId: string, customerId: string, limit: number): Promise<CustomerNote[]>;
}
