// Xem trước link: nhân viên dán URL vào ghi chú, server lấy tiêu đề trang để hiển thị
export async function getLinkPreview(url: string): Promise<{ url: string; title: string | null }> {
  const res = await fetch(url);
  const html = await res.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  return { url, title };
}
