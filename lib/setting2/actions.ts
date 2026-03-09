'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting2 } from './service';
export async function upsertSetting2(data: FormData) {
  await requirePermission('setting2', 'create');
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;

  const userId = await getSessionUserIdOrThrow();
  await addSetting2(userId, name, description);

  revalidatePath('/');
  redirect('/setting2');
}

