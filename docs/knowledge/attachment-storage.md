# Attachment storage and delivery

Every file a user uploads (an `attachable` bridge attachment, a direct-attachment field such as `user.image`) is
stored under an opaque key and delivered only through one authorized route. This page describes how that works,
what the schema must contain, how an application that already holds attachments adopts it, and how to run the
orphan cleanup.

## How it works

| Step | Route / code | Result |
|------|--------------|--------|
| Store a file | `POST /api/upload` (multipart, field `file`) | `200 { id, name }`: the id of the `attachment` record that was created, and the file name for display |
| Attach it to a record | `PUT /api/<entity>/<id>/attachments` (bridge) or the entity's own create / update (direct field) | The record references the attachment by id |
| Read it | `GET /api/attachments/<id>` | The file, or `401` / `403` / `404` |

- **Opaque keys.** The object is stored under `crypto.randomUUID()`: no extension, no original file name, no
  timestamp. The original name is kept only in `attachment.encrypted_original_name` (AES-256-GCM, see
  `lib/compliance/attachment_name_crypto.ts`) and is decrypted for the `Content-Disposition` header and for
  display. `attachment.path` holds the storage key; REST responses carry `path: "/api/attachments/<id>"`
  instead, so a storage key never leaves the server.
- **Private storage.** Google Cloud Storage objects are saved without an ACL (uniform bucket-level access).
  Vercel Blob objects use `access: 'private'`. The local-disk backend (no bucket and no Blob credential) writes under
  `.uploads/` at the project root, or under `ATTACHMENT_LOCAL_DIR`; it is never under `public/`, so no file is a
  static asset. The backend is chosen from the environment by `lib/attachment/storage.ts`: `GCS_BUCKET_NAME`, then
  `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` (Vercel Blob; the SDK uses the short-lived Vercel OIDC token when
  `BLOB_STORE_ID` is set and the read-write token otherwise), then local disk.
- **No silent local-disk fallback on ephemeral platforms.** Local disk is not shared between instances and is lost on
  restart or scale-down. When `K_SERVICE` (Cloud Run) or `VERCEL` is set, `NODE_ENV` is not `development`, and neither a
  bucket, a Blob credential nor `ATTACHMENT_LOCAL_DIR` is configured, `storageBackend()` throws with a message naming the
  variables to set. `ATTACHMENT_LOCAL_DIR` set explicitly (for example to a mounted persistent volume) opts in to local disk.
- **The GCP scripts match the storage code.** `scripts/gcp-deploy.sh` maps the `app-gcs-bucket-name` secret to
  `GCS_BUCKET_NAME`, the variable the storage code reads. `scripts/gcp-setup.sh` creates the bucket with uniform
  bucket-level access and Public Access Prevention, grants the Cloud Run service account `roles/storage.objectUser` on it
  (save, exists, signed URL and delete are all the application does), and, for a bucket that already exists, warns when
  uniform bucket-level access or Public Access Prevention is off. It does not change an existing bucket or remove a
  broader role granted earlier; revoke `roles/storage.objectAdmin` on an existing bucket by hand.
- **Uploads are provenance-tracked.** `POST /api/upload` creates the `attachment` record immediately, not yet
  referenced by any record, and records `uploader_id` and `uploader_organization_id`.
- **The upload is attached by id, never by path.** `setAttachmentsForBridge` and the direct-attachment write path
  take attachment ids. An id is accepted when it is already one of the record's own attachments, or when it is an
  upload that has no owner yet and was made by the caller. Any other id (another record's or organization's
  attachment, another user's upload) is answered as "not found" and nothing is written. The request body no
  longer carries a `path`.

### Who can read a file

`GET /api/attachments/<id>` accepts the browser session, a mobile access token or an API key.

| Attachment state | Decision |
|------------------|----------|
| Owned by a record (bridge or direct field) | The record's own read check: read permission on the owner model, the owner's organization scope (a record of another organization is `404`), Creator / Assignee item-level resolution. No read permission is `403`. |
| Not owned by any record yet | Only the user who uploaded it; anyone else gets `404` |
| Unknown id | `404` |
| No credential | `401` |

An owner that is read-restricted therefore restricts its attachments, including a user's `image`: a reader needs
read permission on the `user` model to see another user's avatar.

### Delivery per backend

| Backend | Delivery |
|---------|----------|
| Google Cloud Storage | The route authorizes first, then redirects (`302`) to a V4 signed URL valid for five minutes. The signed URL carries `response-content-type` and `response-content-disposition` (`responseDisposition` in `getSignedUrl`), so the browser receives the decrypted original name. |
| Vercel Blob | The route authorizes first, then streams the object through the function (`get(key, { access: 'private' })`). A presigned Blob URL honors only `validUntil` and `useCache`; it cannot set the response `Content-Disposition`, so the decrypted name could not be delivered by redirect. |
| Local disk | The route streams the file. |

Responses carry `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. Images are served
`inline`; every other type is `attachment`. The content type is derived from the extension of the decrypted name
(`UPLOAD_CONTENT_TYPE_BY_EXTENSION` in `lib/_upload_validation.ts`).

## Schema prerequisites

`prisma/schema.prisma`'s `attachment` model needs the two provenance columns (`generate-code` fails with the lines
to add when they are missing):

```prisma
model attachment {
  // ...existing columns...
  uploader_id              String?
  uploader                 user?   @relation("AttachmentUploader", fields: [uploader_id], references: [id], onDelete: SetNull)
  uploader_organization_id String?
  @@index([uploader_id])
}

model user {
  // ...existing columns...
  uploaded_attachments attachment[] @relation("AttachmentUploader")
}
```

No `x-*` schema key is involved. As with every generated or built-in model, the migration is written when the
application is deployed.

## URL columns versus file fields

A `format: uri` column, whatever its `x-uri-kind` (`image`, the default; `link`; or `file`), is a paste-a-URL field: the form shows a URL text input and the stored value is the URL the user typed or pasted. A column that still declares `x-uri-kind: file` renders the same way, with a download link on the view page. A file that needs uploading is stored through a direct-attachment field (`x-relationship: { target: attachment, type: direct }`), which references an attachment row.

## Scheduled cleanup of uploads that were never attached

A form that is abandoned after an upload leaves an attachment record and a stored object that no record
references. `attachment_orphan_cleanup` is a reserved `x-scheduled-tasks` task id; declare it and the generated
handler deletes every unreferenced attachment (record and stored object) older than 24 hours:

```yaml
x-scheduled-tasks:
  - task_id: attachment_orphan_cleanup
    handler: cleanUpOrphanAttachments
    interval: "0 3 * * *"
```

An upload is "unreferenced" when it is on no `attachable` bridge and is the target of no direct-attachment foreign
key (`UNLINKED_ATTACHMENT_WHERE` in the generated `lib/attachment/access.ts`). The row is deleted first, and only
while it is still unreferenced, so an upload attached during the run is left alone; a stored object that cannot
be removed is logged and the run continues. See [scheduled-task-operations.md](scheduled-task-operations.md) for
how a bulk task is run.

## Adopting this version in an application that already holds attachments

Files stored by an earlier version are addressed by URL (`attachment.path` holds a public Blob URL, an
`/api/gcs/<path>` path or an `/uploads/<path>` path). This version reads `attachment.path` as an opaque storage
key, so existing rows must be migrated once per application. The generator does not ship a migration script: it
needs the application's own database and both the old and the new storage credentials.

1. **Prepare the new storage.**
   - Vercel Blob: create a new **private** store (a store's access mode is fixed when it is created and cannot be
     changed), connect it to the project and set its token next to the existing store's during the transition.
   - Google Cloud Storage: the bucket is already private; nothing to create.
   - Local disk: nothing to create; the files move under `.uploads/`.
2. **Add the columns** (above) and deploy the migration.
3. **Re-key every existing attachment.** For each `attachment` row:
   1. Read the bytes from wherever `path` points today.
   2. Store them under a fresh `crypto.randomUUID()` key in the new storage.
   3. If `encrypted_original_name` is `NULL`, fill it from the old path's file name (`encryptFileName`).
   4. Backfill `uploader_id` and `uploader_organization_id` from the linked owner record's creator and
      organization where the row is linked; leave an unlinked legacy row's provenance empty and review it by hand.
   5. Update `path` to the new key.
4. **Deploy the new code** in the same release as, or after, step 3. The new routes read `path` as a key, and the
   front end renders `/api/attachments/<id>`.
5. **Verify every row** is delivered through `GET /api/attachments/<id>` (100%, not a sample).
6. **Delete the old objects**, and only after that the old public Blob store (store deletion cannot be undone).

Rollback points: nothing is deleted before step 6, so until then the old objects and the old `path` values (keep
a copy of the column before step 3.5) allow returning to the previous release. After step 6 the previous release
cannot read attachments again.

URLs of files that were shared outside the application (an email, a chat message, a log) keep working until the
old objects are deleted in step 6; deleting them is what revokes those URLs. An application must also check its
own custom code, outbound emails and exports for embedded attachment URLs.

## REST and mobile changes

- `POST /api/upload` answers `{ id, name }` (no `url`).
- `POST /api/attachment/direct` takes `{ id, type }` (no `name` and `path`); it records the attachment kind for
  the upload the caller made and answers `{ id, name, path, type }` with `path` set to `/api/attachments/<id>`.
- `PUT /api/<entity>/<id>/attachments` takes `{ type, items: [{ id }] }`.
- The REST detail of a record embeds each attachment with `path: "/api/attachments/<id>"`.
- `GET /api/uploads/...`, `GET /uploads/...` and `GET /api/gcs/...` no longer exist.
- The mobile app fetches images with the access token in an `Authorization` header and opens a file by fetching it
  with the token (Web build). Opening a file from the native app needs the same token and is not supported by the
  system browser hand-off the previous version used.
