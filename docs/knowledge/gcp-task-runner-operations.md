# Operating the GCP task-runner: create, replace, delete

`scripts/gcp-task-runner.sh` creates the executor that runs `npm run task:run-all` on GCP, and
`scripts/gcp-task-runner-teardown.sh` removes exactly what the first one created. Both read the same
configuration through `scripts/gcp-task-runner-config.sh` (`PROJECT_ID` is required, the ambient `gcloud`
project is never used), so a name set once addresses the same resource in both. The design and the
settings of the create script are in `scheduled-task-operations.md` ("Nightly trigger: Cloud Scheduler + a
minimal Cloud Run Job").

## What the create script owns

| Resource | Name (default) | Created | Re-run |
|---|---|---|---|
| Cloud Scheduler job | `task-runner-nightly` | once | `SKIP`/updated in place |
| Cloud Run Job | `task-runner` | once | updated to the new image |
| Service accounts | `task-runner-sa` (runtime), `task-runner-invoker-sa` (invoker) | once | `SKIP` |
| Secret Manager secrets | `task-runner-<key>`, one per key of the task-runner env file | once | a new secret version is added every run |
| Bucket-scoped IAM bindings | `TASK_RUNNER_BUCKET_ROLES` | once | idempotent |
| Artifact Registry image | `<region>-docker.pkg.dev/<project>/<repo>/<service>-task-runner:<YYYYmmdd-HHMMSS>` | every run | a new tag, the old image stays |

The script does not create the audit-log GCS bucket. It only grants the runtime service account access to
a bucket that already exists. `gcp-setup.sh` creates `GCS_BUCKET`, which is a different bucket.

## Create

```sh
echo 'PROJECT_ID=<gcp-project-id>' >> .env.production.local
cp .env.task-runner.production.local.example .env.task-runner.production.local   # fill in every secret
DRY_RUN=true ./scripts/gcp-task-runner.sh    # prints the commands, runs nothing
./scripts/gcp-task-runner.sh
```

## Replace the image

Running the create script again is the replacement procedure. Each run builds a new image tag, pushes it,
and updates the Cloud Run Job to it. The Scheduler job, the service accounts and the IAM bindings are
found existing and skipped. Two things accumulate and are never removed by the create script: every older image in Artifact Registry,
and every older secret version (the Job reads `:latest`). Old images are removed with the teardown script's
`DELETE_IMAGES` (below), which is part of a full removal.

## Staging and production

- **Production** runs the nightly Job. Each deployment that changes handlers, the schema or other code a
  task uses re-runs `./scripts/gcp-task-runner.sh`, which replaces the image as above. The Job runs the
  image it was created with, so a deployment without a re-run leaves the Job on old code.
- **Staging** is the Vercel Preview environment. Vercel Cron does not fire on Preview deployments, and
  staging does not need a nightly executor: run the tasks by hand against the staging database when needed.

  ```sh
  SEED_COMMAND=task:run-all ./scripts/vercel-seed.sh --staging      # every task, in depends_on order
  SEED_COMMAND="task:run -- <task_id>" ./scripts/vercel-seed.sh --staging   # one task
  ```

  The wrapper loads the staging environment; every variable the handlers read must be present there (see
  "Running tasks directly" in `scheduled-task-operations.md`). Staging therefore needs no task-runner
  resources, no Scheduler job and no audit-log bucket. If they were created earlier, the teardown script
  removes them.

## Delete

```sh
DRY_RUN=true PROJECT_ID=<gcp-project-id> ./scripts/gcp-task-runner-teardown.sh   # prints the plan, calls nothing
PROJECT_ID=<gcp-project-id> ./scripts/gcp-task-runner-teardown.sh
```

It deletes, in this order, by name: the Scheduler job, the Cloud Run Job, the runtime service account's
bucket bindings (the buckets stay), the Secret Manager secrets, the invoker and runtime service accounts, and
the task-runner images. A resource that is already gone is reported as `[SKIP]`, so a second run, or a run
after a partial one, finishes the rest. It never deletes the project (use `gcp-teardown.sh` for that) and
never deletes the Artifact Registry repository, the app's migrate image, or any bucket unless asked.

Before deleting it lists the resources, then asks `yes` and the `PROJECT_ID` again, as `gcp-teardown.sh`
does. The secret names come from the keys of the task-runner env file (`TASK_RUNNER_ENV_FILE`, only the
names are read). Without that file the keys of `TASK_RUNNER_REQUIRED_KEYS` are used; list further keys in
`TASK_RUNNER_EXTRA_SECRET_KEYS`.

### Images: `DELETE_IMAGES`

| Value | Effect |
|---|---|
| `all` (default) | Deletes every image in `<service>-task-runner` |
| `keep:N` | Keeps the N newest images, deletes the rest |
| `none` | Leaves the images |

### The audit-log bucket: `DELETE_AUDIT_LOG_BUCKET=true`

The bucket is untouched unless this is set. It is the bucket named by `AUDIT_LOG_GCS_BUCKET` in the task-runner
env file or the environment. The bucket holds the write-once copies of the audit-log digests, which are the
record that shows whether the database's audit log was altered. Deleting it removes the only copy that cannot be
edited from the database, and cannot be undone. The script asks for the bucket name as a third confirmation.

Before anything is deleted it reads the bucket and its objects. It stops, deleting nothing, when an object
cannot be deleted yet, and prints the reason and the latest expiry: an object under Object Retention (its
retain-until time is in the future), or a bucket retention period (locked or not) that has not elapsed since
the object was created. A locked retention cannot be shortened or removed, so the only way forward is to wait
for the expiry. An unlocked retention can be shortened by a principal with permission to do so; the script does
not do that. If the bucket or its objects cannot be read, it stops as well.

## After deletion with `audit-log-storage.enabled: true`

Deleting the Job does not change the app. With `x-generator.audit-log-storage.enabled: true` the generated
digest tasks (`audit_log_digest_close`, `audit_log_digest_verify`, `audit_log_export_for_retirement`) still
select a store from the environment (`audit-log-append-only.md`, "Choosing the storage").

- **Nothing runs the tasks** after the Job and Scheduler job are gone: no new run records appear, which is the
  intended state for staging. The database keeps what was already recorded.
- **When a run does happen without a store** (for example a manual `task:run-all` on a database whose
  environment has no `AUDIT_LOG_*` value), the factory throws `Audit log storage is not configured` before
  any work. `audit_log_digest_close` and `audit_log_export_for_retirement` are recorded as failed (exit code 1,
  with that message), `audit_log_digest_verify` is blocked behind `audit_log_digest_close` (exit code 2, no
  run record), and `audit_log_ensure_partitions` needs no store and succeeds. No digest path succeeds
  silently. The admin screen offers `Rerun`, `Mark resolved` and `Skip` on the failed tasks; the last two
  are explicit, audit-logged operator actions, and skipping `audit_log_digest_close` lets `audit_log_digest_verify`
  run, which then fails on the same missing store. The app starts and every other screen and API keeps working.
- **When the environment still names a deleted bucket**, the factory selects the GCS adapter again. This
  document does not state how that run ends; remove the value together with the bucket rather than relying on it.

Remove the `AUDIT_LOG_GCS_*` values from the environment together with the bucket, or leave the digest tasks
out of the staging run.
