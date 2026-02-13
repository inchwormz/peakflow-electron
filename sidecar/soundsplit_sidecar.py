"""
SoundSplit Sidecar — Python WASAPI audio control service.

JSON-RPC 2.0 over stdin/stdout protocol.
Spawned by Electron main process, communicates via stdio.

Methods:
  - get_sessions: Returns list of active audio sessions
  - set_volume:   Set volume for a session by PID
  - set_mute:     Mute/unmute a session by PID
  - get_master:   Get master volume + peak level
  - set_master:   Set master volume

Dependencies: pycaw, comtypes, psutil (see requirements.txt)

NOTE: This is a stub/placeholder. The actual implementation will be
built in a follow-up phase when we integrate the real WASAPI calls.
"""

import sys
import json


def handle_request(request: dict) -> dict:
    """Process a JSON-RPC 2.0 request and return a response."""
    method = request.get("method", "")
    params = request.get("params", {})
    req_id = request.get("id")

    if method == "get_sessions":
        # Stub: return empty list until real pycaw integration
        return {"jsonrpc": "2.0", "result": [], "id": req_id}

    elif method == "set_volume":
        # Stub: acknowledge but do nothing
        return {"jsonrpc": "2.0", "result": True, "id": req_id}

    elif method == "set_mute":
        # Stub: acknowledge but do nothing
        return {"jsonrpc": "2.0", "result": True, "id": req_id}

    elif method == "get_master":
        # Stub: return default master volume
        return {
            "jsonrpc": "2.0",
            "result": {"volume": 1.0, "peak": 0.0},
            "id": req_id,
        }

    elif method == "set_master":
        # Stub: acknowledge but do nothing
        return {"jsonrpc": "2.0", "result": True, "id": req_id}

    else:
        return {
            "jsonrpc": "2.0",
            "error": {"code": -32601, "message": f"Method not found: {method}"},
            "id": req_id,
        }


def main():
    """Main loop: read JSON-RPC requests from stdin, write responses to stdout."""
    # Signal ready
    ready_msg = json.dumps({"jsonrpc": "2.0", "method": "ready", "params": {}})
    sys.stdout.write(ready_msg + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            error_response = {
                "jsonrpc": "2.0",
                "error": {"code": -32700, "message": "Parse error"},
                "id": None,
            }
            sys.stdout.write(json.dumps(error_response) + "\n")
            sys.stdout.flush()
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
