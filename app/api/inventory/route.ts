import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllInventorys } from '@/lib/inventory/getters';
import { addInventory } from '@/lib/inventory/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'inventory', 'read');
    const items = await getAllInventorys();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'inventory', 'create');
    const body = await request.json();
    const { product_id: productId, quantity, reserved_quantity: reservedQuantity, location, lot_number: lotNumber, expiration_date: expirationDate } = body;
    const result = await addInventory(userId, productId, quantity, reservedQuantity, location ?? null, lotNumber ?? null, expirationDate ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
