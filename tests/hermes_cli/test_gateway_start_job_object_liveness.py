"""Regression tests for #91675 hole 1: ``hermes gateway start`` printed ✓
after the 6s liveness poll even when the spawned gateway was still confined
in the parent's Windows Job Object — the child then died at job teardown
(no gateway.log line, no gateway.pid, no atexit record).

The fix has two halves, both exercised here with the REAL functions (the
Win32 probes are faked; the decision/reporting logic under test is pure
Python and identical on every host):

* ``_report_gateway_start`` refuses to print ✓ for a spawn that is provably
  doomed (parent in a job AND the child still inside a job after the
  CREATE_BREAKAWAY_FROM_JOB spawn), and instead prints an honest warning
  with the Scheduled-Task escape command.
* ``start()`` detects Job-Object confinement up front and, when the
  per-profile Scheduled Task exists, escapes via ``schtasks /Run`` (the
  #84409 primitive) — snapshotting pre-existing PIDs BEFORE ``/Run`` and
  polling 30s, per the live review notes on #84409/#91675.
"""

from __future__ import annotations

import pytest

from hermes_cli import gateway_windows


# ---------------------------------------------------------------------------
# _job_teardown_risk
# ---------------------------------------------------------------------------


def test_no_risk_when_parent_not_in_job(monkeypatch):
    """Plain-console parent: no job to tear down, child state irrelevant."""
    probes = []

    def fake_in_job(pid=None):
        probes.append(pid)
        return False if pid is None else True

    monkeypatch.setattr(gateway_windows, "_process_in_job", fake_in_job)
    assert gateway_windows._job_teardown_risk(4242) is False
    # The child must not even be probed once the parent is known to be free.
    assert probes == [None]


def test_risk_when_parent_and_child_both_in_job(monkeypatch):
    monkeypatch.setattr(
        gateway_windows, "_process_in_job", lambda pid=None: True
    )
    assert gateway_windows._job_teardown_risk(4242) is True


def test_no_risk_when_breakaway_worked(monkeypatch):
    """Parent in a job but the child escaped: breakaway took effect."""
    monkeypatch.setattr(
        gateway_windows,
        "_process_in_job",
        lambda pid=None: True if pid is None else False,
    )
    assert gateway_windows._job_teardown_risk(4242) is False


def test_unknown_child_state_is_not_reported_as_risk(monkeypatch):
    """OpenProcess denied etc. → None → don't scare the user on no evidence."""
    monkeypatch.setattr(
        gateway_windows,
        "_process_in_job",
        lambda pid=None: True if pid is None else None,
    )
    assert gateway_windows._job_teardown_risk(4242) is False


def test_process_in_job_returns_none_off_windows():
    """The ctypes probe must degrade to None (not raise) on POSIX hosts."""
    import sys

    if sys.platform != "win32":
        assert gateway_windows._process_in_job() is None
        assert gateway_windows._process_in_job(1) is None


# ---------------------------------------------------------------------------
# _report_gateway_start honesty
# ---------------------------------------------------------------------------


def test_report_refuses_checkmark_for_doomed_spawn(monkeypatch, capsys):
    """Child passed the 6s poll but is job-confined → warning, not ✓."""
    monkeypatch.setattr(
        gateway_windows, "_wait_for_gateway_ready", lambda *a, **k: [4242]
    )
    monkeypatch.setattr(gateway_windows, "_job_teardown_risk", lambda pid: True)
    monkeypatch.setattr(gateway_windows, "is_task_registered", lambda: True)
    monkeypatch.setattr(
        gateway_windows, "get_task_name", lambda: "Hermes_Gateway_alice"
    )

    gateway_windows._report_gateway_start("direct spawn (PID 4242)", spawned_pid=4242)

    out = capsys.readouterr().out
    assert "✓" not in out
    assert "Job Object" in out
    assert 'schtasks /Run /TN "Hermes_Gateway_alice"' in out


def test_report_doomed_spawn_without_task_points_at_install(monkeypatch, capsys):
    monkeypatch.setattr(
        gateway_windows, "_wait_for_gateway_ready", lambda *a, **k: [4242]
    )
    monkeypatch.setattr(gateway_windows, "_job_teardown_risk", lambda pid: True)
    monkeypatch.setattr(gateway_windows, "is_task_registered", lambda: False)

    gateway_windows._report_gateway_start("direct spawn (PID 4242)", spawned_pid=4242)

    out = capsys.readouterr().out
    assert "✓" not in out
    assert "hermes gateway install" in out


def test_report_prints_checkmark_when_no_job_risk(monkeypatch, capsys):
    """The normal path keeps the exact honest-✓ contract #86687 landed."""
    monkeypatch.setattr(
        gateway_windows, "_wait_for_gateway_ready", lambda *a, **k: [4242]
    )
    monkeypatch.setattr(gateway_windows, "_job_teardown_risk", lambda pid: False)

    gateway_windows._report_gateway_start("direct spawn (PID 4242)", spawned_pid=4242)

    out = capsys.readouterr().out
    assert "✓ Gateway started via direct spawn (PID 4242) (PID: 4242)" in out


def test_report_without_spawned_pid_keeps_legacy_behavior(monkeypatch, capsys):
    """Callers that don't pass spawned_pid (older shape) are unchanged."""
    monkeypatch.setattr(
        gateway_windows, "_wait_for_gateway_ready", lambda *a, **k: [7]
    )

    def boom(pid):  # must not be consulted at all
        raise AssertionError("job probe must not run without a spawned_pid")

    monkeypatch.setattr(gateway_windows, "_job_teardown_risk", boom)
    gateway_windows._report_gateway_start("direct spawn (PID 7)")
    assert "✓" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# _start_via_scheduled_task (the /Run escape)
# ---------------------------------------------------------------------------


def _wire_schtasks(monkeypatch, *, run_code=0, pre, ready, events=None):
    events = events if events is not None else []

    def fake_gateway_pids():
        events.append("snapshot")
        return list(pre)

    def fake_exec(args):
        events.append(tuple(args[:2]))
        return (run_code, "", "" if run_code == 0 else "ERROR: denied")

    monkeypatch.setattr(gateway_windows, "_gateway_pids", fake_gateway_pids)
    monkeypatch.setattr(gateway_windows, "_exec_schtasks", fake_exec)
    monkeypatch.setattr(
        gateway_windows, "get_task_name", lambda: "Hermes_Gateway_alice"
    )

    def fake_ready(timeout_s=6.0, interval_s=0.4):
        events.append(("poll", timeout_s))
        return list(ready)

    monkeypatch.setattr(gateway_windows, "_wait_for_gateway_ready", fake_ready)
    return events


def test_schtasks_run_success_reports_new_pid(monkeypatch, capsys):
    events = _wire_schtasks(monkeypatch, pre=[], ready=[555])
    assert gateway_windows._start_via_scheduled_task() is True
    out = capsys.readouterr().out
    assert "✓ Gateway started via Scheduled Task (PID: 555)" in out
    # Review note from #84409: the PID snapshot must happen BEFORE /Run.
    assert events.index("snapshot") < events.index(("/Run", "/TN"))
    # Review note from #84409/#91675: 6s is too short (~13s to first log
    # line via Task Scheduler) — the escape path polls 30s.
    poll = [e for e in events if isinstance(e, tuple) and e[0] == "poll"][0]
    assert poll[1] == pytest.approx(30.0)


def test_schtasks_run_preexisting_pid_does_not_count(monkeypatch, capsys):
    """A still-draining pre-existing gateway must not satisfy the check."""
    _wire_schtasks(monkeypatch, pre=[555], ready=[555])
    assert gateway_windows._start_via_scheduled_task() is False
    assert "✓" not in capsys.readouterr().out


def test_schtasks_run_failure_returns_false(monkeypatch, capsys):
    _wire_schtasks(monkeypatch, run_code=1, pre=[], ready=[555])
    assert gateway_windows._start_via_scheduled_task() is False
    assert "✓" not in capsys.readouterr().out


# ---------------------------------------------------------------------------
# start(): job-confined parent prefers the Scheduled-Task escape
# ---------------------------------------------------------------------------


def _wire_start(monkeypatch, *, in_job, task_installed, schtasks_ok):
    calls = []
    monkeypatch.setattr(gateway_windows, "_assert_windows", lambda: None)
    monkeypatch.setattr(gateway_windows, "_gateway_pids", lambda: [])
    monkeypatch.setattr(
        gateway_windows, "is_task_registered", lambda: task_installed
    )
    monkeypatch.setattr(
        gateway_windows, "is_startup_entry_installed", lambda: True
    )
    monkeypatch.setattr(
        gateway_windows, "_process_in_job", lambda pid=None: in_job
    )
    monkeypatch.setattr(
        gateway_windows,
        "_start_via_scheduled_task",
        lambda *a, **k: calls.append("schtasks") or schtasks_ok,
    )
    monkeypatch.setattr(
        gateway_windows,
        "_spawn_detached",
        lambda *a, **k: calls.append("spawn") or 4242,
    )
    monkeypatch.setattr(
        gateway_windows,
        "_report_gateway_start",
        lambda via, spawned_pid=None: calls.append(("report", spawned_pid)),
    )
    return calls


def test_start_in_job_uses_scheduled_task_escape(monkeypatch):
    calls = _wire_start(monkeypatch, in_job=True, task_installed=True, schtasks_ok=True)
    gateway_windows.start()
    assert calls == ["schtasks"]  # no direct spawn inside the doomed job


def test_start_in_job_falls_back_to_direct_spawn(monkeypatch, capsys):
    calls = _wire_start(monkeypatch, in_job=True, task_installed=True, schtasks_ok=False)
    gateway_windows.start()
    assert calls == ["schtasks", "spawn", ("report", 4242)]
    assert "falling back to direct spawn" in capsys.readouterr().out


def test_start_outside_job_keeps_direct_spawn(monkeypatch):
    """Plain-console starts are unchanged — no schtasks detour."""
    calls = _wire_start(monkeypatch, in_job=False, task_installed=True, schtasks_ok=True)
    gateway_windows.start()
    assert calls == ["spawn", ("report", 4242)]


def test_start_in_job_without_task_uses_direct_spawn(monkeypatch):
    """No Scheduled Task to /Run → direct spawn; honesty is handled by
    _report_gateway_start's job-risk check."""
    calls = _wire_start(monkeypatch, in_job=True, task_installed=False, schtasks_ok=True)
    gateway_windows.start()
    assert calls == ["spawn", ("report", 4242)]


# ---------------------------------------------------------------------------
# Live Windows E2E: a REAL job-confined child must not earn a ✓
# ---------------------------------------------------------------------------

_LIVE_CHILD_SRC = r"""
import os
import subprocess
import sys
import time

time.sleep(0.7)  # let the parent AssignProcessToJobObject() us first
sys.path.insert(0, sys.argv[1])
from hermes_cli import gateway_windows as gw

flags_breakaway = 0x01000000 | 0x08000000 | 0x00000200  # BREAKAWAY|NO_WINDOW|NEW_GROUP
flags_fallback = 0x08000000 | 0x00000200
sleeper = [sys.executable, "-c", "import time; time.sleep(120)"]
try:
    grand = subprocess.Popen(sleeper, creationflags=flags_breakaway)
    fell_back = False
except OSError:
    # Job denies breakaway — exactly _spawn_detached()'s fallback path.
    grand = subprocess.Popen(sleeper, creationflags=flags_fallback)
    fell_back = True
try:
    print("FELL_BACK", fell_back)
    print("PARENT_IN_JOB", gw._process_in_job())
    print("CHILD_IN_JOB", gw._process_in_job(grand.pid))
    print("RISK", gw._job_teardown_risk(grand.pid))
    gw._wait_for_gateway_ready = lambda *a, **k: [grand.pid]
    gw.is_task_registered = lambda: False
    print("---REPORT---")
    gw._report_gateway_start(
        f"direct spawn (PID {grand.pid})", spawned_pid=grand.pid
    )
    print("---END---")
finally:
    grand.kill()
"""


@pytest.mark.windows_only
def test_live_job_confined_spawn_never_earns_checkmark(tmp_path):
    """End-to-end on a real Windows kernel: put a child CLI inside a Job
    Object that denies breakaway, let it spawn a 'gateway' grandchild the
    same way ``_spawn_detached`` does, and assert the fixed reporter refuses
    the ✓ for the job-confined grandchild (#91675).
    """
    import ctypes
    import subprocess
    import sys
    from pathlib import Path

    kernel32 = ctypes.windll.kernel32
    hjob = kernel32.CreateJobObjectW(None, None)
    assert hjob, "CreateJobObjectW failed"

    # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE via JobObjectExtendedLimitInformation
    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", ctypes.c_uint32),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", ctypes.c_uint32),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", ctypes.c_uint32),
            ("SchedulingClass", ctypes.c_uint32),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
        )]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
    assert kernel32.SetInformationJobObject(
        hjob, 9, ctypes.byref(info), ctypes.sizeof(info)
    ), "SetInformationJobObject failed"

    repo_root = str(Path(__file__).resolve().parents[2])
    child = subprocess.Popen(
        [sys.executable, "-c", _LIVE_CHILD_SRC, repo_root],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=repo_root,
    )
    try:
        # The child sleeps 0.7s before doing anything, so this lands first.
        assert kernel32.AssignProcessToJobObject(hjob, int(child._handle)), (
            "AssignProcessToJobObject failed"
        )
        out, _ = child.communicate(timeout=120)
    finally:
        kernel32.CloseHandle(hjob)
        if child.poll() is None:
            child.kill()

    assert child.returncode == 0, out
    assert "PARENT_IN_JOB True" in out, out
    assert "CHILD_IN_JOB True" in out, out
    assert "RISK True" in out, out
    report = out.split("---REPORT---", 1)[1].split("---END---", 1)[0]
    assert "✓" not in report, out
    assert "Job Object" in report, out
