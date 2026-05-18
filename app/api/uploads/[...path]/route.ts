// Dynamic file server for runtime-uploaded attachments.
//
// `public/` is only crawled by `next start` at *build* time — files
// written to `public/uploads/` after the build complete return 404,
// even though the disk path exists (verified: build at 20:45, file
// uploaded at 20:48 → curl 404 against `next start`, 200 against
// `next dev` which reads at request time). The upload-and-attach flow
// in components/_standard/AttachmentSection therefore can't rely on
// the public-asset handler.
//
// This route reads the upload at request time and streams it back, so
// `next start` behaves the same as `next dev`. A `rewrites` entry in
// next.config.ts maps `/uploads/:path*` → `/api/uploads/:path*` so
// already-stored paths in `attachment.path` (and the URLs returned by
// `/api/upload`) keep working.

import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

// All uploads live under <cwd>/public/uploads. Resolving once keeps the
// path-traversal guard below simple.
const UPLOAD_ROOT = path.resolve(process.cwd(), 'public', 'uploads');

// Content-Type by extension. Only the types the upload endpoint
// accepts need entries — anything else falls back to
// `application/octet-stream` which the browser handles as a download.
const MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.pdf':  'application/pdf',
  '.txt':  'text/plain; charset=utf-8',
  '.csv':  'text/csv; charset=utf-8',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip':  'application/zip',
};

type Params = { params: Promise<{ path: string[] }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  // Resolve the candidate path and then re-check it stays under
  // UPLOAD_ROOT. `path.resolve` collapses any `..` segments, so a
  // request like /api/uploads/../../etc/passwd resolves to a path
  // outside UPLOAD_ROOT and we reject it with 403 rather than 404 to
  // distinguish "you tried to escape" from "file doesn't exist".
  const candidate = path.resolve(UPLOAD_ROOT, ...segments);
  if (candidate !== UPLOAD_ROOT && !candidate.startsWith(UPLOAD_ROOT + path.sep)) {
    return new NextResponse(null, { status: 403 });
  }

  try {
    const stats = await stat(candidate);
    if (!stats.isFile()) return new NextResponse(null, { status: 404 });

    const ext = path.extname(candidate).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';

    // Stream the file so large attachments don't materialise the whole
    // buffer in memory before sending.
    const nodeStream = createReadStream(candidate);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type':   contentType,
        'Content-Length': String(stats.size),
        // Matches the cache headers Next's public-asset handler emits
        // so the rewrite path doesn't accidentally cache longer than
        // the static path would have.
        'Cache-Control':  'private, max-age=0, must-revalidate',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
