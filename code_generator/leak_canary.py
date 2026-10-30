#!/usr/bin/env python3
"""Leak canary: marker values in secret fields, searched for in every output.

Driven by code_generator/leak_canary.yaml (see the header there); this module names no
canary, actor or surface. Sub-commands:

  plan     write the marker values for one run (JSON) from the manifest
  proxy    a recording reverse proxy in front of the app: every response (status line,
           headers, body) is searched for the markers; hits go to a JSONL file
  scan     search files and directories (server log, .next/static, source maps)
  verdict  read the hits file and fail when it holds an unexpected marker

A hit names the canary (the field it came from), the surface and the route or file.
A marker of a canary is allowed only in responses to an actor named in its
`allowed_actors`; a request that names no actor is an actor that is allowed nothing.
"""
from __future__ import annotations

import argparse
import base64
import http.client
import json
import secrets
import socketserver
import sys
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Iterable
from urllib.parse import urlsplit

import yaml

ACTOR_HEADER = "x-leak-canary-actor"
DEFAULT_MANIFEST = Path(__file__).with_name("leak_canary.yaml")
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
              "trailers", "transfer-encoding", "upgrade"}


@dataclass(frozen=True)
class Canary:
    id: str
    kind: str
    value: str
    allowed_actors: tuple[str, ...]
    spec: dict

    def variants(self) -> list[tuple[str, bytes]]:
        """(form, bytes) pairs searched for: raw, base64 (three alignments) and hex."""
        raw = self.value.encode()
        forms = [("raw", raw), ("hex", raw.hex().encode())]
        for shift in range(3):
            padded = b"\0" * shift + raw
            encoded = base64.b64encode(padded).rstrip(b"=")
            # The first characters hold the pad bytes and the last ones depend on the bytes that follow.
            start = (shift * 4 + 2) // 3
            drop = {0: 0, 1: 2, 2: 1}[len(padded) % 3]
            core = encoded[start:len(encoded) - drop]
            if len(core) >= 12:
                forms.append((f"base64+{shift}", core))
        return forms


@dataclass(frozen=True)
class Hit:
    canary: str
    surface: str
    where: str
    form: str
    actor: str

    def as_json(self) -> dict:
        return {"canary": self.canary, "surface": self.surface, "where": self.where,
                "form": self.form, "actor": self.actor}

    def describe(self) -> str:
        return (f"canary {self.canary!r} ({self.form}) found in {self.surface} at {self.where}"
                f" (actor: {self.actor})")


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    problems = validate_manifest(data)
    if problems:
        raise ValueError("leak canary manifest is invalid:\n  " + "\n  ".join(problems))
    return data


def validate_manifest(data: dict) -> list[str]:
    problems: list[str] = []
    actors = set((data.get("actors") or {}).keys())
    surfaces = data.get("surfaces") or {}
    kinds = {"db", "env"}
    for cid, spec in (data.get("canaries") or {}).items():
        kind = spec.get("kind")
        if kind not in kinds:
            problems.append(f"{cid}: kind must be one of {sorted(kinds)}")
        elif kind == "db":
            for key in ("table", "column", "row"):
                if not spec.get(key):
                    problems.append(f"{cid}: a db canary needs `{key}`")
        elif not spec.get("name"):
            problems.append(f"{cid}: an env canary needs `name`")
        for actor in spec.get("allowed_actors") or []:
            if actor not in actors:
                problems.append(f"{cid}: allowed actor {actor!r} is not declared under `actors`")
    for sid, spec in surfaces.items():
        if (spec or {}).get("recorder") not in ("proxy", "file"):
            problems.append(f"surface {sid}: recorder must be `proxy` or `file`")
        for kind in (spec or {}).get("applies_to") or []:
            if kind not in kinds:
                problems.append(f"surface {sid}: applies_to {kind!r} is not a canary kind")
    if not data.get("canaries"):
        problems.append("no canaries declared")
    return problems


def plan(manifest: dict, run_id: str | None = None) -> dict[str, Canary]:
    """One marker per canary. Letters and digits only, so encoding does not change it."""
    run_id = run_id or secrets.token_hex(6)
    out: dict[str, Canary] = {}
    for cid, spec in manifest["canaries"].items():
        tag = "".join(ch for ch in cid.upper() if ch.isalnum())[:14]
        out[cid] = Canary(cid, spec["kind"], f"CNRY{tag}X{run_id}",
                          tuple(spec.get("allowed_actors") or ()), spec)
    return out


def plan_to_json(canaries: dict[str, Canary]) -> dict:
    return {cid: {"kind": c.kind, "value": c.value, "allowed_actors": list(c.allowed_actors),
                  **{k: v for k, v in c.spec.items() if k in ("table", "column", "row", "name")}}
            for cid, c in canaries.items()}


def plan_from_json(data: dict) -> dict[str, Canary]:
    return {cid: Canary(cid, c["kind"], c["value"], tuple(c.get("allowed_actors") or ()), c)
            for cid, c in data.items()}


def find(data: bytes, canaries: Iterable[Canary]) -> list[tuple[Canary, str]]:
    found = []
    for canary in canaries:
        for form, needle in canary.variants():
            if needle in data:
                found.append((canary, form))
                break
    return found


def scan_response(canaries: dict[str, Canary], manifest: dict, *, route: str, actor: str,
                  status_line: str, headers: list[tuple[str, str]], body: bytes) -> list[Hit]:
    """Search one HTTP response; each hit names the surface it was found in."""
    surfaces = manifest.get("surfaces") or {}
    hits: dict[tuple[str, str], Hit] = {}

    def add(canary: Canary, surface: str, form: str) -> None:
        if actor in canary.allowed_actors:
            return
        hits.setdefault((canary.id, surface), Hit(canary.id, surface, route, form, actor))

    all_canaries = list(canaries.values())
    for canary, form in find(status_line.encode(), all_canaries):
        add(canary, "response_headers", form)
    for name, value in headers:
        lowered = name.lower()
        blob = f"{name}: {value}".encode()
        for canary, form in find(blob, all_canaries):
            add(canary, "response_headers", form)
            for sid, spec in surfaces.items():
                if (spec or {}).get("recorder") == "proxy" and (spec or {}).get("header") == lowered:
                    add(canary, sid, form)
    for canary, form in find(body, all_canaries):
        add(canary, "response_body", form)
        for sid, spec in surfaces.items():
            needle = (spec or {}).get("path_contains")
            if (spec or {}).get("recorder") == "proxy" and needle and needle in route:
                add(canary, sid, form)
    return list(hits.values())


def scan_files(canaries: dict[str, Canary], manifest: dict, surface: str, paths: Iterable[Path]) -> list[Hit]:
    """Search files (a server log, the client bundle, source maps)."""
    spec = (manifest.get("surfaces") or {}).get(surface) or {}
    applies = spec.get("applies_to")
    candidates = [c for c in canaries.values() if not applies or c.kind in applies]
    hits: list[Hit] = []
    for path in paths:
        if path.is_dir():
            files: Iterable[Path] = (p for p in sorted(path.rglob("*")) if p.is_file())
        else:
            files = [path]
        for file in files:
            data = file.read_bytes()
            for canary, form in find(data, candidates):
                hits.append(Hit(canary.id, surface, str(file), form, "n/a"))
    return hits


CONTROL_PATH = "/__leak_canary_control"


class _Recorder:
    def __init__(self, canaries: dict[str, Canary], manifest: dict, hits_path: Path):
        self.canaries = canaries
        self.manifest = manifest
        self.hits_path = hits_path
        self.control_path = hits_path.with_name(hits_path.name + ".control")
        self.stats_path = hits_path.with_name(hits_path.name + ".stats")
        self.lock = threading.Lock()
        self.requests = 0

    def record_control(self, hits: list[Hit]) -> None:
        """The positive control: the detector's own hits, kept apart from the real ones."""
        with self.lock:
            with self.control_path.open("a", encoding="utf-8") as f:
                for hit in hits:
                    f.write(json.dumps(hit.as_json()) + "\n")

    def record(self, hits: list[Hit]) -> None:
        with self.lock:
            self.requests += 1
            self.stats_path.write_text(json.dumps({"requests": self.requests}), encoding="utf-8")
            if hits:
                with self.hits_path.open("a", encoding="utf-8") as f:
                    for hit in hits:
                        f.write(json.dumps(hit.as_json()) + "\n")


class _ThreadingServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_proxy(upstream: str, recorder: _Recorder, host: str = "127.0.0.1", port: int = 0) -> _ThreadingServer:
    """A reverse proxy that records. Redirects are passed on, not followed, so a Location is seen."""
    target = urlsplit(upstream)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *args):  # silence
            pass

        def _handle(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            actor = (self.headers.get(ACTOR_HEADER) or "").strip() or "unattributed"
            if self.path.split("?")[0] == CONTROL_PATH:
                # Answers with the first marker, to prove in the live run that the detector sees one.
                marker = next(iter(recorder.canaries.values())).value
                payload = json.dumps({"control": marker}).encode()
                recorder.record_control(scan_response(
                    recorder.canaries, recorder.manifest, route=f"GET {CONTROL_PATH}", actor="control",
                    status_line="HTTP/1.1 200 OK", headers=[], body=payload))
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in HOP_BY_HOP | {ACTOR_HEADER, "accept-encoding", "host"}}
            headers["Accept-Encoding"] = "identity"
            headers["Host"] = self.headers.get("Host", f"{target.hostname}:{target.port}")
            conn = http.client.HTTPConnection(target.hostname, target.port, timeout=120)
            try:
                conn.request(self.command, self.path, body=body, headers=headers)
                resp = conn.getresponse()
                payload = resp.read()
                resp_headers = [(k, v) for k, v in resp.getheaders()]
                status_line = f"HTTP/1.1 {resp.status} {resp.reason}"
            except OSError as exc:
                self.send_error(502, f"upstream unreachable: {exc.__class__.__name__}")
                return
            finally:
                conn.close()
            route = f"{self.command} {self.path.split('?')[0]}"
            recorder.record(scan_response(recorder.canaries, recorder.manifest, route=route, actor=actor,
                                          status_line=status_line, headers=resp_headers, body=payload))
            self.send_response(resp.status, resp.reason)
            for k, v in resp_headers:
                if k.lower() in HOP_BY_HOP | {"content-length", "content-encoding"}:
                    continue
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _handle

    return _ThreadingServer((host, port), Handler)


def read_hits(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def verdict(hits: list[dict], hits_path: Path | None = None, min_requests: int = 0) -> int:
    """Fail on any hit; with `min_requests`, also on a run that proves nothing: too few recorded
    requests, or the positive control (a known marker sent through the proxy) not detected."""
    if hits_path is not None and min_requests:
        stats = hits_path.with_name(hits_path.name + ".stats")
        seen = json.loads(stats.read_text(encoding="utf-8")).get("requests", 0) if stats.exists() else 0
        control = read_hits(hits_path.with_name(hits_path.name + ".control"))
        if seen < min_requests or not control:
            print(f"leak-canary: the run proves nothing: {seen} request(s) recorded (need {min_requests}), "
                  f"positive control {'detected' if control else 'NOT detected'}", file=sys.stderr)
            return 1
    if not hits:
        print("leak-canary: no marker appeared in any recorded output"
              + (f" ({seen} requests recorded, positive control detected)" if hits_path is not None and min_requests else ""))
        return 0
    seen = set()
    print(f"leak-canary: {len(hits)} unexpected marker hit(s)", file=sys.stderr)
    for hit in hits:
        key = (hit["canary"], hit["surface"], hit["where"])
        if key in seen:
            continue
        seen.add(key)
        print("  - " + Hit(**hit).describe(), file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("proxy")
    p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--upstream", required=True)
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--hits", type=Path, required=True)
    p = sub.add_parser("scan")
    p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--surface", required=True)
    p.add_argument("--hits", type=Path, required=True)
    p.add_argument("paths", nargs="+", type=Path)
    p = sub.add_parser("verdict")
    p.add_argument("--hits", type=Path, required=True)
    p.add_argument("--min-requests", type=int, default=0,
                   help="fail when the proxy saw fewer requests, or its positive control did not fire")
    args = parser.parse_args(argv)

    if args.cmd == "plan":
        manifest = load_manifest(args.manifest)
        args.out.write_text(json.dumps(plan_to_json(plan(manifest)), indent=2), encoding="utf-8")
        return 0
    if args.cmd == "verdict":
        return verdict(read_hits(args.hits), args.hits, args.min_requests)
    manifest = load_manifest(args.manifest)
    canaries = plan_from_json(json.loads(args.plan.read_text(encoding="utf-8")))
    if args.cmd == "scan":
        hits = scan_files(canaries, manifest, args.surface, [p for p in args.paths if p.exists()])
        if hits:
            with args.hits.open("a", encoding="utf-8") as f:
                for hit in hits:
                    f.write(json.dumps(hit.as_json()) + "\n")
        print(f"leak-canary: scanned {args.surface}: {len(hits)} hit(s)")
        return 0
    recorder = _Recorder(canaries, manifest, args.hits)
    server = make_proxy(args.upstream, recorder, port=args.port)
    print(f"leak-canary: proxy on :{args.port} -> {args.upstream}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
