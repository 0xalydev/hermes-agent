"""Update-boundary shim for the retired ``hermes_cli.managed_uv``.

An already-running ``hermes update`` from a SHIPPED release imports these
names from the NEW tree after the checkout swap (the frozen surface in
``tests/compat/old_updater_surface.json`` proves which ones). The module
they lived in is gone — uv acquisition collapsed into ``installation.uv``
and the venv/SQLite repair machinery moved to ``hermes_cli.runtime_repair``
— but the names must keep answering or that one in-flight update dies on
a half-new tree.

Nothing in the current tree imports this module. Delete it when the frozen
surface is regenerated without these names (``scripts/
audit-old-updater-imports.py --freeze``, once no shipped release loads
them).
"""

from __future__ import annotations

from typing import Callable, Optional

# Old updaters that call ensure_uv() may follow up with repair-observer
# style callbacks or reload helpers; keep the repair surface importable
# from its historical home.
from hermes_cli.runtime_repair import (  # noqa: F401 — re-exports
    RuntimeRepairResult,
    _reload_hermes_constants,
    rebuild_venv,
    repair_vulnerable_runtime,
)


def ensure_uv(
    *,
    repair_observer: Optional[Callable[[RuntimeRepairResult], None]] = None,
) -> Optional[str]:
    """Old signature: resolve/provision uv, running the runtime repair the
    historical implementation coupled to a fresh bootstrap. Returns a plain
    ``str``/``None`` (the ``_UvResult`` tuple-compat wrapper predates every
    release that loads this shim)."""
    from installation.uv import ensure_uv as _ensure

    path = _ensure()
    if path:
        try:
            repair = repair_vulnerable_runtime()
            if repair_observer is not None:
                repair_observer(repair)
        except Exception:  # noqa: BLE001 — repair is best-effort here
            pass
    return path


def resolve_uv() -> Optional[str]:
    """Old signature: pure lookup, no provisioning."""
    from installation.uv import uv_path

    resolved = uv_path()
    return str(resolved) if resolved is not None else None


def update_managed_uv(
    *,
    repair_observer: Optional[Callable[[RuntimeRepairResult], None]] = None,
    force: bool = False,  # noqa: ARG001 — historical, convergence is idempotent
) -> Optional[str]:
    """Old signature: converge uv on the pin table, then repair."""
    return ensure_uv(repair_observer=repair_observer)
