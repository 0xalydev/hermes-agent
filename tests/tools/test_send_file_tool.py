"""Tests for the send_file tool (sandbox & local extraction, size limits, security guards)."""

import base64
import json
import os
import stat
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from tools.registry import registry
from tools.send_file_tool import (
    SEND_FILE_SCHEMA,
    _DEFAULT_MAX_SEND_BYTES,
    _format_size,
    _extract_local_file,
    _extract_remote_file,
    send_file_tool,
)


class TestSendFileSchemaAndRegistry:
    def test_schema_structure(self):
        assert SEND_FILE_SCHEMA["name"] == "send_file"
        assert "path" in SEND_FILE_SCHEMA["parameters"]["properties"]
        assert "message" in SEND_FILE_SCHEMA["parameters"]["properties"]
        assert "path" in SEND_FILE_SCHEMA["parameters"]["required"]

    def test_registered_in_registry(self):
        tool = registry.get_entry("send_file")
        assert tool is not None
        assert tool.name == "send_file"
        assert tool.toolset == "file"
        assert tool.schema == SEND_FILE_SCHEMA
        assert tool.emoji == "📤"

    def test_format_size(self):
        assert _format_size(500) == "500 B"
        assert _format_size(2048) == "2.0 KB"
        assert _format_size(5 * 1024 * 1024) == "5.0 MB"


class TestSendFileLocal:
    def test_missing_path_argument(self):
        res = send_file_tool("")
        assert "missing required field 'path'" in res

        res_none = send_file_tool("   ")
        assert "missing required field 'path'" in res_none

    def test_blocked_device_path(self):
        res = send_file_tool("/dev/urandom")
        assert "access denied for device or proc path" in res

    def test_send_local_existing_file(self, tmp_path):
        sample_file = tmp_path / "chart.png"
        sample_data = b"\x89PNG\r\n\x1a\nfake-png-binary-data"
        sample_file.write_bytes(sample_data)

        with patch("tools.send_file_tool._get_file_ops") as mock_get_ops:
            mock_ops = MagicMock()
            mock_ops.env = MagicMock()
            mock_ops.env.is_local = True
            mock_get_ops.return_value = mock_ops

            res = send_file_tool(str(sample_file), message="Here is your requested chart")

            assert "File ready for delivery: chart.png" in res
            assert "Here is your requested chart" in res
            assert "MEDIA:" in res

            # Verify cached file was written
            media_path = res.split("MEDIA:")[1].strip()
            assert os.path.exists(media_path)
            assert Path(media_path).read_bytes() == sample_data

    def test_send_local_file_not_found(self, tmp_path):
        missing = tmp_path / "does_not_exist.pdf"
        with patch("tools.send_file_tool._get_file_ops") as mock_get_ops:
            mock_ops = MagicMock()
            mock_ops.env = MagicMock()
            mock_ops.env.is_local = True
            mock_get_ops.return_value = mock_ops

            res = send_file_tool(str(missing))
            assert "File not found" in res

    def test_send_local_directory_rejected(self, tmp_path):
        with patch("tools.send_file_tool._get_file_ops") as mock_get_ops:
            mock_ops = MagicMock()
            mock_ops.env = MagicMock()
            mock_ops.env.is_local = True
            mock_get_ops.return_value = mock_ops

            res = send_file_tool(str(tmp_path))
            assert "is a directory, not a regular file" in res

    def test_send_local_oversized_file(self, tmp_path):
        large_file = tmp_path / "huge.dat"
        with patch("os.stat") as mock_stat:
            stat_res = MagicMock()
            stat_res.st_mode = stat.S_IFREG
            stat_res.st_size = _DEFAULT_MAX_SEND_BYTES + 1024
            mock_stat.return_value = stat_res

            data, err = _extract_local_file(str(large_file), _DEFAULT_MAX_SEND_BYTES)
            assert data is None
            assert "exceeds the maximum allowed transfer size" in err

    @patch("tools.send_file_tool.get_read_block_error")
    def test_send_local_sensitive_path_blocked(self, mock_block_err, tmp_path):
        mock_block_err.return_value = "Sensitive configuration file blocked"

        with patch("tools.send_file_tool._get_file_ops") as mock_get_ops:
            mock_ops = MagicMock()
            mock_ops.env = MagicMock()
            mock_ops.env.is_local = True
            mock_get_ops.return_value = mock_ops

            res = send_file_tool("/home/user/.env")
            assert "access denied for protected path" in res
            assert "Sensitive configuration file blocked" in res


class TestSendFileRemoteSandbox:
    def test_send_remote_file_success(self):
        mock_ops = MagicMock()
        mock_ops.env = MagicMock()
        mock_ops.env.is_local = False
        mock_ops.cwd = "/workspace"

        raw_content = b"PDF-1.5 fake invoice report data"
        b64_content = base64.b64encode(raw_content).decode("ascii")

        def fake_exec(cmd: str):
            res = MagicMock()
            if "wc -c" in cmd or "__HERMES_DIR__" in cmd:
                res.returncode = 0
                res.output = f"{len(raw_content)}\n"
            elif "base64" in cmd:
                res.returncode = 0
                res.output = f"{b64_content}\n"
            else:
                res.returncode = 0
                res.output = ""
            return res

        mock_ops._exec.side_effect = fake_exec

        with patch("tools.send_file_tool._get_file_ops", return_value=mock_ops):
            res = send_file_tool("output/invoice.pdf", message="Your weekly invoice")

            assert "File ready for delivery: invoice.pdf" in res
            assert "Your weekly invoice" in res
            assert "MEDIA:" in res

            media_path = res.split("MEDIA:")[1].strip()
            assert os.path.exists(media_path)
            assert Path(media_path).read_bytes() == raw_content

    def test_send_remote_file_not_found(self):
        mock_ops = MagicMock()
        mock_ops.env = MagicMock()
        mock_ops.env.is_local = False

        def fake_exec(cmd: str):
            res = MagicMock()
            res.returncode = 0
            res.output = "__HERMES_NOT_FOUND__"
            return res

        mock_ops._exec.side_effect = fake_exec

        with patch("tools.send_file_tool._get_file_ops", return_value=mock_ops):
            res = send_file_tool("/workspace/missing.csv")
            assert "File not found in sandbox" in res

    def test_send_remote_directory_rejected(self):
        mock_ops = MagicMock()
        mock_ops.env = MagicMock()
        mock_ops.env.is_local = False

        def fake_exec(cmd: str):
            res = MagicMock()
            res.returncode = 0
            res.output = "__HERMES_DIR__"
            return res

        mock_ops._exec.side_effect = fake_exec

        with patch("tools.send_file_tool._get_file_ops", return_value=mock_ops):
            res = send_file_tool("/workspace/src")
            assert "is a directory in the sandbox" in res

    def test_send_remote_file_oversized(self):
        mock_ops = MagicMock()
        mock_ops.env = MagicMock()
        mock_ops.env.is_local = False

        def fake_exec(cmd: str):
            res = MagicMock()
            res.returncode = 0
            # 60 MB
            res.output = f"{60 * 1024 * 1024}\n"
            return res

        mock_ops._exec.side_effect = fake_exec

        data, err = _extract_remote_file(mock_ops, "/workspace/dump.tar", _DEFAULT_MAX_SEND_BYTES)
        assert data is None
        assert "exceeds the maximum allowed transfer size" in err

    def test_send_remote_extraction_failure(self):
        mock_ops = MagicMock()
        mock_ops.env = MagicMock()
        mock_ops.env.is_local = False

        def fake_exec(cmd: str):
            res = MagicMock()
            if "wc -c" in cmd:
                res.returncode = 0
                res.output = "1024\n"
            elif "base64" in cmd:
                res.returncode = 1
                res.output = "base64: error reading file: I/O error"
            return res

        mock_ops._exec.side_effect = fake_exec

        data, err = _extract_remote_file(mock_ops, "/workspace/corrupt.bin", _DEFAULT_MAX_SEND_BYTES)
        assert data is None
        assert "Failed to extract file" in err
