#!/usr/bin/env python3
"""Deterministic JSON-RPC fixture driver for Tabularis browser E2E tests."""

import json
import sys


def success(request_id: int, result: object) -> dict[str, object]:
    return {"jsonrpc": "2.0", "result": result, "id": request_id}


def error(request_id: int, message: str) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "error": {"code": -32601, "message": message},
        "id": request_id,
    }


def dispatch(request: dict[str, object]) -> dict[str, object]:
    request_id = request.get("id")
    if not isinstance(request_id, int):
        return error(0, "Invalid request id")

    method = request.get("method")
    if method in {"initialize", "ping", "test_connection"}:
        return success(request_id, None)
    if method == "get_databases":
        return success(request_id, ["fixture"])
    if method == "get_schemas":
        return success(request_id, [])
    if method == "get_tables":
        return success(request_id, [{"name": "plugin_fixture"}])
    if method == "execute_query":
        return success(
            request_id,
            {
                "columns": ["fixture"],
                "rows": [["driver-plugin-ok"]],
                "affected_rows": 0,
                "truncated": False,
                "pagination": {
                    "page": 1,
                    "page_size": 100,
                    "total_rows": 1,
                    "has_more": False,
                },
            },
        )
    return error(request_id, "Method not found")


for line in sys.stdin:
    try:
        message = dispatch(json.loads(line))
    except (TypeError, ValueError, json.JSONDecodeError) as exception:
        message = error(0, f"Invalid request: {exception}")
    print(json.dumps(message), flush=True)
