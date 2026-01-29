'use server';

import prisma from '@/lib/prisma';
import type { Parent1, Parent1Detail } from '@/lib/parent1/types';

export async function getAllParent1s(): Promise<Parent1[]> {
  const parent1s = await prisma.parent1.findMany();
  return parent1s.map((parent1) => ({
    id: parent1.id,
    name: parent1.name,
    description: parent1.description,
    price: parent1.price,
    due_date: parent1.due_date,
    image_url: parent1.image_url,
  }));
}

export async function getParent1Detail(id: string): Promise<Parent1Detail | null> {
  const parent1 = await prisma.parent1.findUnique({
    where: { id },
    include: { parent1_child1s: true, parent1_child2s: true, parent1_list: true },
  });

  if (!parent1) {
    return null;
  }

  return {
    id: parent1.id,
    name: parent1.name,
    description: parent1.description,
    price: parent1.price,
    due_date: parent1.due_date,
    image_url: parent1.image_url,
    parent1_child1s: parent1.parent1_child1s.map((item) => ({
      id: item.id,
      order: item.order,
      name: item.name,
      type: item.type,
      parent1_id: item.parent1_id,
      max_length: item.max_length,
      max: item.max,
      regex: item.regex,
      required: item.required,
      written_by: item.written_by,
    })),
    parent1_child2s: parent1.parent1_child2s.map((item) => ({
      id: item.id,
      name: item.name,
      required: item.required,
      start_date: item.start_date,
      end_date: item.end_date,
    })),
    parent1_list: parent1.parent1_list.map((item) => ({
      id: item.id,
      name: item.name,
    })),
  };
}
