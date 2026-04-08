/**
 * PeakFlowHelper — persistent sidecar for macOS native API access.
 *
 * Reads commands from stdin, executes them using macOS APIs,
 * and writes JSON results to stdout. Same pattern as the
 * PowerShell sidecar on Windows.
 *
 * Commands:
 *   active-window         → focused window info (JSON or "null")
 *   all-windows           → all visible windows (JSON array)
 *   all-windows <pid>     → windows filtered by PID
 *   app-windows <bid>     → windows filtered by bundle ID
 *   visible-apps          → deduplicated list of visible apps
 *   process-name <pid>    → app name + bundle ID for a PID
 *   mic-get-mute          → {"muted": true/false}
 *   mic-set-mute <0|1>    → {"muted": true/false}
 *   mic-toggle-mute       → {"muted": true/false}
 *   accessibility-check   → {"trusted": true/false}
 *   ping                  → "pong"
 *   exit                  → terminates
 */

import Foundation

// Flush stdout after every write
setbuf(stdout, nil)

func respond(_ json: String) {
    print(json)
    fflush(stdout)
}

func respondError(_ message: String) {
    let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
    respond("{\"error\":\"\(escaped)\"}")
}

// Main loop: read commands from stdin
while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }

    let parts = trimmed.split(separator: " ", maxSplits: 1)
    let command = String(parts[0])
    let arg = parts.count > 1 ? String(parts[1]) : nil

    switch command {
    case "active-window":
        if let info = getActiveWindow() {
            respond(info.toJSON())
        } else {
            respond("null")
        }

    case "all-windows":
        let pid = arg.flatMap { Int32($0) }
        let windows = getAllVisibleWindows(filterPid: pid)
        let jsonArray = windows.map { $0.toJSON() }.joined(separator: ",")
        respond("[\(jsonArray)]")

    case "app-windows":
        guard let bundleId = arg else {
            respondError("app-windows requires a bundle ID argument")
            continue
        }
        let windows = getWindowsForBundleId(bundleId)
        let jsonArray = windows.map { $0.toJSON() }.joined(separator: ",")
        respond("[\(jsonArray)]")

    case "visible-apps":
        let apps = getVisibleAppList()
        let jsonArray = apps.map { $0.toJSON() }.joined(separator: ",")
        respond("[\(jsonArray)]")

    case "process-name":
        guard let pidStr = arg, let pid = Int32(pidStr) else {
            respondError("process-name requires a PID argument")
            continue
        }
        if let info = getProcessInfo(pid: pid) {
            respond(info.toJSON())
        } else {
            respond("null")
        }

    case "mic-get-mute":
        let result = getMicMuteState()
        respond(result)

    case "mic-set-mute":
        let mute = arg == "1" || arg == "true"
        let result = setMicMute(muted: mute)
        respond(result)

    case "mic-toggle-mute":
        let result = toggleMicMute()
        respond(result)

    case "accessibility-check":
        let trusted = checkAccessibility()
        respond("{\"trusted\":\(trusted)}")

    case "ping":
        respond("\"pong\"")

    case "exit":
        exit(0)

    default:
        respondError("Unknown command: \(command)")
    }
}
