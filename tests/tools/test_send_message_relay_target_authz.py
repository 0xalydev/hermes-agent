"""P5(a): `send_message` cannot silently name an arbitrary relay target.

The `target` tool parameter is free-form (`'platform:chat_id'`), so before
this guard a model could name ANY chat id and the gateway would emit an
outbound relay frame for it — authenticating the sender while never
authorizing the destination. These tests drive the REAL `send_message_tool`
entrypoint through the REAL production wiring (`gateway.relay.egress`,
`gateway.channel_directory`, `gateway.relay.relay_fronted_platforms`) against
a temp HERMES_HOME; nothing under test is constructed by the test itself.
"""

from __future__ import annotations

import json

import pytest

from gateway.config import Platform
from tools.send_message_tool import send_message_tool

ATTESTED_CHAT = "111111111111111111"
ARBITRARY_CHAT = "999999999999999999"
HOME_CHAT = "222222222222222222"


@pytest.fixture
def relay_env(tmp_path, monkeypatch):
    """A gateway whose ONLY reachable Discord destinations are attested.

    Mirrors the production shape: `GATEWAY_RELAY_PLATFORMS` is the deploy
    stamp `gateway.relay.relay_fronted_platforms()` reads, the channel
    directory json is the file `channel_directory.load_directory()` reads, and
    no live native adapter exists in this process (so the relay owns egress
    for `discord`, exactly as `gateway/delivery.resolve_delivery_transport`
    decides it).
    """
    import gateway.channel_directory as cd

    monkeypatch.setenv("GATEWAY_RELAY_URL", "wss://connector.example/relay")
    monkeypatch.setenv("GATEWAY_RELAY_PLATFORMS", "discord")
    monkeypatch.setenv("GATEWAY_RELAY_BOT_IDS", json.dumps({"discord": {"botId": "b1"}}))

    directory = tmp_path / "channel_directory.json"
    directory.write_text(
        json.dumps(
            {
                "updated_at": None,
                "platforms": {
                    "discord": [
                        {"id": ATTESTED_CHAT, "name": "bot-home", "type": "channel"}
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cd, "DIRECTORY_PATH", directory)
    monkeypatch.setattr(cd, "CHANNEL_ALIASES_PATH", tmp_path / "channel_aliases.json")
    # No gateway-session origins for discord in this temp home.
    monkeypatch.setattr(cd, "_build_from_sessions", lambda _platform: [])
    return directory


def _send(target: str, sent):
    """Invoke the real tool, recording any egress it attempts."""
    from types import SimpleNamespace
    from unittest.mock import patch

    import asyncio

    discord_cfg = SimpleNamespace(enabled=True, token="t", extra={})
    config = SimpleNamespace(
        platforms={Platform.DISCORD: discord_cfg},
        get_home_channel=lambda _p: SimpleNamespace(chat_id=HOME_CHAT),
    )

    async def _record(platform, pconfig, chat_id, message, **kwargs):
        sent.append(chat_id)
        return {"success": True, "message_id": "m1"}

    with patch("gateway.config.load_gateway_config", return_value=config), patch(
        "tools.interrupt.is_interrupted", return_value=False
    ), patch("model_tools._run_async", side_effect=lambda c: asyncio.run(c)), patch(
        "tools.send_message_tool._send_to_platform", side_effect=_record
    ), patch(
        "gateway.mirror.mirror_to_session", return_value=False
    ):
        return json.loads(
            send_message_tool(
                {"action": "send", "target": target, "message": "hello"}
            )
        )


def test_arbitrary_relay_chat_id_is_refused_and_never_egresses(relay_env):
    """The whole observable: refused, naming THAT target, and ZERO egress."""
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result == {
        "error": (
            f"Refusing to send to unattested relay target 'discord:{ARBITRARY_CHAT}': "
            "this gateway has no record of that destination. Use "
            "send_message(action='list') to see the targets it can reach."
        )
    }
    assert sent == []


def test_attested_directory_chat_id_still_sends(relay_env):
    """The guard must not destroy the feature: an attested chat goes through."""
    sent: list[str] = []
    result = _send(f"discord:{ATTESTED_CHAT}", sent)

    assert result == {"success": True, "message_id": "m1"}
    assert sent == [ATTESTED_CHAT]


def test_home_channel_is_attested(relay_env):
    """The operator-configured home channel is a provenance, not a guess."""
    sent: list[str] = []
    result = _send("discord", sent)

    assert result["success"] is True
    assert sent == [HOME_CHAT]


def test_session_origin_chat_is_attested(relay_env, monkeypatch):
    """A chat this gateway actually holds a session in is reachable."""
    import gateway.channel_directory as cd

    monkeypatch.setattr(
        cd,
        "_build_from_sessions",
        lambda platform: (
            [{"id": ARBITRARY_CHAT, "name": "seen", "type": "channel"}]
            if platform == "discord"
            else []
        ),
    )
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result["success"] is True
    assert sent == [ARBITRARY_CHAT]


def test_platform_not_fronted_by_relay_is_untouched(relay_env, monkeypatch):
    """Non-relay platforms keep their own adapters' authorization, unchanged."""
    monkeypatch.setenv("GATEWAY_RELAY_PLATFORMS", "telegram")
    monkeypatch.setenv(
        "GATEWAY_RELAY_BOT_IDS", json.dumps({"telegram": {"botId": "b1"}})
    )
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result["success"] is True
    assert sent == [ARBITRARY_CHAT]


def test_live_native_adapter_takes_precedence_over_the_relay_guard(
    relay_env, monkeypatch
):
    """A platform served by a live NATIVE adapter here is not a relay egress.

    Same precedence `gateway/delivery.resolve_delivery_transport` applies: a
    concrete native adapter always wins over the relay, so this guard must not
    fire for it.
    """
    from types import SimpleNamespace

    import gateway.run

    runner = SimpleNamespace(adapters={Platform.DISCORD: object()})
    monkeypatch.setattr(gateway.run, "_gateway_runner_ref", lambda: runner)
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result["success"] is True
    assert sent == [ARBITRARY_CHAT]


def test_react_refuses_an_arbitrary_relay_target(relay_env):
    """Reactions are outbound acts too — same floor, same refusal."""
    result = json.loads(
        send_message_tool(
            {
                "action": "react",
                "target": f"discord:{ARBITRARY_CHAT}",
                "emoji": "👍",
            }
        )
    )
    assert result == {
        "error": (
            f"Refusing to send to unattested relay target 'discord:{ARBITRARY_CHAT}': "
            "this gateway has no record of that destination. Use "
            "send_message(action='list') to see the targets it can reach."
        )
    }
