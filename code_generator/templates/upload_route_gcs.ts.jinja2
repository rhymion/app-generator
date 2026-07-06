import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@google-cloud/storage';
import { auth } from '@/auth';

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME!;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'application/zip',
    ];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type.' }, { status: 400 });
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 });
    }

    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const uniqueDir = `${timestamp}-${randomString}`;
    const originalFilename = file.name;
    const gcsPath = `${uniqueDir}/${originalFilename}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const bucket = storage.bucket(bucketName);
    const gcsFile = bucket.file(gcsPath);
    // UBLA: save without ACL; object remains private
    await gcsFile.save(buffer, {
      metadata: { contentType: file.type },
    });

    // Return internal proxy URL; /api/gcs route generates a fresh V4 signed URL per request
    const url = `/api/gcs/${gcsPath}`;

    return NextResponse.json({ url }, { status: 200 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
