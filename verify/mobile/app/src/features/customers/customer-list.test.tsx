// src/features/customers/customer-list.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { CustomerList } from './customer-list';
import { customersApi } from '../../api/client';

jest.mock('../../api/client', () => ({ customersApi: { list: jest.fn() } }));

function renderWithQuery(ui: React.ReactElement) {
  // gcTime: Infinity so Query sets no 5-minute cache cleanup timer; otherwise Jest does not exit after the tests
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

test('shows customers of the right workspace', async () => {
  jest.mocked(customersApi.list).mockResolvedValue({ data: [{ id: 'c1', fullName: 'Nguyễn Thị Lan' }] });
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Nguyễn Thị Lan')).toBeOnTheScreen();
  expect(customersApi.list).toHaveBeenCalledWith('spa-a');
});

test('API error shows a message and a retry button', async () => {
  jest.mocked(customersApi.list).mockRejectedValue(new Error('boom'));
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Không tải được danh sách.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
});
