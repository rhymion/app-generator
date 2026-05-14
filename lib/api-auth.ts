import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePermission, type RichPermissions, type Operation, type ItemContext } from '@/lib/authz';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function authenticateApiKey(request: NextRequest): Promise<{ userId: string }> {
  const apiKey =
    request.headers.get('X-API-Key') ||
    request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    throw new ApiError(401, 'Missing API key. Provide X-API-Key header or Authorization: Bearer <key>.');
  }

  const user = await prisma.user.findFirst({
    where: { api_key: apiKey },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError(401, 'Invalid API key.');
  }

  return { userId: user.id };
}

export async function requireApiPermission(
  userId: string,
  model: string,
  operation: Operation,
  item?: ItemContext,
): Promise<RichPermissions> {
  try {
    return await requirePermission(model, operation, item, userId);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, (e as Error).message);
  }
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  console.error('API error:', error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
