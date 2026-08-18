// Fixture-only stand-in for @/lib/api-auth -- see lib/authz.ts in this same
// directory for why (see the mention-gate check).
import { NextRequest, NextResponse } from 'next/server';
import type { RichPermissions, Operation, ItemContext } from '@/lib/authz';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function authenticateApiKey(_request: NextRequest): Promise<{ userId: string }> {
  throw new Error('fixture stub');
}

export async function requireApiPermission(
  _userId: string,
  _model: string,
  _operation: Operation,
  _item?: ItemContext,
): Promise<RichPermissions> {
  throw new Error('fixture stub');
}

export function handleApiError(_error: unknown): NextResponse {
  throw new Error('fixture stub');
}
