"""Deterministic stdio plugin for connection metadata protocol tests."""

import json
import sys

discoveries = 0
for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    params = request.get("params", {}).get("params", {})
    response = {"jsonrpc": "2.0", "id": request["id"]}
    if method == "get_connection_metadata":
        discoveries += 1
        case = params.get("extra", {}).get("case")
        if case == "missing":
            response["error"] = {"code": -32601, "message": "Unrecognized operation"}
        elif case == "failure":
            response["error"] = {
                "code": -32000,
                "message": "Authentication failed; method not found -32601 in diagnostic text",
            }
        elif case == "malformed":
            response["result"] = {"capabilities": {"schemas": "yes"}}
        elif case == "null":
            response["result"] = None
        else:
            postgres = "postgresql" in params.get("connection_uri", "")
            response["result"] = {
                "capabilities": {
                    "schemas": postgres,
                    "views": True,
                    "routines": False,
                    "identifier_quote": '"' if postgres else "`",
                    "sql_dialect": "postgres" if postgres else "mysql",
                    "manage_tables": False,
                },
                "data_types": [{
                    "name": "JSONB" if postgres else "JSON",
                    "category": "json",
                    "requires_length": False,
                    "requires_precision": False,
                }],
                "type_mappings": {"JSON": "JSONB" if postgres else "JSON"},
            }
    elif method == "get_databases":
        response["result"] = [str(discoveries)]
    elif method in ("get_create_table_sql", "get_create_foreign_key_sql"):
        response["result"] = [params.get("connection_uri", "no-connection-params")]
    elif method == "build_routine_call_sql":
        response["error"] = {"code": -32601, "message": "Method not found"}
    else:
        response["result"] = None
    print(json.dumps(response), flush=True)
