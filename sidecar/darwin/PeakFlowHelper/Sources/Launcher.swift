/**
 * Launcher support (macOS): snippet expansion, selected text, quitting apps,
 * locking the screen and handing focus back to the previous app.
 *
 * One-shot commands (see runOneShot in main.swift):
 *   activate-previous      → {"ok": bool}       bring back the app the user was in
 *   selection [ax]         → {"text": "...", "via": "ax"|"copy"|"none", "trusted": bool}
 *                            ("ax": Accessibility only, never touches the clipboard or focus)
 *   quit-app <pid>         → {"ok": bool}       NSRunningApplication.terminate()
 *   force-quit-app <pid>   → {"ok": bool}       NSRunningApplication.forceTerminate()
 *   running-apps           → [{pid, name, bundleId, path}]  regular (Dock) apps
 *   lock                   → {"ok": bool}
 *
 * Long-running mode: `peakflow-helper keywatch` watches typing for snippet
 * keywords. It reads one JSON line per update from stdin,
 *   {"snippets": {"<keyword>": "<text>", ...}}
 * and when a keyword is typed it deletes the keyword and pastes the text
 * (clipboard saved and restored around the paste). It prints
 * {"e": "ready", "trusted": bool} at start and {"e": "expanded", "keyword": "..."}
 * after each expansion. Typed text never leaves this process: only the
 * keyword that matched is reported.
 */

import Cocoa
import ApplicationServices

// MARK: - previous app

/// The app the user was in before PeakFlow: the frontmost on-screen normal
/// window that doesn't belong to PeakFlow (our parent process).
private func previousApp() -> NSRunningApplication? {
    let peakflowPid = getppid()
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for info in windows {
        guard let pid = info[kCGWindowOwnerPID as String] as? Int32, pid != peakflowPid else { continue }
        if let layer = info[kCGWindowLayer as String] as? Int, layer != 0 { continue }
        guard let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular else { continue }
        return app
    }
    return nil
}

func activatePrevious() -> String {
    guard let app = previousApp() else { return jsonLine(["ok": false]) }
    return jsonLine(["ok": app.activate(options: [])])
}

// MARK: - pasteboard save / restore

/// Every item on the general pasteboard, with every type's data, so a
/// simulated copy or paste can put back exactly what the user had.
private func savePasteboard() -> [[NSPasteboard.PasteboardType: Data]] {
    let pb = NSPasteboard.general
    return (pb.pasteboardItems ?? []).map { item in
        var types: [NSPasteboard.PasteboardType: Data] = [:]
        for t in item.types {
            if let d = item.data(forType: t) { types[t] = d }
        }
        return types
    }
}

private func restorePasteboard(_ saved: [[NSPasteboard.PasteboardType: Data]]) {
    let pb = NSPasteboard.general
    pb.clearContents()
    let items: [NSPasteboardItem] = saved.map { types in
        let item = NSPasteboardItem()
        for (t, d) in types { item.setData(d, forType: t) }
        return item
    }
    if !items.isEmpty { pb.writeObjects(items) }
}

/// Our own synthetic key events carry this tag so the keyword watcher ignores them.
private let syntheticTag: Int64 = 0x5046_4C4E // "PFLN"

private func postKey(_ key: CGKeyCode, flags: CGEventFlags = []) {
    let source = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) else { return }
    down.flags = flags
    up.flags = flags
    down.setIntegerValueField(.eventSourceUserData, value: syntheticTag)
    up.setIntegerValueField(.eventSourceUserData, value: syntheticTag)
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

// MARK: - selected text

/// Selected text in the previous app. Tries the Accessibility API first (no
/// clipboard, no focus change); apps that don't expose it (browsers,
/// Electron apps) get a simulated Cmd+C with the clipboard put back after.
func selectedText(axOnly: Bool = false) -> String {
    guard AXIsProcessTrusted() else { return jsonLine(["text": "", "via": "none", "trusted": false]) }
    guard let app = previousApp() else { return jsonLine(["text": "", "via": "none", "trusted": true]) }

    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    var focused: CFTypeRef?
    if AXUIElementCopyAttributeValue(axApp, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
       let el = focused {
        var selected: CFTypeRef?
        // swiftlint:disable:next force_cast
        if AXUIElementCopyAttributeValue(el as! AXUIElement, kAXSelectedTextAttribute as CFString, &selected) == .success,
           let s = selected as? String, !s.isEmpty {
            return jsonLine(["text": s, "via": "ax", "trusted": true])
        }
    }

    if axOnly { return jsonLine(["text": "", "via": "none", "trusted": true]) }

    // Fallback: copy in the previous app, read, restore the clipboard
    app.activate(options: [])
    usleep(120_000)
    let pb = NSPasteboard.general
    let saved = savePasteboard()
    let before = pb.changeCount
    postKey(8, flags: .maskCommand) // kVK_ANSI_C
    var text = ""
    for _ in 0..<25 { // up to ~500 ms for the app to answer
        usleep(20_000)
        if pb.changeCount != before {
            text = pb.string(forType: .string) ?? ""
            break
        }
    }
    if pb.changeCount != before { restorePasteboard(saved) }
    return jsonLine(["text": text, "via": text.isEmpty ? "none" : "copy", "trusted": true])
}

// MARK: - apps

func runningApps() -> String {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && $0.processIdentifier != getppid() }
    return jsonString(apps.map { app -> [String: Any] in
        [
            "pid": Int(app.processIdentifier),
            "name": app.localizedName ?? "",
            "bundleId": app.bundleIdentifier ?? "",
            "path": app.bundleURL?.path ?? ""
        ]
    })
}

func quitApp(pid: Int32, force: Bool) -> String {
    guard pid > 1, pid != getppid(), let app = NSRunningApplication(processIdentifier: pid) else {
        return jsonLine(["ok": false])
    }
    return jsonLine(["ok": force ? app.forceTerminate() : app.terminate()])
}

// MARK: - lock

func lockScreen() -> String {
    // The login framework's SACLockScreenImmediate is what the menu-bar "Lock
    // Screen" item calls; fall back to the Ctrl+Cmd+Q shortcut if it's missing.
    typealias LockFn = @convention(c) () -> Int32
    if let handle = dlopen("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", RTLD_NOW),
       let sym = dlsym(handle, "SACLockScreenImmediate") {
        let fn = unsafeBitCast(sym, to: LockFn.self)
        _ = fn()
        return jsonLine(["ok": true])
    }
    guard AXIsProcessTrusted() else { return jsonLine(["ok": false, "trusted": false]) }
    postKey(12, flags: [.maskCommand, .maskControl]) // kVK_ANSI_Q
    return jsonLine(["ok": true])
}

// MARK: - snippet keyword watcher

private var snippets: [String: String] = [:]
private var maxKeywordLength = 0
private var typed = ""
private var keywatchTap: CFMachPort?

private func emit(_ obj: [String: Any]) {
    print(jsonString(obj))
    fflush(stdout)
}

/// {date}, {time} and {clipboard} placeholders, filled at expansion time.
private func fill(_ text: String, clipboard: String) -> String {
    var out = text
    if out.contains("{date}") {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        out = out.replacingOccurrences(of: "{date}", with: f.string(from: Date()))
    }
    if out.contains("{time}") {
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .short
        out = out.replacingOccurrences(of: "{time}", with: f.string(from: Date()))
    }
    if out.contains("{clipboard}") {
        out = out.replacingOccurrences(of: "{clipboard}", with: clipboard)
    }
    return out
}

private func expand(keyword: String, text: String) {
    // Runs after the keyword's last key event has been delivered
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) {
        for _ in 0..<keyword.count { postKey(51) } // kVK_Delete (backspace)
        let pb = NSPasteboard.general
        let saved = savePasteboard()
        let current = pb.string(forType: .string) ?? ""
        pb.clearContents()
        pb.setString(fill(text, clipboard: current), forType: .string)
        usleep(30_000)
        postKey(9, flags: .maskCommand) // kVK_ANSI_V
        // Give the app time to read the clipboard before putting the old one back
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            restorePasteboard(saved)
        }
        emit(["e": "expanded", "keyword": keyword])
    }
}

private let keywatchCallback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = keywatchTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == syntheticTag {
        return Unmanaged.passUnretained(event)
    }
    if type == .leftMouseDown || type == .rightMouseDown {
        typed = ""
        return Unmanaged.passUnretained(event)
    }
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }

    let flags = event.flags
    if flags.contains(.maskCommand) || flags.contains(.maskControl) {
        typed = ""
        return Unmanaged.passUnretained(event)
    }
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    switch keyCode {
    case 51: // backspace
        if !typed.isEmpty { typed.removeLast() }
        return Unmanaged.passUnretained(event)
    case 36, 48, 53, 76, 123, 124, 125, 126, 115, 116, 119, 121: // return, tab, esc, enter, arrows, home/end/page
        typed = ""
        return Unmanaged.passUnretained(event)
    default:
        break
    }

    var length = 0
    var chars = [UniChar](repeating: 0, count: 8)
    event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &length, unicodeString: &chars)
    guard length > 0 else { return Unmanaged.passUnretained(event) }
    typed += String(utf16CodeUnits: chars, count: length)
    if typed.count > 64 { typed = String(typed.suffix(64)) }

    if maxKeywordLength > 0 {
        // Longest keyword wins (";addr2" over ";addr")
        for (kw, text) in snippets.sorted(by: { $0.key.count > $1.key.count }) where typed.hasSuffix(kw) {
            typed = ""
            expand(keyword: kw, text: text)
            break
        }
    }
    return Unmanaged.passUnretained(event)
}

private func readSnippetUpdates() {
    DispatchQueue.global(qos: .utility).async {
        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if obj["exit"] != nil { exit(0) }
            if let map = obj["snippets"] as? [String: String] {
                let clean = map.filter { !$0.key.isEmpty && $0.key.count <= 32 }
                DispatchQueue.main.async {
                    snippets = clean
                    maxKeywordLength = clean.keys.map { $0.count }.max() ?? 0
                    typed = ""
                }
            }
        }
        // stdin closed: PeakFlow quit
        exit(0)
    }
}

func runKeyWatch() -> Never {
    let trusted = AXIsProcessTrusted()
    readSnippetUpdates()
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
    guard trusted,
          let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                      eventsOfInterest: CGEventMask(mask), callback: keywatchCallback, userInfo: nil) else {
        emit(["e": "ready", "trusted": false])
        // Stay alive so PeakFlow can tell the helper is up; it restarts us once permission is granted
        RunLoop.main.run()
        exit(0)
    }
    keywatchTap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    emit(["e": "ready", "trusted": true])
    RunLoop.main.run()
    exit(0)
}
