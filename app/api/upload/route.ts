import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File size exceeds 5MB limit' }, { status: 400 });
    }

    // Generate unique directory path while preserving original filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const uniqueDir = `${timestamp}-${randomString}`;
    const originalFilename = file.name;

    let url: string;

    // Use Vercel Blob Storage if BLOB_READ_WRITE_TOKEN is set (production)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blobPath = `${uniqueDir}/${originalFilename}`;
      const blob = await put(blobPath, file, {
        access: 'public',
        addRandomSuffix: false,
      });
      url = blob.url;
    } else {
      // Fallback to local filesystem (development)
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Create unique directory under uploads
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads', uniqueDir);
      try {
        await mkdir(uploadsDir, { recursive: true });
      } catch (err) {
        // Directory might already exist, ignore error
      }

      // Save file with original filename
      const filepath = path.join(uploadsDir, originalFilename);
      await writeFile(filepath, buffer);

      // Return the public URL
      url = `/uploads/${uniqueDir}/${originalFilename}`;
    }

    return NextResponse.json({ url }, { status: 200 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
