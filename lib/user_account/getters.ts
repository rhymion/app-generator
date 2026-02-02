'use server';

import prisma from '@/lib/prisma';
import type { UserAccount, UserAccountDetail } from '@/lib/user_account/types';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function getAllUserAccounts(): Promise<UserAccount[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const userAccounts = await prisma.user_account.findMany({
  });
  return userAccounts.map((userAccount) => ({
    id: userAccount.id,
    name: userAccount.name,
    email: userAccount.email,
    password: userAccount.password,
    api_key: userAccount.api_key,
    avatar: userAccount.avatar,
  }));
}

export async function getUserAccountDetail(id: string): Promise<UserAccountDetail | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const userAccount = await prisma.user_account.findUnique({
    where: { 
      id,
    },
    include: { 
      roles: true 
    },
  });

  if (!userAccount) {
    return null;
  }

  return {
    ...userAccount,
    roles: userAccount.roles,
  };
}
