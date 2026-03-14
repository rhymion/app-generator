import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllPurchaseOrders } from '@/lib/purchase_order/getters';
import { addPurchaseOrder } from '@/lib/purchase_order/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'purchase_order', 'read');
    const items = await getAllPurchaseOrders();
    // Filter to items the user can read (mirrors UI list page logic).
    const filtered = richPerms.general.read
      ? items
      : items.filter(item =>
          (richPerms.creator?.read && item.creator_id === userId) ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (richPerms.assignee?.read && (item as any).assignee_id === userId)
        );
    return NextResponse.json(filtered);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'purchase_order', 'create');
    const body = await request.json();
    const { order_no: orderNo, customer_id: customerId, items } = body;
    const result = await addPurchaseOrder(userId, orderNo, customerId, items ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
