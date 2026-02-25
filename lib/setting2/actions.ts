'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addSetting2 } from './service';

export async function upsertSetting2(data: FormData) {
  await requirePermission('setting2', 'create');
  const name = data.get('name') as string;
  const email = data.get('email') as string;
  const password = data.get('password') as string;

  const userId = await getSessionUserIdOrThrow();
  await addSetting2(userId, name, email, password);

  revalidatePath('/');
  redirect('/setting2');
}
