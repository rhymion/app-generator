// AUTO-GENERATED - DO NOT EDIT
import { prisma, ALL_ENTITIES } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

export async function populateTipTxDependencies() {
  const testUser = await getTestUser();
  const commentCommentable = await prisma.commentable.create({ data: {} });
  const commentRecord = await prisma.comment.create({
    data: {
      commentable_id: commentCommentable.id,
      message: 'Test Message',
      creator_id: testUser.id,
    },
  });
  const comment = { ...commentRecord, name: (commentRecord.message ?? '') };
  return { comment };
}

export async function populateTipTxData(length: number) {
  const testUser = await getTestUser();
  const deps = await populateTipTxDependencies();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.tip_tx.create({
      data: {
        gross_amount: Math.max(0, i * 100),
        operator_fee: Math.max(0, i * 100),
        payment_fee: Math.max(0, i * 100),
        contract_split_id: `Test Contract Split Id ${i}`,
        status: 0,
        comment_id: deps.comment.id,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populateTipTxFullData = populateTipTxData;
