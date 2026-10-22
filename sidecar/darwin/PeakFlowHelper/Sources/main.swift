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
 *   raise-app <pid>       → bring every open window of that app to the front
 *   activate <pid>        → make that app the frontmost app
 *   visible-apps          → deduplicated list of visible apps
 *   process-name <pid>    → app name + bundle ID for a PID
 *   accessibility-check   → {"trusted": true/false}
 *   paste                 → {"ok": bool, "trusted": bool}  (Cmd+V via CGEvent)
 *   ocr <path>            → {"text": "..."}               (Apple Vision)
 *
 * Request IDs: a line may start with a numeric ID ("17 active-window"). The
 * reply is then prefixed with the same ID ("17 {...}"), so the Node side can
 * pair replies with requests even after it gave up on a slow one. Lines
 * without an ID get a bare reply (handy for manual testing).
 *
 * One-shot mode: `peakflow-helper <command> [arg]` runs one command, prints
 * its JSON result and exits (used for paste and OCR so a slow OCR never
 * blocks the 60fps window polling on the persistent process).
 *   sg-front / sg-windows / sg-set / sg-raise / sg-tiling → SnapGrid (SnapGrid.swift)
 *   drag-watch            → (one-shot mode only) long-running window-drag watcher
 *   ping                  → "pong"
 *   exit                  → terminates
 */

import Foundation

// Flush stdout after every write
setbuf(stdout, nil)

/// ID of the request being answered (persistent mode), echoed before the reply.
var currentRequestId: String? = nil

func respond(_ json: String) {
    if let id = currentRequestId {
        print("\(id) \(json)")
    } else {
        print(json)
    }
    fflush(stdout)
}

func respondError(_ message: String) {
    respond(jsonString(["error": message]))
}

func runOneShot(_ command: String, _ arg: String?) -> String? {
    switch command {
    case "paste":
        return pasteCmdV()
    case "ocr":
        guard let path = arg else { return jsonLine(["text": "", "error": "ocr requires a file path"]) }
        return recognizeText(path: path)
    case "accessibility-check":
        return jsonString(["trusted": checkAccessibility()])
    default:
        return nil
    }
}

let cliArgs = CommandLine.arguments
if cliArgs.count > 1 {
    if cliArgs[1] == "drag-watch" { runDragWatch() }
    let arg = cliArgs.count > 2 ? cliArgs[2...].joined(separator: " ") : nil
    if let result = runOneShot(cliArgs[1], arg) {
        respond(result)
        exit(0)
    }
    respondError("Unknown command: \(cliArgs[1])")
    exit(1)
}

// Main loop: read commands from stdin
while let line = readLine(strippingNewline: true) {
    var trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }

    currentRequestId = nil
    if let first = trimmed.split(separator: " ", maxSplits: 1).first,
       first.allSatisfy({ $0.isASCII && $0.isNumber }) {
        currentRequestId = String(first)
        trimmed = String(trimmed.dropFirst(first.count)).trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            respondError("missing command")
            continue
        }
    }

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
        respond(jsonString(getAllVisibleWindows(filterPid: pid).map { $0.jsonObject }))

    case "raise-app":
        guard let pidStr = arg, let pid = Int32(pidStr), pid > 0 else {
            respondError("raise-app requires a PID argument")
            continue
        }
        respond(jsonString(["raised": raiseAppWindows(pid: pid)]))

    case "activate":
        guard let pidStr = arg, let pid = Int32(pidStr), pid > 0 else {
            respondError("activate requires a PID argument")
            continue
        }
        respond(jsonString(["ok": activateApp(pid: pid)]))

    case "app-windows":
        guard let bundleId = arg else {
            respondError("app-windows requires a bundle ID argument")
            continue
        }
        respond(jsonString(getWindowsForBundleId(bundleId).map { $0.jsonObject }))

    case "visible-apps":
        respond(jsonString(getVisibleAppList().map { $0.jsonObject }))

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

    case "accessibility-check":
        respond(jsonString(["trusted": checkAccessibility()]))

    case "paste":
        respond(pasteCmdV())

    case "ocr":
        respond(runOneShot("ocr", arg) ?? "{}")

    case "sg-front":
        respond(sgFront())

    case "sg-windows":
        respond(sgWindows())

    case "sg-set":
        respond(sgSet(arg))

    case "sg-raise":
        respond(sgRaise(arg))

    case "sg-tiling":
        respond(sgTiling())

    case "ping":
        respond("\"pong\"")

    case "exit":
        exit(0)

    default:
        respondError("Unknown command: \(command)")
    }
}
