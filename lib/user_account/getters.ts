'use server';

import prisma from '@/lib/prisma';
import type { UserAccount, UserAccountDetail } from '@/lib/user_account/types';

export async function getAllUserAccounts(): Promise<UserAccount[]> {
  const userAccounts = await prisma.user_account.findMany();
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
  const userAccount = await prisma.user_account.findUnique({
    where: { id },
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
