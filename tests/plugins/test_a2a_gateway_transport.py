"""Tests for the A2A hermes-gateway transport.

Covers the credential store (0600, rotation-safe refresh persist), token
refresh behavior (expiry skew, rotated pair saved back, dead-credential
surfacing), peer resolution + transport routing in tools._send_task, and an
end-to-end send_gateway_task conversation against a live in-process mock of
the dashboard gateway (HTTP ticket endpoint + WebSocket JSON-RPC server).
"""

from __future__ import annotations

import json
import os
import socket
import stat
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from plugins.platforms.a2a import gateway_transport, tools


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture()
def cred_home(tmp_path, monkeypatch):
    """Point the credential store at a temp HERMES_HOME."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path


# --------------------------------------------------------------------------
# Credential store
# --------------------------------------------------------------------------

class TestCredentialStore:
    def test_round_trip_and_permissions(self, cred_home):
        entry = {"accessToken": "at1", "refreshToken": "rt1", "expiresAt": 123, "provider": "p", "userId": "u"}
        gateway_transport._save_store({"https://gw.example.com": entry})
        assert gateway_transport.stored_credential("https://gw.example.com") == entry
        # trailing slash normalizes to the same entry
        assert gateway_transport.stored_credential("https://gw.example.com/") == entry
        mode = stat.S_IMODE(os.stat(gateway_transport._store_path()).st_mode)
        assert mode == 0o600

    def test_missing_credential_is_none(self, cred_home):
        assert gateway_transport.stored_credential("https://nowhere.example.com") is None

    def test_normalize_accepts_both_shapes(self):
        snake = gateway_transport._normalize_token_response(
            {"access_token": "a", "refresh_token": "r", "expires_at": 5, "user_id": "u"}
        )
        camel = gateway_transport._normalize_token_response(
            {"accessToken": "a", "refreshToken": "r", "expiresAt": 5, "userId": "u"}
        )
        assert snake == camel

    def test_normalize_requires_access_token(self):
        with pytest.raises(ValueError):
            gateway_transport._normalize_token_response({"refresh_token": "r"})


# --------------------------------------------------------------------------
# Token refresh
# --------------------------------------------------------------------------

class TestTokenRefresh:
    BASE = "https://gw.example.com"

    def _store(self, expires_in: float, refresh: str = "rt-old"):
        gateway_transport._save_store({
            self.BASE: {
                "accessToken": "at-old",
                "refreshToken": refresh,
                "expiresAt": int(time.time() + expires_in),
                "provider": "nous",
                "userId": "u1",
            }
        })

    def test_live_token_used_without_refresh(self, cred_home, monkeypatch):
        self._store(expires_in=3600)
        monkeypatch.setattr(
            gateway_transport, "_http_json",
            lambda *a, **k: pytest.fail("refresh should not be called for a live token"),
        )
        assert gateway_transport._fresh_access_token(self.BASE) == "at-old"

    def test_stale_token_refreshes_and_persists_rotation(self, cred_home, monkeypatch):
        self._store(expires_in=10)  # inside the 60s skew -> refresh
        calls = {}

        def fake_http(url, body=None, bearer="", timeout=0):
            calls["url"] = url
            calls["body"] = body
            return {"access_token": "at-new", "refresh_token": "rt-new", "expires_in": 3300}

        monkeypatch.setattr(gateway_transport, "_http_json", fake_http)
        token = gateway_transport._fresh_access_token(self.BASE)
        assert token == "at-new"
        assert calls["url"].endswith("/auth/native/refresh")
        assert calls["body"]["refresh_token"] == "rt-old"
        # Rotation persisted: the store now holds the NEW pair.
        stored = gateway_transport.stored_credential(self.BASE)
        assert stored["refreshToken"] == "rt-new"
        assert stored["accessToken"] == "at-new"

    def test_no_credential_raises_credential_error(self, cred_home):
        with pytest.raises(gateway_transport.CredentialError):
            gateway_transport._fresh_access_token(self.BASE)

    def test_dead_refresh_raises_credential_error(self, cred_home, monkeypatch):
        import urllib.error

        self._store(expires_in=-100)

        def fake_http(url, body=None, bearer="", timeout=0):
            raise urllib.error.HTTPError(url, 401, "unauthorized", None, None)

        monkeypatch.setattr(gateway_transport, "_http_json", fake_http)
        with pytest.raises(gateway_transport.CredentialError):
            gateway_transport._fresh_access_token(self.BASE)


# --------------------------------------------------------------------------
# Peer resolution + transport routing
# --------------------------------------------------------------------------

class TestTransportRouting:
    def test_resolve_peer_default_transport_is_a2a(self, monkeypatch):
        monkeypatch.setattr(tools, "_load_config", lambda: {
            "a2a_agents": {"plain": {"url": "http://localhost:9999"}}
        })
        peer = tools._resolve_peer("plain")
        assert peer["transport"] == "a2a"

    def test_resolve_peer_gateway_transport(self, monkeypatch):
        monkeypatch.setattr(tools, "_load_config", lambda: {
            "a2a_agents": {
                "hosted": {"url": "https://gw.example.com", "transport": "hermes-gateway"}
            }
        })
        peer = tools._resolve_peer("hosted")
        assert peer["transport"] == gateway_transport.TRANSPORT_NAME

    def test_url_peer_defaults_to_a2a_transport(self):
        peer = tools._resolve_peer("https://direct.example.com")
        assert peer["transport"] == "a2a"

    def test_send_task_routes_gateway_transport(self, monkeypatch):
        sent = {}

        def fake_gateway_send(label, peer, message, session_title="", resume_session_id=""):
            sent["label"] = label
            sent["message"] = message
            sent["resume"] = resume_session_id
            return "hello from peer", "sess-1", "completed"

        monkeypatch.setattr(gateway_transport, "send_gateway_task", fake_gateway_send)
        peer = {"url": "https://gw.example.com", "transport": "hermes-gateway", "timeout": 5}
        reply, ctx, state = tools._send_task("hosted", peer, "ping", "")
        assert reply == "hello from peer"
        assert ctx == "sess-1"
        assert state == "completed"
        assert sent["label"] == "hosted"
        # Outbound redaction ran (message arrives, possibly transformed).
        assert "ping" in sent["message"]

    def test_send_task_gateway_passes_context_for_resume(self, monkeypatch):
        seen = {}

        def fake_gateway_send(label, peer, message, session_title="", resume_session_id=""):
            seen["resume"] = resume_session_id
            return "ok", resume_session_id or "sess-new", "completed"

        monkeypatch.setattr(gateway_transport, "send_gateway_task", fake_gateway_send)
        peer = {"url": "https://gw.example.com", "transport": "hermes-gateway"}
        _, ctx, _ = tools._send_task("hosted", peer, "again", "sess-prior")
        assert seen["resume"] == "sess-prior"
        assert ctx == "sess-prior"

    def test_credential_error_surfaces_as_value_error(self, monkeypatch):
        def fake_gateway_send(label, peer, message, session_title="", resume_session_id=""):
            raise gateway_transport.CredentialError("no gateway credential — run hermes a2a login")

        monkeypatch.setattr(gateway_transport, "send_gateway_task", fake_gateway_send)
        peer = {"url": "https://gw.example.com", "transport": "hermes-gateway"}
        with pytest.raises(ValueError, match="hermes a2a login"):
            tools._send_task("hosted", peer, "ping", "")

    def test_a2a_call_reports_login_hint(self, monkeypatch):
        monkeypatch.setattr(tools, "_load_config", lambda: {
            "a2a_agents": {"hosted": {"url": "https://gw.example.com", "transport": "hermes-gateway"}}
        })

        def fake_gateway_send(label, peer, message, session_title="", resume_session_id=""):
            raise gateway_transport.CredentialError("no gateway credential. Run: hermes a2a login <peer>")

        monkeypatch.setattr(gateway_transport, "send_gateway_task", fake_gateway_send)
        out = tools.a2a_call({"agent": "hosted", "message": "ping"})
        assert "hermes a2a login" in out


# --------------------------------------------------------------------------
# End-to-end: send_gateway_task against a live mock gateway
# --------------------------------------------------------------------------

class _TicketHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path.endswith("/api/auth/ws-ticket"):
            body = json.dumps({"ticket": "tik-1"}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):  # noqa: A002
        return


@pytest.mark.integration
class TestGatewayConversationE2E:
    """Real HTTP ticket mint + real WebSocket JSON-RPC round trip."""

    def _start_ws_server(self, port: int, behavior: str = "normal"):
        """Serve one gateway-ish WS connection: session.create/title/prompt.submit,
        then emit a message.complete event, honoring the JSON-RPC id contract."""
        from websockets.sync.server import serve

        def handler(ws):
            session_id = "gw-sess-1"
            for raw in ws:
                msg = json.loads(raw)
                method, req_id = msg.get("method"), msg.get("id")
                params = msg.get("params") or {}
                if method == "session.create":
                    ws.send(json.dumps({"id": req_id, "result": {"session_id": session_id}}))
                elif method == "session.title":
                    ws.send(json.dumps({"id": req_id, "result": {}}))
                elif method == "prompt.submit":
                    if behavior == "resume-reject" and params.get("session_id") != session_id:
                        ws.send(json.dumps({"id": req_id, "error": {"message": "unknown session"}}))
                        continue
                    ws.send(json.dumps({"id": req_id, "result": {}}))
                    # Interleave an unrelated event first — clients must skip it.
                    ws.send(json.dumps({"method": "event", "params": {"type": "gateway.ready"}}))
                    ws.send(json.dumps({
                        "method": "event",
                        "params": {
                            "type": "message.complete",
                            "session_id": params.get("session_id") or session_id,
                            "payload": {"text": "reply-from-gateway", "status": "complete"},
                        },
                    }))
                elif method == "session.close":
                    ws.send(json.dumps({"id": req_id, "result": {}}))
                    return

        server = serve(handler, "127.0.0.1", port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server

    @pytest.fixture()
    def mock_gateway(self, cred_home, monkeypatch):
        http_port, ws_port = _free_port(), _free_port()
        httpd = HTTPServer(("127.0.0.1", http_port), _TicketHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        ws_server = self._start_ws_server(ws_port)

        base_url = f"http://127.0.0.1:{http_port}"
        gateway_transport._save_store({
            base_url: {
                "accessToken": "at-live",
                "refreshToken": "rt",
                "expiresAt": int(time.time() + 3600),
                "provider": "nous",
                "userId": "u1",
            }
        })

        # Route the WS connect at the WS server (the mock's HTTP and WS live
        # on different ports, unlike a real gateway behind one origin).
        real_connect = gateway_transport._connect_ws

        def patched_connect(url, ticket):
            from websockets.sync.client import connect
            assert ticket == "tik-1"
            return connect(f"ws://127.0.0.1:{ws_port}/api/ws?ticket={ticket}", open_timeout=10)

        monkeypatch.setattr(gateway_transport, "_connect_ws", patched_connect)
        yield base_url
        httpd.shutdown()
        ws_server.shutdown()

    def test_full_round_trip(self, mock_gateway):
        peer = {"url": mock_gateway, "timeout": 15}
        reply, session_id, state = gateway_transport.send_gateway_task("mock", peer, "hello")
        assert reply == "reply-from-gateway"
        assert session_id == "gw-sess-1"
        assert state == "completed"

    def test_resume_uses_prior_session(self, mock_gateway):
        peer = {"url": mock_gateway, "timeout": 15}
        reply, session_id, state = gateway_transport.send_gateway_task(
            "mock", peer, "hello again", resume_session_id="gw-sess-1"
        )
        assert reply == "reply-from-gateway"
        assert session_id == "gw-sess-1"
        assert state == "completed"
