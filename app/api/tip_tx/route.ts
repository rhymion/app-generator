import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getTipTxPage } from '@/lib/tip_tx/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addTipTx } from '@/lib/tip_tx/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'tip_tx', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getTipTxPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'tip_tx', 'create');
    const body = await request.json();
    const { gross_amount: grossAmount, operator_fee: operatorFee, payment_fee: paymentFee, contract_split_id: contractSplitId, status, comment_id: commentId } = body;
    const result = await addTipTx(actorId, grossAmount, operatorFee, paymentFee, contractSplitId, status, commentId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
