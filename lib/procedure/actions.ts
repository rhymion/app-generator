'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function upsertProcedure(data: FormData) {
  const id = data.get('id') as string | null;
  if (id) {
    await requirePermission('procedure', 'update');
  } else {
    await requirePermission('procedure', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const precededByRaw = data.getAll('preceded_by[]') as string[];
  const precededByItems = precededByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const precededByIds = precededByItems
    .map((precededBy) => precededBy.id)
    .filter((precededById): precededById is string => Boolean(precededById));
  const followedByRaw = data.getAll('followed_by[]') as string[];
  const followedByItems = followedByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const followedByIds = followedByItems
    .map((followedBy) => followedBy.id)
    .filter((followedById): followedById is string => Boolean(followedById));

  if (id) {
    await updateProcedure(id, name, description, precededByIds, followedByIds);
  } else {
    await addProcedure(name, description, precededByIds, followedByIds);
  }

  revalidatePath('/');
  redirect('/procedure');
}

async function addProcedure(name: string, description: string | null, precededByIds: string[], followedByIds: string[]) {
  await prisma.procedure.create({
    data: {
      name: name,
      description: description,
      preceded_by: {
        connect: precededByIds.map((id) => ({ id })),
      },
      followed_by: {
        connect: followedByIds.map((id) => ({ id })),
      },
    },
  });
}

async function updateProcedure(id: string, name: string, description: string | null, precededByIds: string[], followedByIds: string[]) {
  await prisma.procedure.update({
    where: { id },
    data: {
      name: name,
      description: description,
      preceded_by: {
        set: precededByIds.map((id) => ({ id })),
      },
      followed_by: {
        set: followedByIds.map((id) => ({ id })),
      },
    },
  });
}

export async function removeProcedure(data: FormData | string[]) {
  await requirePermission('procedure', 'delete');

  if (Array.isArray(data)) {
    await prisma.procedure.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.procedure.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/procedure');
}
