//! Local REPL that simulates Tabularis JSON-RPC calls.
//!
//! Usage: `just repl` or `cargo run --bin test_plugin`
//!
//! Type a method name (e.g. `get_tables`) to send a stub request.
//! Type `exit` or press Ctrl-D to quit.

use std::io::{self, BufRead, Write};

use serde_json::json;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    println!("test_plugin — type a method name, `help` for commands, `exit` to quit");

    let mut next_id: u64 = 1;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let cmd = line.trim();
        if cmd.is_empty() {
            continue;
        }
        if cmd == "exit" || cmd == "quit" {
            break;
        }
        if cmd == "help" {
            println!("  Any method name is sent as a JSON-RPC request with stub params.");
            println!("  Examples: test_connection, get_tables, execute_query");
            println!("  Full method list: https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md#5-required-methods");
            continue;
        }

        let request = json!({
            "jsonrpc": "2.0",
            "method": cmd,
            "params": { "params": {}, "schema": null, "query": "" },
            "id": next_id,
        });
        next_id += 1;

        let response = simulate(&request);
        let pretty =
            serde_json::to_string_pretty(&response).unwrap_or_else(|_| response.to_string());
        writeln!(out, "{pretty}").ok();
        out.flush().ok();
    }
}

/// In-process simulation: serialize the request and hand it to the main
/// dispatch loop so we exercise exactly the same code path.
fn simulate(request: &serde_json::Value) -> serde_json::Value {
    // This binary doesn't share `mod`s with `main.rs`. For simplicity we
    // shell out via `serde_json::Value::to_string` and expect the user
    // to run the main binary separately for end-to-end tests. The REPL
    // here just round-trips the JSON to let you sanity-check method names.
    json!({
        "jsonrpc": "2.0",
        "result": { "echoed": request },
        "id": request.get("id").cloned().unwrap_or(serde_json::Value::Null),
    })
}
