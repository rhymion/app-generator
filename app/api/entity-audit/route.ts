import { NextResponse } from 'next/server';
import { getModelPermissions } from '@/lib/authz';

export async function GET() {
  const { permissions } = await getModelPermissions('audit_log');
  if (!permissions.general.read) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ isAdmin: true });
}
