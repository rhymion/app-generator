/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Cross-platform `docker compose` launcher that layers .env.<name>.local
// over .env.<name> when the .local file exists.
//
// `docker compose --env-file` only reads the file(s) named explicitly on
// the command line — it never looks for a sibling `.local` override the
// way @next/env's loadEnvConfig() does. Passing `--env-file` twice is
// supported and later-wins (docker/compose#9737), so this script appends
// the `.local` file only when present; passing a nonexistent path makes
// docker compose fail hard with "couldn't find env file", and
// `.env.<name>.local` is gitignored so it usually doesn't exist.
//
// Precedence note: shell environment variables still beat every
// --env-file value for docker compose itself (e.g. an exported
// COMPOSE_PROJECT_NAME wins over both .env.test and .env.test.local).
// See docs/knowledge/env-file-loading-and-local-overrides.md.
//
// COMPOSE_PROJECT_NAME fail-closed guard:
// When neither `-p`/`--project-name` nor a resolvable COMPOSE_PROJECT_NAME
// is present, `docker compose` silently falls back to the current
// directory's basename as the project name. This repo's submodule path
// (per .gitmodules) always checks out to a directory literally named
// "app-generator" — identical across every worktree/checkout — so that
// fallback silently lands every isolated worktree in the SAME compose
// project namespace as every other checkout, including a developer's own
// persistent dev containers. Two independent checkouts colliding this way
// can stop or delete each other's containers/volumes with no warning.
// This guard refuses to proceed rather than let that happen silently.
//
// Exempted only for recognized CI (the standard `CI=true` env var GitHub
// Actions — and most other CI providers — set on every job): a CI runner
// is a fresh, single-tenant, ephemeral VM with no other compose stack to
// collide with, so the same fallback that is dangerous on a shared
// developer host is harmless there. Anywhere else (an interactive shell,
// a worktree-based dev flow, an automated agent) this is a hard failure —
// export a unique COMPOSE_PROJECT_NAME (or pass -p/--project-name)
// before retrying.
const { existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const [, , envName, ...composeArgs] = process.argv;
if (!envName || composeArgs.length === 0) {
  console.error(
    '[docker-compose-env] Usage: node scripts/docker-compose-env.js <env-file-suffix> <docker compose args...>'
  );
  process.exit(1);
}

const baseFile = `.env.${envName}`;
const localFile = `${baseFile}.local`;

const envFileArgs = ['--env-file', baseFile];
if (existsSync(localFile)) {
  envFileArgs.push('--env-file', localFile);
}

// Last-line-wins for a `KEY=value` (optionally quoted) line, matching both
// dotenv's and docker compose's own re-declaration semantics.
function readEnvValue(filePath, key) {
  if (!existsSync(filePath)) return undefined;
  let value;
  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    value = v;
  }
  return value;
}

function getExplicitProjectName(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--project-name') return args[i + 1];
    if (args[i].startsWith('--project-name=')) return args[i].slice('--project-name='.length);
  }
  return undefined;
}

const explicitProjectName = getExplicitProjectName(composeArgs);
const hasExplicitProjectFlag = explicitProjectName !== undefined;

// Resolved project name is also needed below (stale-volume guard) to
// compute the real docker volume name, not just for the fail-closed check
// here.
let resolvedProjectName = explicitProjectName;

if (!hasExplicitProjectFlag) {
  // Same precedence docker compose itself applies (verified, see
  // docs/knowledge/env-file-loading-and-local-overrides.md): shell env >
  // later --env-file (.local) > earlier --env-file (base).
  resolvedProjectName =
    process.env.COMPOSE_PROJECT_NAME ||
    readEnvValue(localFile, 'COMPOSE_PROJECT_NAME') ||
    readEnvValue(baseFile, 'COMPOSE_PROJECT_NAME');

  if (!resolvedProjectName && process.env.CI !== 'true') {
    console.error(
      [
        '[docker-compose-env] Refusing to run: COMPOSE_PROJECT_NAME is not set',
        `  (checked: shell env, ${localFile}, ${baseFile}) and no -p/--project-name was passed.`,
        '  Without an explicit project name, docker compose falls back to this',
        "  directory's basename — the SAME value for every worktree/checkout of",
        '  this repo — which collides with any other running stack under that name.',
        '',
        '  Fix: export COMPOSE_PROJECT_NAME=<unique-name> for this worktree/checkout',
        '  (or pass -p <unique-name>) before retrying.',
      ].join('\n')
    );
    process.exit(1);
  }
}

// Stale pre-major-upgrade Postgres volume guard:
//
// postgres:18+'s entrypoint (docker-library/postgres#1259) expects PGDATA
// to live under a version-specific subdirectory it manages itself, and
// refuses to start (exit 1) the moment it finds a flat, pre-18-style
// cluster sitting directly at the mount root instead. This repo's compose
// files already carry the corrected mount (`postgres-data:/var/lib/postgresql`,
// the parent directory, not `.../data`), but that fix only prevents the
// failure for a FRESH volume. A named volume created before the version
// bump still has its old flat-layout cluster sitting at its root — the
// volume's root content does not change just because a later compose file
// mounts it at a different container path — and postgres:18 refuses it
// exactly the same way.
//
// `up -d` returns as soon as the container is CREATED, not once postgres
// is actually accepting connections, so this failure is invisible at the
// `up` step itself. Everything downstream (db:push/seed/Cypress) then
// fails against what looks like an unrelated spec with "Can't reach
// database server" — an easy misdiagnosis pattern when the actual cause is
// upstream and environmental. `--wait` surfaces it one step earlier
// (compose itself fails when the container never reaches healthy) but the
// container is still dead either way — this guard catches it a step
// earlier still, before `docker compose up` ever runs, by reading
// (read-only, via a disposable `alpine` container) whatever the target
// named volume already holds. It must never be a substitute for
// `--wait`/healthchecks — it only judges volumes that already exist; a
// volume this guard passes can still fail to become healthy for unrelated
// reasons, which `--wait` is what actually catches.
function extractComposeFiles(args) {
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' || args[i] === '--file') {
      if (args[i + 1]) files.push(args[i + 1]);
    } else if (args[i].startsWith('--file=')) {
      files.push(args[i].slice('--file='.length));
    }
  }
  return files;
}

function checkStalePostgresVolumes(composeFiles, projectName) {
  if (!projectName) return; // can't compute the real volume name without it -- nothing to check
  let yaml;
  try {
    yaml = require('js-yaml');
  } catch {
    return; // dependency unavailable -- not this guard's job to enforce that
  }

  for (const file of composeFiles) {
    if (!existsSync(file)) continue;
    let doc;
    try {
      doc = yaml.load(readFileSync(file, 'utf8'));
    } catch {
      continue; // malformed compose YAML is docker compose's own job to reject, not ours
    }
    const services = (doc && doc.services) || {};
    for (const svc of Object.values(services)) {
      const image = svc && typeof svc.image === 'string' ? svc.image : undefined;
      if (!image) continue;
      const shortImage = image.split('/').pop(); // strip any registry/namespace prefix
      const versionMatch = /^postgres:(\d+)/.exec(shortImage);
      if (!versionMatch) continue; // not a postgres service, or an unresolvable tag (e.g. "postgres:latest") we can't compare against
      const imageMajor = versionMatch[1];

      const volumeEntries = Array.isArray(svc.volumes) ? svc.volumes : [];
      for (const entry of volumeEntries) {
        if (typeof entry !== 'string') continue; // only the short "name:/path[:mode]" string form is handled
        const volumeKey = entry.split(':')[0];
        if (!volumeKey || volumeKey.startsWith('.') || volumeKey.startsWith('/')) continue; // bind mount, not a named volume
        const volumeDecl = (doc.volumes && doc.volumes[volumeKey]) || {};
        if (volumeDecl && volumeDecl.external) continue; // externally-managed name, not this project's to guess/police
        const dockerVolumeName =
          volumeDecl && typeof volumeDecl.name === 'string' && volumeDecl.name
            ? volumeDecl.name
            : `${projectName}_${volumeKey}`;

        const inspect = spawnSync('docker', ['volume', 'inspect', dockerVolumeName], {
          encoding: 'utf8',
        });
        if (inspect.error || inspect.status !== 0) continue; // volume doesn't exist yet -- compose will create it fresh, nothing stale to find

        // Read-only probe: does the volume's ROOT hold a flat-layout
        // PG_VERSION file (the pre-18 convention)? A correctly-initialized
        // 18+ volume never writes there -- its data lives under a
        // versioned subdirectory (e.g. `18/docker/...`) -- so a root-level
        // PG_VERSION is itself already the tell of a persisted-over
        // volume, and its content pins which major version originally
        // wrote it.
        const probe = spawnSync(
          'docker',
          ['run', '--rm', '-v', `${dockerVolumeName}:/mnt:ro`, 'alpine', 'cat', '/mnt/PG_VERSION'],
          { encoding: 'utf8' }
        );
        if (probe.error || probe.status !== 0) continue; // no root-level PG_VERSION -- empty volume, or already the correct versioned layout
        const volumeMajor = probe.stdout.trim();
        if (volumeMajor && volumeMajor !== imageMajor) {
          console.error(
            [
              `[docker-compose-env] Refusing to start: named volume ${dockerVolumeName}`,
              `  holds a pre-existing PostgreSQL ${volumeMajor} cluster at its root`,
              `  (flat, pre-18 layout), but ${shortImage} needs a fresh or already-`,
              `  versioned (${imageMajor}/) layout. The image's own entrypoint guard`,
              '  (docker-library/postgres#1259) rejects this before postmaster ever',
              '  runs, and `up -d` would otherwise return success while the container',
              '  silently exits -- everything downstream (db:push/seed/Cypress) then',
              '  fails with an unrelated-looking "Can\'t reach database server".',
              '',
              `  Fix: this volume was carried over from before the PostgreSQL ${imageMajor}`,
              '  upgrade and cannot be reused as-is -- discard and recreate it:',
              `    docker volume rm ${dockerVolumeName}`,
              '  (then re-run this command; compose will create a fresh volume).',
            ].join('\n')
          );
          process.exit(1);
        }
      }
    }
  }
}

if (composeArgs.includes('up')) {
  checkStalePostgresVolumes(extractComposeFiles(composeArgs), resolvedProjectName);
}

const result = spawnSync('docker', ['compose', ...envFileArgs, ...composeArgs], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
