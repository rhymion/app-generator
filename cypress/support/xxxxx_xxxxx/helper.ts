import { prisma } from '../db-helpers'

export async function populateXxxxxXxxxxData(length: number) {
  // Create sample Xxxxx Xxxxx records
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.xxxxx_xxxxx.create({
      data: {
        name: `Xxxxx Xxxxx ${i}`,
        description: `Description for Xxxxx Xxxxx ${i}`,
      },
    });
    records.push(record);
  }
  return records;
}

export async function populateYyyyyYyyyyData(xxxxxXxxxxId: string, length: number) {
  // Create sample Yyyyy Yyyyy records linked to given Xxxxx Xxxxx ID
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.yyyyy_yyyyy.create({
      data: {
        xxxxx_xxxxx_id: xxxxxXxxxxId,
        name: `Yyyyy Yyyyy ${i}`,
        type: 'string',
        max_length: 255,
        max: 65535,
        regex: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
        required: i % 2 === 0,
        written_by: 'Seeder Script',
      },
    });
    records.push(record);
  }
  return records;
}

