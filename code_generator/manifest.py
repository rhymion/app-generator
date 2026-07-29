"""Generation manifest — the single source of truth for which files the code
generator produced, so cleanup.py removes exactly those (and nothing else)
without re-deriving paths from the schema.

generate.py records every file written through _write/_write_stub, then dumps
the list to ``<output-dir>/.generated-manifest.json``. cleanup.py reads it back
and deletes each listed file ONLY when the on-disk content still hashes to the
recorded value, so a file the user edited after generation is preserved.

Appended files (messages/*.json, lib/site-config.ts, app/[locale]/@sidebar/
page.tsx) are written by generators_i18n, never through _write, so they are
deliberately absent from the manifest and are never deleted outright — cleanup
strips only the generator-injected entries from them instead.

Stub staleness (cmd_413b): a write-once stub (e.g. service_after_create.ts)
skips regeneration whenever the file already exists, on the assumption that
existing content means a human customized it. But if the *schema* grows a new
signal after the stub was first generated (e.g. an entity gains x-approval /
an approvable relation once its stub is already on disk), the file is stuck
rendering the old branch forever — no error, no warning, and cleanup.py can't
fix it either (its hash-guard sees "differs from today's render" and treats
that identically to a real hand-edit, so it preserves the stale file). To
break that tie, each stub entry also carries `stub_history`: every pristine
render this generator has ever produced for that path, across runs. On-disk
content matching *any* entry in that history is still provably untouched by a
human — see ManifestRecorder.is_stale_stub(), used by generate.py's
_write_stub to self-heal such files instead of skipping them.
"""
import hashlib
import json
from pathlib import Path

MANIFEST_FILENAME = '.generated-manifest.json'
MANIFEST_VERSION = 1


def sha256_text(content: str) -> str:
    """Hash of generated content as the generator produced it (UTF-8)."""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash of an on-disk file's raw bytes. Matches sha256_text() for a file
    written verbatim as UTF-8 (which _write does)."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ManifestRecorder:
    """Collects {abs_path: (sha256, mode)} as files are written during a run.

    `mode` is one of:
      - 'overwrite': fully regenerated every run (the vast majority).
      - 'stub':      write-once (generator skips if the file already exists);
                     cleanup honours --keep-stubs for these.

    When constructed with `out`, loads the previous run's manifest (if any) to
    seed `_stub_history` — see module docstring "Stub staleness (cmd_413b)".
    """

    def __init__(self, out: Path | None = None) -> None:
        self._entries: dict[Path, tuple[str, str]] = {}
        self._out = out.resolve() if out is not None else None
        self._stub_history: dict[Path, set[str]] = (
            self._load_prior_stub_history(self._out) if self._out is not None else {}
        )

    @staticmethod
    def _load_prior_stub_history(out: Path) -> dict[Path, set[str]]:
        manifest_path = out / MANIFEST_FILENAME
        history: dict[Path, set[str]] = {}
        if not manifest_path.exists():
            return history
        try:
            data = json.loads(manifest_path.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, OSError):
            return history
        for entry in data.get('files', []):
            if entry.get('mode') != 'stub':
                continue
            abs_path = (out / entry['path']).resolve()
            hashes = set(entry.get('stub_history') or [])
            if entry.get('sha256'):
                hashes.add(entry['sha256'])
            if hashes:
                history[abs_path] = hashes
        return history

    def record(self, path: Path, content: str, mode: str = 'overwrite') -> None:
        # Keyed by resolved absolute path; last write in a run wins.
        abs_path = path.resolve()
        digest = sha256_text(content)
        self._entries[abs_path] = (digest, mode)
        if mode == 'stub':
            self._stub_history.setdefault(abs_path, set()).add(digest)

    def is_stale_stub(self, path: Path, on_disk_sha256: str) -> bool:
        """True when `on_disk_sha256` matches a past pristine render of this
        write-once stub (this run's or an earlier run's) — i.e. the file was
        never hand-edited, only left behind before the schema evolved past it.
        """
        return on_disk_sha256 in self._stub_history.get(path.resolve(), set())

    def write(self, out: Path, schema_path: str) -> Path:
        out_abs = out.resolve()
        files = []
        for abs_path in sorted(self._entries):
            digest, mode = self._entries[abs_path]
            entry = {
                'path': abs_path.relative_to(out_abs).as_posix(),
                'sha256': digest,
                'mode': mode,
            }
            if mode == 'stub':
                entry['stub_history'] = sorted(self._stub_history.get(abs_path, {digest}))
            files.append(entry)
        manifest = {
            'version': MANIFEST_VERSION,
            'schema': Path(schema_path).name,
            'files': files,
        }
        dest = out / MANIFEST_FILENAME
        dest.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        return dest

    def __len__(self) -> int:
        return len(self._entries)
