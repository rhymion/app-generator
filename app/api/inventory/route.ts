import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllInventorys } from '@/lib/inventory/getters';
import { addInventory } from '@/lib/inventory/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'inventory', 'read');
    const items = await getAllInventorys();
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
    await requireApiPermission(userId, 'inventory', 'create');
    const body = await request.json();
    const { product_id: productId, quantity, reserved_quantity: reservedQuantity, location, lot_number: lotNumber, expiration_date: expirationDate } = body;
    const result = await addInventory(userId, productId, quantity, reservedQuantity, location ?? null, lotNumber ?? null, expirationDate ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
