// Test-only route, copied into the disposable build copy by the gate script and never generated.
// Calls the comment Server Actions of cr_ticket directly as the authenticated caller, WITHOUT the
// permission and organization pre-gates the generated REST routes run first, so a spec can show
// that the Server Actions enforce those checks on their own (a Server Action is callable without
// the UI or the REST routes).
//   POST /api/cr_ticket/{id}/action_probe
//   Body: { op: 'add' | 'update' | 'delete', commentId?: string, message?: string }
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, withActor } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/_errors';
import { addCrTicketComment, updateCrTicketComment, deleteCrTicketComment } from '@/lib/cr_ticket/actions';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId: actorId } = await authenticate(request);
  const { op, commentId, message } = (await request.json()) as { op: string; commentId?: string; message?: string };
  try {
    const result = await withActor(actorId, async () => {
      if (op === 'add') {
        const ticket = await prisma.cr_ticket.findUnique({ where: { id }, select: { commentable_id: true } });
        return addCrTicketComment(ticket!.commentable_id!, message ?? 'probe');
      }
      if (op === 'update') return updateCrTicketComment(commentId!, message ?? 'probe');
      return deleteCrTicketComment(commentId!);
    });
    return NextResponse.json({ ok: true, result: result ?? null });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ ok: false, code: error.code }, { status: error.code === 'NOT_FOUND' ? 404 : 403 });
    }
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
