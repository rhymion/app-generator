import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllPurchaseOrders } from '@/lib/purchase_order/getters';
import { addPurchaseOrder } from '@/lib/purchase_order/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'purchase_order', 'read');
    const items = await getAllPurchaseOrders();
    return NextResponse.json(items);
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
