#!/usr/bin/env python3
"""Deterministic provider fixture; no external services or account credentials."""
import json
import sys


def dispatch(request):
    method = request.get("method")
    params = request.get("params", {})
    if method in {"initialize", "ping", "test_connection"}:
        return None
    if method in {"get_databases", "get_schemas", "get_tables", "get_columns", "get_views", "get_routines", "get_triggers", "get_foreign_keys", "get_indexes", "get_schema_foreign_keys"}:
        return []
    if method == "extension":
        context = params.get("context", {})
        if context.get("plugin_id") != "e2e-provider":
            raise ValueError("Foreign plugin context")
        if params.get("method") != "provider_status":
            raise ValueError("Unsupported provider method")
        return {"marker": "provider-rpc-ok", "connectionId": context.get("connection_id"), "scope": context.get("scope"), "host": params.get("params", {}).get("host")}
    raise ValueError("Method not found")


for line in sys.stdin:
    request = json.loads(line)
    try:
        reply = {"jsonrpc": "2.0", "id": request["id"], "result": dispatch(request)}
    except ValueError as error:
        reply = {"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": str(error)}}
    print(json.dumps(reply), flush=True)
