// src/features/customers/customer-list.tsx
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { customersApi } from '../../api/client';

export function CustomerList({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: ['tenant', tenantId, 'customers'], queryFn: () => customersApi.list(tenantId) });
  if (q.isPending) return <ActivityIndicator accessibilityLabel="Đang tải" />;
  if (q.isError) {
    return (
      <View>
        <Text>Không tải được danh sách.</Text>
        <Pressable accessibilityRole="button" onPress={() => q.refetch()}>
          <Text>Thử lại</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      data={q.data.data}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <Text>{item.name}</Text>}
      ListEmptyComponent={<Text>Chưa có khách nào.</Text>}
    />
  );
}
