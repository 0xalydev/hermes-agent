"""P5(b) at the CALLER: a connector egress decline must not fall back.

The adapter-level tests prove the decline REACHES the caller. These prove the
caller ACTS on it. Review round 1 blocker B-3: `_approval_send_outcome` had
only sent/failed/ambiguous, so a decline collapsed into `failed` — which is
precisely the cue to run the plain-text fallback into the chat the connector
had just refused. The adapter fix improved the error STRING while the
user-visible behaviour stayed identical to base.

These tests drive the real `gateway.run` classifier and the real
`tools.slash_confirm` registry; only the SendResult (the connector's answer)
is constructed.
"""

from __future__ import annotations

import concurrent.futures
from types import SimpleNamespace

import pytest

DECLINE_ERROR = (
    "discord egress declined: target is not an approved destination for this connection"
)
LANE_ERROR = "relay prompt op unavailable"


def _future(result):
    fut: concurrent.futures.Future = concurrent.futures.Future()
    fut.set_result(result)
    return fut


def _result(*, success: bool, error: str | None = None):
    return SimpleNamespace(success=success, error=error, message_id=None)


# ── the classifier ──────────────────────────────────────────────────────────


def test_decline_is_not_classified_as_failed():
    """`failed` is the fallback cue; a decline must not wear it."""
    from gateway.run import _approval_send_outcome

    outcome = _approval_send_outcome(
        _future(_result(success=False, error=DECLINE_ERROR)), timeout=5
    )
    assert outcome == "declined"


def test_genuine_lane_failure_still_falls_back():
    """The guard must not swallow real failures: those still re-ask."""
    from gateway.run import _approval_send_outcome

    outcome = _approval_send_outcome(
        _future(_result(success=False, error=LANE_ERROR)), timeout=5
    )
    assert outcome == "failed"


def test_success_and_timeout_verdicts_unchanged():
    """No collateral change to the two settled verdicts."""
    from gateway.run import _approval_send_outcome

    assert (
        _approval_send_outcome(_future(_result(success=True)), timeout=5) == "sent"
    )

    pending: concurrent.futures.Future = concurrent.futures.Future()
    assert _approval_send_outcome(pending, timeout=0.05) == "ambiguous"


@pytest.mark.parametrize(
    "error",
    [
        DECLINE_ERROR,
        "slack egress declined: destination not permitted",
        # Case-insensitivity is part of the contract (`.lower()` in
        # is_egress_decline), so a connector that capitalises still classifies.
        "WhatsApp Egress Declined: target refused",
    ],
)
def test_decline_recognised_across_lanes(error):
    """The verdict follows the decline CONTRACT, not one lane's wording.

    The contract is `EGRESS_DECLINE_MARKER` ("egress declined:") or a
    structured `code`; an invented sentence like "EGRESS_DECLINED: ..." is NOT
    a decline and must not be treated as one. My first version of this test
    asserted that invented form and failed — the test was wrong, not the code.
    """
    from gateway.run import _approval_send_outcome

    assert (
        _approval_send_outcome(_future(_result(success=False, error=error)), timeout=5)
        == "declined"
    )


def test_non_decline_error_text_is_not_laundered_into_declined():
    """Fail-closed the other way: only the real contract yields `declined`.

    Without this, a permissive marker check would silence genuine failures —
    turning a lane outage into a silent no-fallback.
    """
    from gateway.run import _approval_send_outcome

    for error in (
        "connection reset by peer",
        "declined",  # bare word, not the marker sentence
        "egress declined",  # no colon: not the uniform marker
    ):
        assert (
            _approval_send_outcome(
                _future(_result(success=False, error=error)), timeout=5
            )
            == "failed"
        ), error
