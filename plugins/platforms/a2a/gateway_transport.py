"""
hermes-gateway transport for A2A client tools.

Lets ``a2a_call`` (and friends) reach a peer that is a *hosted Hermes instance*
— anything running ``hermes dashboard`` / Hermes Cloud — through the
authenticated conversation API that instance already exposes, instead of
requiring the peer to run the A2A listener with static bearer tokens.

Peer config (config.yaml)::

    a2a_agents:
      hmb:
        url: "https://my-instance.example.com"
        transport: hermes-gateway     # default is "a2a"
        timeout: 420

Auth is the gateway's RFC 8252 native-app flow (the same one the desktop app
uses): a one-time interactive ``hermes a2a login <peer>`` opens the system
browser, catches the redirect on a loopback listener, exchanges the code with
PKCE, and stores the token set under ``~/.hermes/credentials/`` (0600). After
that, calls are unattended: the access token is refreshed on expiry and the
rotated refresh token is persisted back (rotation means a skipped save-back
kills the credential).

Wire sequence per call:

    POST /api/auth/ws-ticket  (Bearer access token)  -> single-use ~30s ticket
    WSS  /api/ws?ticket=...                          -> JSON-RPC
      session.create {cols, source}                  -> {session_id}
      session.title  {session_id, title}             (best effort)
      prompt.submit  {session_id, text}              (returns immediately)
      ... wait for notification:
          {"method":"event","params":{"type":"message.complete",
           "session_id"|"sid":..., "payload":{"text":..., "status":...}}}
      session.close  {session_id}

Field notes baked in (each cost a debugging cycle against a live deployment):
CDNs in front of some dashboards 403 Python's default User-Agent (HTML body
``error code: 1010``) — send a browser UA everywhere including the WS upgrade;
the WSS route can hang at TCP connect over IPv6 while HTTPS works — connect via
an IPv4-resolved socket; tickets are single-use, mint one per connect; replies
are JSON-RPC *notifications*, not responses — unwrap ``params``.

Stdlib + the ``websockets`` package (already a core dependency, used by the
relay transport). Tokens and tickets are never logged.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import json
import logging
import os
import secrets
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

TRANSPORT_NAME = "hermes-gateway"

# Some deployments front the dashboard with a CDN that rejects Python's
# default urllib UA outright (403, body "error code: 1010"). A browser UA is
# required on every request, including the WebSocket upgrade.
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

_LOGIN_TIMEOUT_S = 300
_TICKET_TIMEOUT_S = 30
_RPC_TIMEOUT_S = 60
_TOKEN_SKEW_S = 60

_DONE_HTML = (
    b'<!doctype html><meta charset="utf-8"><title>Signed in</title>'
    b'<body style="font:15px system-ui;margin:3rem;text-align:center">'
    b"<h2>&#10003; Signed in</h2><p>This credential belongs to your Hermes "
    b"agent. You can close this window.</p>"
    b"<script>setTimeout(()=>window.close(),800)</script>"
)


# --------------------------------------------------------------------------
# Credential store
# --------------------------------------------------------------------------

def _store_path() -> Path:
    home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
    return home / "credentials" / "a2a-gateway-tokens.json"


def _load_store() -> dict:
    try:
        return json.loads(_store_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_store(store: dict) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(store, fh, indent=1)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _normalize_token_response(body: dict, fallback_refresh: str = "") -> dict:
    """Accept both snake_case (gateway) and camelCase shapes; validate."""
    access = str(body.get("access_token") or body.get("accessToken") or "")
    if not access:
        raise ValueError("gateway token response missing access_token")
    expires_at = body.get("expires_at") or body.get("expiresAt")
    if not expires_at:
        expires_at = time.time() + int(body.get("expires_in") or 3300)
    return {
        "accessToken": access,
        "refreshToken": str(
            body.get("refresh_token") or body.get("refreshToken") or fallback_refresh
        ),
        "expiresAt": int(expires_at),
        "provider": str(body.get("provider") or ""),
        "userId": str(body.get("user_id") or body.get("userId") or ""),
    }


def stored_credential(base_url: str) -> Optional[dict]:
    return _load_store().get(base_url.rstrip("/"))


# --------------------------------------------------------------------------
# HTTP helpers (urllib, browser UA, JSON)
# --------------------------------------------------------------------------

def _http_json(
    url: str,
    body: Optional[dict] = None,
    bearer: str = "",
    timeout: int = 30,
) -> dict:
    headers = {"User-Agent": _UA, "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (operator-configured peer)
        return json.loads(resp.read().decode("utf-8") or "{}")


def _auth_endpoint(base_url: str, leaf: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    prefix = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{prefix}/auth/native/{leaf}"


def _api_endpoint(base_url: str, leaf: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    prefix = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{prefix}/api/{leaf}"


# --------------------------------------------------------------------------
# Interactive login (RFC 8252: loopback + system browser + PKCE)
# --------------------------------------------------------------------------

def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    captured: dict = {}

    def do_GET(self):  # noqa: N802 - stdlib naming
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(_DONE_HTML)
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if "code" in params or "error" in params:
            _CallbackHandler.captured = {k: v[0] for k, v in params.items()}

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        return


def gateway_supports_native_login(base_url: str) -> tuple[bool, str]:
    """Probe /api/status for the native_pkce auth flow. Returns (ok, detail)."""
    try:
        status = _http_json(_api_endpoint(base_url, "status"), timeout=15)
    except Exception as e:
        return False, f"cannot reach {base_url}/api/status: {e}"
    flows = status.get("auth_flows") or []
    if "native_pkce" not in flows:
        return False, f"gateway does not advertise native_pkce (auth_flows={flows})"
    return True, str(status.get("version") or "")


def interactive_login(base_url: str, provider: str = "", open_browser: bool = True) -> dict:
    """Run the loopback PKCE login against ``base_url`` and persist the tokens.

    Returns the stored credential entry. Raises RuntimeError on failure.
    """
    base_url = base_url.rstrip("/")
    ok, detail = gateway_supports_native_login(base_url)
    if not ok:
        raise RuntimeError(detail)

    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = _b64url(secrets.token_bytes(24))

    _CallbackHandler.captured = {}
    server = http.server.HTTPServer(("127.0.0.1", 0), _CallbackHandler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    q = {
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "redirect_uri": f"http://127.0.0.1:{port}/callback",
        "state": state,
    }
    if provider:
        q["provider"] = provider
    authorize_url = _auth_endpoint(base_url, "authorize") + "?" + urllib.parse.urlencode(q)

    print(f"Opening browser to sign in to {base_url} …")
    print(f"(loopback listener on 127.0.0.1:{port}; waiting up to {_LOGIN_TIMEOUT_S}s)")
    if open_browser:
        webbrowser.open(authorize_url)
    else:
        print("\nOpen this URL to sign in:\n\n" + authorize_url + "\n")

    deadline = time.time() + _LOGIN_TIMEOUT_S
    try:
        while time.time() < deadline and not _CallbackHandler.captured:
            time.sleep(0.25)
    finally:
        server.shutdown()

    captured = _CallbackHandler.captured
    if not captured:
        raise RuntimeError("timed out waiting for the browser callback")
    if captured.get("error"):
        raise RuntimeError(
            f"gateway rejected login: {captured['error']} {captured.get('error_description', '')}"
        )
    if captured.get("state") != state:
        # Never redeem a code that arrived with a mismatched state (CSRF).
        raise RuntimeError("callback state mismatch — aborted without redeeming the code")

    body = _http_json(
        _auth_endpoint(base_url, "token"),
        body={"code": captured["code"], "code_verifier": verifier},
        timeout=30,
    )
    entry = _normalize_token_response(body)
    store = _load_store()
    store[base_url] = entry
    _save_store(store)
    return entry


class CredentialError(RuntimeError):
    """No usable credential; an interactive ``hermes a2a login`` is needed."""


def _fresh_access_token(base_url: str) -> str:
    """Return a live access token for ``base_url``, refreshing if stale.

    Refresh tokens rotate: the rotated pair is persisted before returning, or
    the credential would die on the next call.
    """
    base_url = base_url.rstrip("/")
    entry = stored_credential(base_url)
    if not entry:
        raise CredentialError(
            f"no gateway credential for {base_url}. Run: hermes a2a login <peer>"
        )
    if int(entry.get("expiresAt") or 0) > time.time() + _TOKEN_SKEW_S:
        return entry["accessToken"]

    refresh = entry.get("refreshToken") or ""
    if not refresh:
        raise CredentialError(
            f"stored credential for {base_url} has no refresh token. Run: hermes a2a login <peer>"
        )
    try:
        body = _http_json(
            _auth_endpoint(base_url, "refresh"),
            body={"refresh_token": refresh, "provider": entry.get("provider") or ""},
            timeout=30,
        )
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403):
            raise CredentialError(
                f"refresh rejected (HTTP {e.code}) — credential for {base_url} is dead. "
                f"Run: hermes a2a login <peer>"
            ) from e
        raise
    new_entry = _normalize_token_response(body, fallback_refresh=refresh)
    new_entry["provider"] = new_entry["provider"] or entry.get("provider", "")
    new_entry["userId"] = new_entry["userId"] or entry.get("userId", "")
    store = _load_store()
    store[base_url] = new_entry
    _save_store(store)
    return new_entry["accessToken"]


# --------------------------------------------------------------------------
# Conversation over the gateway WebSocket
# --------------------------------------------------------------------------

def _connect_ws(base_url: str, ticket: str):
    """Open the gateway WebSocket over an IPv4-resolved TLS socket.

    IPv4 is deliberate: the WSS route has been observed hanging at TCP connect
    over IPv6 while plain HTTPS to the same host worked (happy-eyeballs masks
    the broken route for urllib but not for a raw socket connect).
    """
    from websockets.sync.client import connect  # lazy: core dep, but import cost

    parsed = urllib.parse.urlsplit(base_url)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    if not infos:
        raise OSError(f"no IPv4 address for {host}")
    addr = infos[0][4]
    sock = socket.create_connection((str(addr[0]), int(addr[1])), timeout=30)

    ssl_context = None
    if parsed.scheme == "https":
        ssl_context = ssl.create_default_context()  # verifies cert + hostname

    ws_url = f"{'wss' if parsed.scheme == 'https' else 'ws'}://{parsed.netloc}"
    prefix = parsed.path.rstrip("/")
    ws_url += f"{prefix}/api/ws?ticket={urllib.parse.quote(ticket)}"

    return connect(
        ws_url,
        sock=sock,
        ssl=ssl_context,
        server_hostname=host if ssl_context else None,
        additional_headers={"User-Agent": _UA},
        open_timeout=30,
        close_timeout=10,
        max_size=16 * 1024 * 1024,
    )


def _rpc(ws, counter: list, method: str, params: dict, timeout: float = _RPC_TIMEOUT_S) -> dict:
    counter[0] += 1
    req_id = f"a2agw{counter[0]}"
    ws.send(json.dumps({"id": req_id, "method": method, "params": params}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            raw = ws.recv(timeout=max(0.5, deadline - time.time()))
        except TimeoutError:
            continue
        msg = json.loads(raw)
        if msg.get("id") == req_id:
            if msg.get("error"):
                raise RuntimeError(f"{method}: {json.dumps(msg['error'])[:300]}")
            return msg.get("result") or {}
        # Anything else is an event/notification for someone else — skip.
    raise TimeoutError(f"{method} timed out after {timeout}s")


def send_gateway_task(
    agent_label: str,
    peer: dict,
    message: str,
    session_title: str = "",
    resume_session_id: str = "",
) -> tuple[str, str, str]:
    """Send ``message`` to a hermes-gateway peer; wait for the reply.

    Returns ``(reply_text, session_id, state)`` — the session_id doubles as the
    context handle reported back to the caller (pass it back as
    ``resume_session_id`` to continue the same conversation on the peer).
    ``state`` is "completed" or "failed" to mirror the A2A short states.
    """
    base_url = str(peer.get("url") or "").rstrip("/")
    if not base_url:
        raise ValueError("peer has no url")
    timeout = int(peer.get("timeout") or 420)

    token = _fresh_access_token(base_url)

    # Tickets are single-use with a short TTL: mint immediately before connect.
    ticket_body = _http_json(
        _api_endpoint(base_url, "auth/ws-ticket"),
        body={},
        bearer=token,
        timeout=_TICKET_TIMEOUT_S,
    )
    ticket = str(ticket_body.get("ticket") or "")
    if not ticket:
        raise RuntimeError(f"ws-ticket mint failed: {json.dumps(ticket_body)[:200]}")

    ws = _connect_ws(base_url, ticket)
    counter = [0]
    session_id = ""
    try:
        # Continue the prior session when the caller passes one back; fall
        # back to a fresh session if the peer no longer accepts it (pruned,
        # archived, or an old id from before a peer reset).
        if resume_session_id:
            try:
                _rpc(ws, counter, "prompt.submit",
                     {"session_id": resume_session_id, "text": message}, timeout=60)
                session_id = resume_session_id
            except (RuntimeError, TimeoutError) as e:
                logger.info("a2a gateway: resume of %s failed (%s); starting fresh", resume_session_id, e)

        if not session_id:
            created = _rpc(ws, counter, "session.create", {"cols": 96, "source": "desktop"}, timeout=45)
            session_id = str(created.get("session_id") or "")
            if not session_id:
                raise RuntimeError(f"session.create returned no session_id: {json.dumps(created)[:200]}")

            # Title the session honestly — it is a durable record on the peer.
            try:
                _rpc(ws, counter, "session.title", {
                    "session_id": session_id,
                    "title": session_title or f"A2A from {socket.gethostname()}",
                }, timeout=15)
            except Exception:
                pass  # cosmetic

            _rpc(ws, counter, "prompt.submit", {"session_id": session_id, "text": message}, timeout=60)

        reply: Optional[str] = None
        state = "completed"
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                raw = ws.recv(timeout=min(30.0, max(0.5, deadline - time.time())))
            except TimeoutError:
                continue
            msg = json.loads(raw)
            params = msg.get("params") if msg.get("method") == "event" else msg
            if not isinstance(params, dict) or params.get("type") != "message.complete":
                continue
            msg_sid = params.get("session_id") or params.get("sid")
            if msg_sid not in (session_id, None):
                continue
            payload = params.get("payload") or {}
            reply = str(payload.get("text") or "")
            if payload.get("status") == "error":
                state = "failed"
            break

        if reply is None:
            raise TimeoutError(
                f"no reply from '{agent_label}' within {timeout}s (heavy queries can "
                f"exceed the default; raise the peer's 'timeout' in a2a_agents)"
            )
        return reply, session_id, state
    finally:
        try:
            if session_id:
                _rpc(ws, counter, "session.close", {"session_id": session_id}, timeout=10)
        except Exception:
            pass
        try:
            ws.close()
        except Exception:
            pass


# --------------------------------------------------------------------------
# CLI: hermes a2a login <peer> / hermes a2a status
# --------------------------------------------------------------------------

def _peer_url_from_config(peer_name: str) -> str:
    try:
        from hermes_cli.config import load_config
        cfg = load_config() or {}
    except Exception:
        cfg = {}
    entry = (cfg.get("a2a_agents") or {}).get(peer_name) or {}
    return str(entry.get("url") or "").rstrip("/")


def setup_cli(subparser) -> None:
    """argparse wiring for ``hermes a2a …`` (registered by the plugin)."""
    sub = subparser.add_subparsers(dest="a2a_cmd")

    login = sub.add_parser(
        "login",
        help="Sign in to a hermes-gateway A2A peer (one-time browser flow)",
    )
    login.add_argument("peer", help="peer name from a2a_agents, or a full https:// URL")
    login.add_argument("--provider", default="", help="auth provider id (omit to let the gateway pick)")
    login.add_argument("--no-browser", action="store_true", help="print the sign-in URL instead of opening a browser")

    sub.add_parser("status", help="Show stored hermes-gateway credentials (no secrets)")


def handle_cli(args) -> int:
    cmd = getattr(args, "a2a_cmd", None)
    if cmd == "login":
        target = args.peer
        base_url = target if target.startswith(("http://", "https://")) else _peer_url_from_config(target)
        if not base_url:
            print(
                f"Unknown peer '{target}': not a URL and not found under a2a_agents in config.yaml."
            )
            return 1
        try:
            entry = interactive_login(base_url, provider=args.provider, open_browser=not args.no_browser)
        except Exception as e:
            print(f"Login failed: {e}")
            return 1
        expiry = time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime(entry["expiresAt"]))
        print(f"Signed in to {base_url}")
        print(f"  user     : {entry['userId'] or '(not reported)'}")
        print(f"  expires  : {expiry} (auto-refreshed on use)")
        print(f"  refresh  : {'yes' if entry['refreshToken'] else 'NO — re-login will be needed'}")
        print(f"  store    : {_store_path()}")
        return 0

    if cmd == "status":
        store = _load_store()
        if not store:
            print(f"No gateway credentials stored ({_store_path()}).")
            return 0
        now = time.time()
        for url, entry in store.items():
            exp = int(entry.get("expiresAt") or 0)
            live = "live" if exp > now else "expired (auto-refresh on next use)"
            expiry = time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime(exp)) if exp else "?"
            print(f"{url}")
            print(f"  user: {entry.get('userId') or '?'}  access: {live}  expires: {expiry}")
            print(f"  refresh token: {'present' if entry.get('refreshToken') else 'MISSING'}")
        return 0

    print("Usage: hermes a2a login <peer|url> | hermes a2a status")
    return 1
