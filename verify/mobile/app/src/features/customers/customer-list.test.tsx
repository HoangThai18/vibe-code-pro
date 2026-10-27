// src/features/customers/customer-list.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { CustomerList } from './customer-list';
import { customersApi } from '../../api/client';

jest.mock('../../api/client', () => ({ customersApi: { list: jest.fn() } }));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

test('hiện danh sách khách của đúng workspace', async () => {
  jest.mocked(customersApi.list).mockResolvedValue({ data: [{ id: 'c1', name: 'Nguyễn Thị Lan' }] });
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Nguyễn Thị Lan')).toBeOnTheScreen();
  expect(customersApi.list).toHaveBeenCalledWith('spa-a');
});

test('API lỗi thì hiện thông báo và nút thử lại', async () => {
  jest.mocked(customersApi.list).mockRejectedValue(new Error('boom'));
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Không tải được danh sách.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
});
