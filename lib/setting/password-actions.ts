'use server';

import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUserIdOrThrow } from '@/lib/authz';

export async function verifyAndHashPassword(currentPassword: string, newPassword: string): Promise<string> {
  const userId = await getSessionUserIdOrThrow();
  const user = await prisma.user_account.findUnique({ where: { id: userId }, select: { password: true } });
  if (!user) throw new Error('User not found');

  const isCorrect = await bcrypt.compare(currentPassword, user.password);
  if (!isCorrect) throw new Error('Current password is incorrect');

  return bcrypt.hash(newPassword, 10);
}
