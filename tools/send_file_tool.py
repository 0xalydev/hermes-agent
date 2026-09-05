#!/usr/bin/env python3
"""Send File Tool - Transfer files from local or sandboxed environments to users.

Extracts files generated inside sandboxed backends (Docker, SSH, Modal, Daytona,
Singularity, Vercel) or local execution environments to the host cache and delivers
them via the gateway's native MEDIA: attachment pipeline.
"""

import base64
import binascii
import logging
import os
import posixpath
import re
import shlex
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from agent.file_safety import get_read_block_error
from tools.file_tools import _get_file_ops, _is_blocked_device
from tools.file_tools_paths import _expand_tilde, _resolve_path_for_task
from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

# Default max file size for outbound transfer (50 MB matching platform upload limits).
_DEFAULT_MAX_SEND_BYTES = 50 * 1024 * 1024

SEND_FILE_SCHEMA = {
    "name": "send_file",
    "description": (
        "Send a file from the terminal environment to the user or messaging platform. "
        "Extracts generated files, reports, charts, documents, or data artifacts from local or "
        "sandboxed terminal environments (Docker, SSH, Modal, Singularity, Daytona, Vercel) "
        "and delivers them as native media attachments or download references."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "Path to the file inside the terminal environment to send "
                    "(e.g. '/workspace/report.pdf', 'output/chart.png', or 'data.csv')"
                ),
            },
            "message": {
                "type": "string",
                "description": "Optional caption or description message to accompany the file delivery",
            },
        },
        "required": ["path"],
    },
}


def _format_size(num_bytes: int) -> str:
    """Format bytes into a human-readable size string."""
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    return f"{num_bytes / (1024 * 1024):.1f} MB"


def _cache_extracted_bytes(data: bytes, filename: str) -> str:
    """Save raw file bytes to the host document/media cache and return the host path."""
    try:
        from gateway.platforms.base import cache_document_from_bytes

        return cache_document_from_bytes(data, filename)
    except Exception:
        # Fallback if gateway platform helper is not initialized (e.g. CLI standalone)
        from hermes_constants import get_hermes_dir
        import uuid

        cache_dir = get_hermes_dir("cache/documents", "document_cache")
        cache_dir.mkdir(parents=True, exist_ok=True)
        safe_name = Path(filename).name or "document"
        target = cache_dir / f"doc_{uuid.uuid4().hex[:12]}_{safe_name}"
        target.write_bytes(data)
        return str(target)


def _extract_local_file(resolved_path: str, max_bytes: int) -> Tuple[Optional[bytes], Optional[str]]:
    """Read a local file from the host filesystem."""
    try:
        st = os.stat(resolved_path)
        import stat

        st_mode = getattr(st, "st_mode", None)
        if isinstance(st_mode, int) and stat.S_ISDIR(st_mode) or (st_mode is None and os.path.isdir(resolved_path)):
            return None, f"'{resolved_path}' is a directory, not a regular file. Archive it into a .zip or .tar.gz first."
        if st.st_size > max_bytes:
            return None, f"File size ({_format_size(st.st_size)}) exceeds the maximum allowed transfer size ({_format_size(max_bytes)})."
        with open(resolved_path, "rb") as f:
            data = f.read()
        return data, None
    except FileNotFoundError:
        return None, f"File not found: '{resolved_path}'"
    except PermissionError:
        return None, f"Permission denied reading file: '{resolved_path}'"
    except OSError as exc:
        return None, f"Failed to read file '{resolved_path}': {exc}"


def _extract_remote_file(file_ops, remote_path: str, max_bytes: int) -> Tuple[Optional[bytes], Optional[str]]:
    """Extract a file from a sandboxed or remote terminal backend via shell execution."""
    quoted = shlex.quote(remote_path)
    # Probe existence, type, and size in one compound command
    probe_cmd = (
        f'if [ -d {quoted} ]; then echo "__HERMES_DIR__"; '
        f'elif [ -f {quoted} ]; then wc -c < {quoted}; '
        f'else echo "__HERMES_NOT_FOUND__"; fi'
    )
    res = file_ops._exec(probe_cmd)
    output = (res.output or "").strip()

    if "__HERMES_NOT_FOUND__" in output or res.returncode != 0 and not output:
        return None, f"File not found in sandbox: '{remote_path}'"
    if "__HERMES_DIR__" in output:
        return None, f"'{remote_path}' is a directory in the sandbox, not a regular file. Archive it into a .zip or .tar.gz first."

    # Parse file size from wc -c digits
    match = re.search(r"\b(\d+)\b", output)
    if match:
        size = int(match.group(1))
        if size > max_bytes:
            return None, f"File size ({_format_size(size)}) exceeds the maximum allowed transfer size ({_format_size(max_bytes)})."

    # Extract bytes as base64
    b64_cmd = f"base64 -w 0 {quoted} 2>/dev/null || base64 {quoted}"
    b64_res = file_ops._exec(b64_cmd)
    if b64_res.returncode != 0 or not b64_res.output:
        return None, f"Failed to extract file '{remote_path}' from sandbox: {b64_res.output or 'empty output'}"

    # Clean whitespace and decode
    clean_b64 = re.sub(r"\s+", "", b64_res.output)
    try:
        raw_bytes = base64.b64decode(clean_b64)
        return raw_bytes, None
    except (binascii.Error, ValueError) as exc:
        return None, f"Failed to decode base64 file data for '{remote_path}': {exc}"


def send_file_tool(path: str, message: Optional[str] = None, task_id: str = "default") -> str:
    """Core implementation of the send_file tool."""
    if not path or not isinstance(path, str) or not path.strip():
        return tool_error("send_file: missing required field 'path'. Specify the file path to send.")

    raw_path = path.strip()

    # Security check: prevent exfiltration of internal credential/secret files
    if _is_blocked_device(raw_path):
        return tool_error(f"send_file: access denied for device or proc path '{raw_path}'.")

    # Obtain the file operations manager for the active task environment
    file_ops = _get_file_ops(task_id)
    env = getattr(file_ops, "env", None)
    is_local = getattr(env, "is_local", False) or env is None

    filename = Path(raw_path).name or "file"

    if is_local:
        try:
            resolved = str(_resolve_path_for_task(raw_path, task_id))
        except Exception:
            resolved = os.path.abspath(_expand_tilde(raw_path))

        # Check sensitive paths on host
        sec_err = get_read_block_error(resolved)
        if sec_err:
            return tool_error(f"send_file: access denied for protected path '{raw_path}': {sec_err}")

        data, err = _extract_local_file(resolved, _DEFAULT_MAX_SEND_BYTES)
        if err:
            return tool_error(f"send_file: {err}")

        cached_host_path = _cache_extracted_bytes(data, filename)
    else:
        # Remote / Sandbox environment
        remote_path = raw_path
        if not remote_path.startswith("/") and not remote_path.startswith("~"):
            cwd = getattr(file_ops, "cwd", "/workspace") or "/workspace"
            remote_path = posixpath.normpath(posixpath.join(cwd, remote_path))

        # Check sensitive path patterns
        sec_err = get_read_block_error(remote_path)
        if sec_err:
            return tool_error(f"send_file: access denied for protected path '{remote_path}': {sec_err}")

        data, err = _extract_remote_file(file_ops, remote_path, _DEFAULT_MAX_SEND_BYTES)
        if err:
            return tool_error(f"send_file: {err}")

        cached_host_path = _cache_extracted_bytes(data, filename)

    size_str = _format_size(len(data))
    caption = f"{message.strip()}\n\n" if message and message.strip() else ""
    return f"File ready for delivery: {filename} ({size_str})\n{caption}MEDIA:{cached_host_path}"


def _handle_send_file(args: Dict[str, Any], **kw) -> str:
    tid = kw.get("task_id") or "default"
    return send_file_tool(
        path=args.get("path", ""),
        message=args.get("message"),
        task_id=tid,
    )


def _check_send_file_reqs() -> Tuple[bool, str]:
    return True, ""


# Register tool with central Hermes registry
registry.register(
    name="send_file",
    toolset="file",
    schema=SEND_FILE_SCHEMA,
    handler=_handle_send_file,
    check_fn=_check_send_file_reqs,
    emoji="📤",
    max_result_size_chars=10_000,
)
