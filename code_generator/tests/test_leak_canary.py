"""The leak canary: the manifest, the marker search, the recording proxy and the verdict."""
import base64
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import pytest

import leak_canary as lc


@pytest.fixture
def manifest():
    return lc.load_manifest()


@pytest.fixture
def canaries(manifest):
    return lc.plan(manifest, run_id="abc123")


def test_shipped_manifest_is_valid_and_covers_the_listed_field_types(manifest):
    assert lc.validate_manifest(manifest) == []
    tables = {(c["table"], c["column"]) for c in manifest["canaries"].values() if c["kind"] == "db"}
    for needed in [("user", "password"), ("user", "api_key"), ("user", "mfa_secret"),
                   ("mfa_recovery_code", "code_hash"), ("mobile_session", "refresh_token_hash"),
                   ("attachment", "encrypted_original_name")]:
        assert needed in tables
    envs = {c["name"] for c in manifest["canaries"].values() if c["kind"] == "env"}
    assert "AUTH_SECRET" in envs
    assert {"response_body", "response_headers", "export", "download_name", "redirect_target",
            "server_log", "client_bundle", "source_map"} <= set(manifest["surfaces"])


def test_a_new_canary_and_a_new_actor_need_only_data(manifest):
    extra = copy.deepcopy(manifest)
    extra["actors"]["auditor"] = {}
    extra["canaries"]["new_secret"] = {"kind": "db", "table": "t", "column": "c", "row": "r",
                                       "allowed_actors": ["auditor"]}
    assert lc.validate_manifest(extra) == []
    planned = lc.plan(extra, run_id="r1")
    hit = lc.scan_response(planned, extra, route="GET /x", actor="admin", status_line="HTTP/1.1 200 OK",
                           headers=[], body=planned["new_secret"].value.encode())
    assert [h.canary for h in hit] == ["new_secret"]


@pytest.mark.parametrize("breakage,expect", [
    (lambda m: m["canaries"]["user_api_key"].update(kind="x"), "kind must be one of"),
    (lambda m: m["canaries"]["user_api_key"].pop("column"), "needs `column`"),
    (lambda m: m["canaries"]["env_auth_secret"].pop("name"), "needs `name`"),
    (lambda m: m["canaries"]["user_api_key"].update(allowed_actors=["nobody"]), "not declared"),
    (lambda m: m["surfaces"]["server_log"].update(recorder="x"), "recorder must be"),
])
def test_manifest_problems_are_reported(manifest, breakage, expect):
    broken = copy.deepcopy(manifest)
    breakage(broken)
    assert any(expect in p for p in lc.validate_manifest(broken))


def test_markers_are_alphanumeric_and_unique(canaries):
    values = [c.value for c in canaries.values()]
    assert len(set(values)) == len(values)
    assert all(v.isalnum() for v in values)


@pytest.mark.parametrize("prefix", [b"", b"a", b"ab", b"abc"])
@pytest.mark.parametrize("suffix", [b"", b"z", b"zy", b"zyx"])
def test_base64_forms_are_found_whatever_surrounds_the_value(canaries, prefix, suffix):
    canary = canaries["user_api_key"]
    blob = base64.b64encode(prefix + canary.value.encode() + suffix)
    assert lc.find(blob, [canary]), (prefix, suffix)


def test_hex_form_is_found(canaries):
    canary = canaries["user_api_key"]
    assert lc.find(canary.value.encode().hex().encode(), [canary])


def test_unrelated_text_has_no_hit(canaries):
    assert lc.find(b"nothing to see; CNRY is not a marker", canaries.values()) == []


def test_the_surface_is_named(canaries, manifest):
    c = canaries["user_password_hash"]
    hits = lc.scan_response(canaries, manifest, route="GET /api/user/export", actor="admin",
                            status_line="HTTP/1.1 200 OK",
                            headers=[("Content-Disposition", f'attachment; filename="{c.value}.csv"'),
                                     ("Location", f"/next?x={c.value}")],
                            body=f"id,password\n1,{c.value}\n".encode())
    assert {h.surface for h in hits} == {"response_body", "response_headers", "download_name",
                                         "redirect_target", "export"}
    assert {h.canary for h in hits} == {"user_password_hash"}
    assert all(h.where == "GET /api/user/export" for h in hits)


def test_status_line_is_scanned_too(canaries, manifest):
    c = canaries["user_api_key"]
    hits = lc.scan_response(canaries, manifest, route="GET /x", actor="admin",
                            status_line=f"HTTP/1.1 200 {c.value}", headers=[], body=b"")
    assert [h.surface for h in hits] == ["response_headers"]


def test_another_organizations_marker_is_allowed_only_to_that_actor(canaries, manifest):
    c = canaries["vault_foreign_org_title"]
    body = json.dumps({"title": c.value}).encode()
    kw = dict(route="GET /api/lk_vault", status_line="HTTP/1.1 200 OK", headers=[], body=body)
    assert lc.scan_response(canaries, manifest, actor="org_b_member", **kw) == []
    assert [h.canary for h in lc.scan_response(canaries, manifest, actor="admin", **kw)] == [c.id]
    assert [h.canary for h in lc.scan_response(canaries, manifest, actor="unattributed", **kw)] == [c.id]


def test_a_secret_is_never_allowed(canaries, manifest):
    c = canaries["vault_write_only_field"]
    for actor in ("admin", "org_b_member", "unattributed"):
        assert lc.scan_response(canaries, manifest, route="r", actor=actor, status_line="s",
                                headers=[], body=c.value.encode())


def test_files_are_scanned_per_surface_and_env_markers_only_in_bundles(canaries, manifest, tmp_path):
    (tmp_path / "static").mkdir()
    (tmp_path / "static" / "chunk.js").write_text(f"var s='{canaries['env_auth_secret'].value}'")
    (tmp_path / "static" / "chunk.js.map").write_text(f"{canaries['user_password_hash'].value}")
    hits = lc.scan_files(canaries, manifest, "client_bundle", [tmp_path / "static"])
    assert [(h.canary, h.surface) for h in hits] == [("env_auth_secret", "client_bundle")]
    assert str(tmp_path / "static" / "chunk.js") == hits[0].where
    log = tmp_path / "server.log"
    log.write_text(f"error: user {canaries['user_password_hash'].value}\n")
    hits = lc.scan_files(canaries, manifest, "server_log", [log])
    assert [(h.canary, h.surface, h.where) for h in hits] == [("user_password_hash", "server_log", str(log))]


class _Upstream(BaseHTTPRequestHandler):
    leak = ""

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/leak"):
            body = json.dumps({"id": "1", "password": _Upstream.leak}).encode()
        elif self.path.startswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", f"/landing?t={_Upstream.leak}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        else:
            body = b'{"id": "1"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _serve(handler_server):
    t = threading.Thread(target=handler_server.serve_forever, daemon=True)
    t.start()
    return t


def test_a_deliberate_leak_through_the_proxy_is_caught_and_named(canaries, manifest, tmp_path):
    """A route that returns the password hash fails the run and names the field and the route."""
    _Upstream.leak = canaries["user_password_hash"].value
    upstream = HTTPServer(("127.0.0.1", 0), _Upstream)
    _serve(upstream)
    hits_file = tmp_path / "hits.jsonl"
    rec = lc._Recorder(canaries, manifest, hits_file)
    proxy = lc.make_proxy(f"http://127.0.0.1:{upstream.server_port}", rec)
    _serve(proxy)
    base = f"http://127.0.0.1:{proxy.server_port}"
    try:
        for path in ("/clean", "/leak/user"):
            urlopen(Request(base + path, headers={lc.ACTOR_HEADER: "admin"})).read()
        assert lc.read_hits(hits_file) and {h["where"] for h in lc.read_hits(hits_file)} == {"GET /leak/user"}
        assert lc.verdict(lc.read_hits(hits_file)) == 1
    finally:
        proxy.shutdown()
        upstream.shutdown()
    assert {h["canary"] for h in lc.read_hits(hits_file)} == {"user_password_hash"}


def test_a_marker_in_a_redirect_target_is_caught(canaries, manifest, tmp_path):
    _Upstream.leak = canaries["env_auth_secret"].value
    upstream = HTTPServer(("127.0.0.1", 0), _Upstream)
    _serve(upstream)
    rec = lc._Recorder(canaries, manifest, tmp_path / "hits.jsonl")
    proxy = lc.make_proxy(f"http://127.0.0.1:{upstream.server_port}", rec)
    _serve(proxy)

    class NoFollow(__import__("urllib.request").request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = __import__("urllib.request").request.build_opener(NoFollow)
    try:
        with pytest.raises(HTTPError):
            opener.open(f"http://127.0.0.1:{proxy.server_port}/redirect")
    finally:
        proxy.shutdown()
        upstream.shutdown()
    surfaces = {h["surface"] for h in lc.read_hits(tmp_path / "hits.jsonl")}
    assert {"redirect_target", "response_headers"} <= surfaces
    assert {h["actor"] for h in lc.read_hits(tmp_path / "hits.jsonl")} == {"unattributed"}


def test_the_actor_header_is_not_forwarded(canaries, manifest, tmp_path):
    seen = {}

    class Echo(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            seen.update({k.lower(): v for k, v in self.headers.items()})
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

    upstream = HTTPServer(("127.0.0.1", 0), Echo)
    _serve(upstream)
    proxy = lc.make_proxy(f"http://127.0.0.1:{upstream.server_port}", lc._Recorder(canaries, manifest, tmp_path / "h"))
    _serve(proxy)
    try:
        urlopen(Request(f"http://127.0.0.1:{proxy.server_port}/", headers={lc.ACTOR_HEADER: "admin", "X-Api-Key": "k"}))
    finally:
        proxy.shutdown()
        upstream.shutdown()
    assert lc.ACTOR_HEADER not in seen and seen["x-api-key"] == "k"


def test_verdict_passes_with_no_hits_and_fails_naming_each_one(capsys):
    assert lc.verdict([]) == 0
    assert lc.verdict([{"canary": "c", "surface": "server_log", "where": "/tmp/x", "form": "raw", "actor": "n/a"}]) == 1
    assert "'c'" in capsys.readouterr().err


def test_verdict_fails_a_run_that_proves_nothing(canaries, manifest, tmp_path):
    """No traffic, or a detector that never fired on the control, is not a pass."""
    hits = tmp_path / "hits.jsonl"
    rec = lc._Recorder(canaries, manifest, hits)
    upstream = HTTPServer(("127.0.0.1", 0), _Upstream)
    _serve(upstream)
    proxy = lc.make_proxy(f"http://127.0.0.1:{upstream.server_port}", rec)
    _serve(proxy)
    base = f"http://127.0.0.1:{proxy.server_port}"
    try:
        assert lc.verdict([], hits, 2) == 1  # nothing recorded yet
        urlopen(base + "/a").read()
        urlopen(base + "/b").read()
        assert lc.verdict([], hits, 2) == 1  # traffic, but no control
        urlopen(base + lc.CONTROL_PATH).read()
        assert lc.verdict([], hits, 2) == 0
        assert lc.read_hits(hits) == []  # the control never counts as a leak
    finally:
        proxy.shutdown()
        upstream.shutdown()
