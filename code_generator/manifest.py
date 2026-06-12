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
    """

    def __init__(self) -> None:
        self._entries: dict[Path, tuple[str, str]] = {}

    def record(self, path: Path, content: str, mode: str = 'overwrite') -> None:
        # Keyed by resolved absolute path; last write in a run wins.
        self._entries[path.resolve()] = (sha256_text(content), mode)

    def write(self, out: Path, schema_path: str) -> Path:
        out_abs = out.resolve()
        files = []
        for abs_path in sorted(self._entries):
            digest, mode = self._entries[abs_path]
            files.append({
                'path': abs_path.relative_to(out_abs).as_posix(),
                'sha256': digest,
                'mode': mode,
            })
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
