import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getModelPermissions, type ModelPermissions, type Operation } from '@/lib/authz';

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

  const user = await prisma.user_account.findFirst({
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
): Promise<ModelPermissions> {
  const permissions = await getModelPermissions(model, userId);
  if (!permissions[operation]) {
    throw new ApiError(403, `Access denied: ${model}.${operation}`);
  }
  return permissions;
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  console.error('API error:', error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
