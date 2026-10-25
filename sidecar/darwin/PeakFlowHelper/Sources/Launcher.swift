/**
 * Launcher support (macOS): snippet expansion, selected text, quitting apps,
 * locking the screen and handing focus back to the previous app.
 *
 * One-shot commands (see runOneShot in main.swift):
 *   activate-previous      → {"ok": bool}       bring back the app the user was in
 *   paste-text             → {"ok": bool, "trusted": bool, "restored": bool}
 *                            paste the text read from stdin, then put the pasteboard back
 *   selection [ax]         → {"text": "...", "via": "ax"|"copy"|"none", "trusted": bool}
 *                            ("ax": Accessibility only, never touches the clipboard or focus)
 *   quit-app <pid>         → {"ok": bool}       NSRunningApplication.terminate()
 *   force-quit-app <pid>   → {"ok": bool}       NSRunningApplication.forceTerminate()
 *   running-apps           → [{pid, name, bundleId, path}]  regular (Dock) apps
 *   lock                   → {"ok": bool}
 *   context                → {"app", "bundleId", "before", "after", "secure", "trusted"}
 *                            dictation context: the front app and up to 500 characters each side
 *                            of the cursor in its focused text field. Never reads password fields
 *                            (secure: true and no text). Accessibility only; no clipboard or focus change.
 *
 * Long-running mode: `peakflow-helper keywatch` watches typing for snippet
 * keywords. It reads one JSON line per update from stdin,
 *   {"snippets": {"<keyword>": "<text>", ...}}
 * and when a keyword is typed it deletes the keyword and pastes the text
 * (clipboard saved and restored around the paste). It prints
 * {"e": "ready", "trusted": bool} at start and {"e": "expanded", "keyword": "..."}
 * after each expansion. Typed text never leaves this process: only the
 * keyword that matched is reported.
 *
 * Dictation's hold-to-talk key rides on the same tap: {"hold": {"code": 54}}
 * (a native modifier or F1–F20 key code, or null for off) and the watcher prints
 * {"e": "hold-down"} when that key goes down alone, {"e": "hold-up"} when it
 * is released, and {"e": "hold-cancel"} if another key is pressed meanwhile
 * (the person was using a shortcut, not dictating).
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
/// simulated copy or paste can put back exactly what the user had. nil if
/// any type can't be read: the caller then leaves the pasteboard alone,
/// because a restore missing a password manager's private marker would
/// hand the password to clipboard managers.
private func savePasteboard() -> [[NSPasteboard.PasteboardType: Data]]? {
    let pb = NSPasteboard.general
    guard let items = pb.pasteboardItems else { return nil } // nil means the read failed, not "empty"
    var saved: [[NSPasteboard.PasteboardType: Data]] = []
    for item in items {
        var types: [NSPasteboard.PasteboardType: Data] = [:]
        for t in item.types {
            guard let d = item.data(forType: t) else { return nil }
            types[t] = d
        }
        saved.append(types)
    }
    return saved
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

/// Types added to every clip PeakFlow puts on the pasteboard for a moment
/// (dictation, snippets, launcher answers). Clipboard managers skip
/// TransientType (nspasteboard.org); QuickBoard also skips its own marker.
/// Keep the marker name in step with OWN_WRITE_MARK_MAC in clipboard-own-writes.ts.
private let ownWriteTypes: [NSPasteboard.PasteboardType] = [
    NSPasteboard.PasteboardType("org.nspasteboard.TransientType"),
    NSPasteboard.PasteboardType("pro.getpeakflow.own-write")
]

/// Replace the pasteboard with `text`, marked as PeakFlow's own short-lived write.
private func writeOwnText(_ text: String) {
    let pb = NSPasteboard.general
    pb.clearContents()
    let item = NSPasteboardItem()
    item.setString(text, forType: .string)
    for t in ownWriteTypes { item.setData(Data(), forType: t) }
    pb.writeObjects([item])
}

/// Cross-process lock around every pasteboard round trip (paste-text, the
/// selection copy, snippet expansion in the keyword watcher). Two overlapping
/// round trips would lose the person's clipboard: the second would save the
/// first one's text and put that back. flock is released if a process dies.
private let pasteboardLockPath = (NSTemporaryDirectory() as NSString).appendingPathComponent("pro.getpeakflow.pasteboard.lock")

/// Wait up to `timeout` seconds for the lock. Returns the descriptor to pass to
/// `unlockPasteboard`, or nil if it couldn't be had: the caller then leaves
/// the pasteboard alone.
private func lockPasteboard(timeout: Double = 2.0) -> Int32? {
    let fd = open(pasteboardLockPath, O_CREAT | O_RDWR, 0o600)
    if fd < 0 { return nil }
    let deadline = Date().addingTimeInterval(timeout)
    while flock(fd, LOCK_EX | LOCK_NB) != 0 {
        if Date() > deadline { close(fd); return nil }
        usleep(20_000)
    }
    return fd
}

private func unlockPasteboard(_ fd: Int32?) {
    guard let fd = fd else { return }
    flock(fd, LOCK_UN)
    close(fd)
}

/// `paste-text`: text arrives on stdin (never on the command line, where
/// other processes could read it). Saves every pasteboard item and type,
/// writes the text (marked as our own), sends Cmd+V, waits for the app to
/// read it, then puts back exactly what was there, password-manager markers
/// and images included. If someone copies something in the meantime, that
/// copy is kept. Without Accessibility nothing is pasted and the text stays
/// on the pasteboard so the person can paste it by hand.
func pasteTextRestoring(dictation: Bool = false, parts: Bool = false) -> String {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard var text = String(data: input, encoding: .utf8), !text.isEmpty else {
        return jsonLine(["ok": false, "trusted": true, "error": "no text"])
    }
    // Another round trip is still running: don't touch the pasteboard
    guard let lock = lockPasteboard() else { return jsonLine(["ok": false, "trusted": true, "error": "busy"]) }
    defer { unlockPasteboard(lock) }
    let pb = NSPasteboard.general
    if parts {
        guard let entries = try? JSONSerialization.jsonObject(with: input) as? [[String: Any]],
              entries.allSatisfy({ $0["text"] is String }) else { return jsonLine(["ok": false, "trusted": true, "error": "invalid parts"]) }
        let copied = pb.string(forType: .string) ?? ""
        text = entries.map { part in
            let body = part["text"] as? String ?? ""
            return part["snippet"] as? Bool == true ? body.components(separatedBy: "{clipboard}").joined(separator: copied) : body
        }.joined()
    }
    guard !text.isEmpty else { return jsonLine(["ok": false, "trusted": true, "error": "no text"]) }
    guard let saved = savePasteboard() else { return jsonLine(["ok": false, "trusted": true, "error": "unreadable"]) }
    writeOwnText(text)
    let ours = pb.changeCount
    // Dictation privacy is sampled after the clipboard lock, at the actual paste destination.
    let privacy = dictation ? dictationContext(includeText: false) : nil
    var result = sendPaste()
    if parts { result["text"] = text }
    if let privacy = privacy, let data = privacy.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) { result["dictationPrivacy"] = parsed }
    guard result["ok"] as? Bool == true else { return jsonLine(result) }
    usleep(400_000) // give the app time to read the pasteboard
    let restored = pb.changeCount == ours
    if restored { restorePasteboard(saved) }
    result["restored"] = restored
    return jsonLine(result)
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
    guard let lock = lockPasteboard(timeout: 1.5) else { return jsonLine(["text": "", "via": "none", "trusted": true]) }
    defer { unlockPasteboard(lock) }
    let pb = NSPasteboard.general
    guard let saved = savePasteboard() else { return jsonLine(["text": "", "via": "none", "trusted": true]) }
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

// MARK: - dictation context

func dictationContext(limit: Int = 500, includeText: Bool = true) -> String {
    guard AXIsProcessTrusted() else { return jsonLine(["trusted": false]) }
    guard let app = NSWorkspace.shared.frontmostApplication else { return jsonLine(["trusted": true]) }
    var out: [String: Any] = ["app": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? "", "trusted": true]
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(axApp, 0.25) // a slow app must not hold up dictation
    var window: CFTypeRef?
    if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &window) == .success,
       let window = window, CFGetTypeID(window) == AXUIElementGetTypeID() {
        var title: CFTypeRef?
        AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &title)
        out["title"] = title as? String
    }
    var focused: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
          let f = focused, CFGetTypeID(f) == AXUIElementGetTypeID() else { return jsonLine(out) }
    let el = f as! AXUIElement // swiftlint:disable:this force_cast
    var role: CFTypeRef?
    var subrole: CFTypeRef?
    AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &role)
    let subroleStatus = AXUIElementCopyAttributeValue(el, kAXSubroleAttribute as CFString, &subrole)
    if (subrole as? String) == (kAXSecureTextFieldSubrole as String) || (role as? String) == "AXSecureTextField" {
        out["secure"] = true
        return jsonLine(out)
    }
    if role != nil && subroleStatus == .success { out["secure"] = false }
    if !includeText { return jsonLine(out) }
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &value) == .success,
          let text = value as? String, !text.isEmpty else { return jsonLine(out) }
    let ns = text as NSString
    var cursor = ns.length
    var selLen = 0
    var rangeRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
       let r = rangeRef, CFGetTypeID(r) == AXValueGetTypeID() {
        var range = CFRange(location: 0, length: 0)
        if AXValueGetValue(r as! AXValue, .cfRange, &range) { // swiftlint:disable:this force_cast
            cursor = max(0, min(ns.length, range.location))
            selLen = max(0, min(ns.length - cursor, range.length))
        }
    }
    let start = max(0, cursor - limit)
    let afterStart = cursor + selLen
    out["before"] = ns.substring(with: NSRange(location: start, length: cursor - start))
    out["after"] = ns.substring(with: NSRange(location: afterStart, length: min(limit, ns.length - afterStart)))
    return jsonLine(out)
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
private var holdKeyCode: Int64 = -1
private var captureHoldKey = false
private var recordingEscape = false
private var mayRecord = false
private var escapeAccepted = false
private var escapeSessionId = 0
private var escapeDown = false
private var dictate = false
private var escapeLocked = false
private var escapePressAt: Double? = nil
private var escapeTapUpAt = -Double.infinity
private var escapeSecond = false
private var nativeKeyState = NativeKeyState()
private var commandKeyState = NativeKeyState()
private var commandKeyCode: Int64 = -1
private var commandSessionId = 0
private var commandPending = false
private var commandAccepted = false
private func cancelCommandKey() {
    if commandPending { emit(["e": "command-cancel", "sessionId": commandSessionId]) }
    commandPending = false; commandAccepted = false
}
private func emitCommandEvents(_ events: [String]) {
    for event in events {
        if event == "down" {
            if !mayRecord || recordingEscape || escapeLocked || commandPending { continue }
            commandSessionId += 1; commandPending = true; commandAccepted = false
        }
        if commandPending { emit(["e": "command-" + event, "sessionId": commandSessionId]) }
        if event == "cancel" { commandPending = false; commandAccepted = false }
    }
}

private func physicalKeyDown(_ code: Int64) -> Bool {
    CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(code))
}
private func emitHoldEvents(_ events: [String]) {
    for event in events {
        if dictate {
            let now = Foundation.ProcessInfo.processInfo.systemUptime * 1000
            if event == "down" && mayRecord {
                escapePressAt = now
                escapeSecond = now - escapeTapUpAt <= 400
                if !escapeLocked { escapeSessionId += 1; escapeAccepted = false; recordingEscape = false }
            } else if event == "cancel" {
                escapePressAt = nil; escapeTapUpAt = -Double.infinity
                if !escapeLocked { recordingEscape = false }
            } else if event == "up", let start = escapePressAt {
                let tap = now - start < 300
                escapePressAt = nil
                if escapeLocked {
                    if tap { escapeLocked = false; recordingEscape = false; escapeTapUpAt = -Double.infinity }
                } else if tap && escapeSecond && escapeAccepted {
                    escapeLocked = true; recordingEscape = true; escapeTapUpAt = -Double.infinity
                } else { recordingEscape = false; escapeTapUpAt = tap ? now : -Double.infinity }
            }
        }
        emit(["e": "hold-" + event, "sessionId": escapeSessionId])
    }
}
// Device-specific flags distinguish each side even while the opposite side stays held.
private let modifierBits: [Int64: UInt64] = [55: 0x8, 54: 0x10, 58: 0x20, 61: 0x40,
                                            59: 0x1, 62: 0x2000, 56: 0x2, 60: 0x4,
                                            63: CGEventFlags.maskSecondaryFn.rawValue]
private let functionKeyCodes: Set<Int64> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109,
                                           103, 111, 105, 107, 113, 106, 64, 79, 80, 90]
private func canonicalKey(_ code: Int64) -> Int64 { code == 179 ? 63 : code }
private func modifierIsDown(_ code: Int64, _ flags: CGEventFlags) -> Bool {
    guard let bit = modifierBits[canonicalKey(code)] else { return false }
    return flags.rawValue & bit != 0
}

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

/// Snippet expansions run one at a time, off the main thread, each holding the
/// pasteboard lock until its restore is done. (Waiting for the lock on the
/// main queue would block the very restore that releases it.)
private let snippetQueue = DispatchQueue(label: "pro.getpeakflow.snippets")

/// Bumped (on the main thread) by every real key press and mouse click, so a
/// waiting expansion can tell the person has moved on.
private var inputGeneration = 0

private func expand(keyword: String, text: String) {
    let generation = inputGeneration
    let app = NSWorkspace.shared.frontmostApplication?.processIdentifier
    // Runs after the keyword's last key event has been delivered
    snippetQueue.asyncAfter(deadline: .now() + 0.03) {
        // Another round trip is running: leave the keyword as typed rather than risk the clipboard
        guard let lock = lockPasteboard(timeout: 0.25) else { return }
        defer { unlockPasteboard(lock) }
        let pb = NSPasteboard.general
        guard let saved = savePasteboard() else { return } // can't put it back whole: leave the keyword
        let previous = pb.string(forType: .string) ?? ""
        writeOwnText(fill(text, clipboard: previous))
        let ours = pb.changeCount
        // Typed, clicked or switched app since the keyword (for example while waiting for the lock):
        // deleting and pasting now would hit the wrong text, so leave the keyword as typed. Checked on
        // the main thread, where real input is counted. Input arriving in the ~30 ms between the
        // backspaces and the paste can still race them, as it always could.
        let pasted = DispatchQueue.main.sync { () -> Bool in
            guard inputGeneration == generation,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == app else { return false }
            for _ in 0..<keyword.count { postKey(51) } // kVK_Delete (backspace)
            return true
        }
        if pasted {
            usleep(30_000)
            postKey(9, flags: .maskCommand) // kVK_ANSI_V: once the keyword is gone, always replace it
            usleep(400_000) // give the app time to read the clipboard before putting the old one back
        }
        if pb.changeCount == ours { restorePasteboard(saved) }
        if pasted { DispatchQueue.main.async { emit(["e": "expanded", "keyword": keyword]) } }
    }
}

private let keywatchCallback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        emitHoldEvents(nativeKeyState.interrupt())
        emitCommandEvents(commandKeyState.interrupt())
        cancelCommandKey()
        typed = ""
        if let tap = keywatchTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == syntheticTag {
        return Unmanaged.passUnretained(event)
    }
    if type == .leftMouseDown || type == .rightMouseDown {
        inputGeneration &+= 1
        typed = ""
        return Unmanaged.passUnretained(event)
    }
    let rawCode = event.getIntegerValueField(.keyboardEventKeycode)
    let code = canonicalKey(rawCode)
    let isModifier = modifierBits[code] != nil
    let isDown = type == .keyDown || (type == .flagsChanged && modifierIsDown(code, event.flags))
    let isUp = type == .keyUp || (type == .flagsChanged && !modifierIsDown(code, event.flags))
    // Use the hardware state table, rather than guessing which PID generated the event.
    // https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid
    let commandPhysical = event.getIntegerValueField(.eventSourceStateID) == Int64(CGEventSourceStateID.hidSystemState.rawValue)
    if commandPhysical && commandPending && isDown && code != commandKeyCode {
        let swallow = code == 53 && commandAccepted
        cancelCommandKey()
        if swallow { escapeDown = true; return nil }
    }
    if code == 53 {
        if isDown && (recordingEscape || escapeDown) {
            if !escapeDown { escapeDown = true; recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = nil; escapeTapUpAt = -Double.infinity; emit(["e": "recording-escape", "sessionId": escapeSessionId]) }
            return nil
        }
        if isUp && escapeDown { escapeDown = false; return nil }
    }
    let capsToggle = type == .flagsChanged && code == 57
    let result = nativeKeyState.feed(code: code, down: isDown || capsToggle, up: isUp && !capsToggle,
                                    repeated: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
                                    modifier: isModifier, suppress: !isModifier || code == 63,
                                    otherModifier: modifierBits.keys.contains { $0 != code && modifierIsDown($0, event.flags) },
                                    physical: physicalKeyDown)
    let commandResult = commandPhysical ? commandKeyState.feed(code: code, down: isDown || capsToggle, up: isUp && !capsToggle,
                                    repeated: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
                                    modifier: isModifier, suppress: !isModifier || code == 63,
                                    otherModifier: modifierBits.keys.contains { $0 != code && modifierIsDown($0, event.flags) },
                                    physical: physicalKeyDown) : NativeKeyResult()
    emitCommandEvents(commandResult.events)
    emitHoldEvents(result.events)
    if let recorded = result.recorded {
        captureHoldKey = false
        emit(["e": "hold-key-recorded", "code": recorded])
    }
    // Caps Lock is rejected by main and toggles without a paired release.
    if capsToggle && result.recorded != nil {
        _ = nativeKeyState.feed(code: code, down: false, up: true, repeated: false,
                                modifier: false, suppress: false, otherModifier: false, physical: physicalKeyDown)
    }
    if result.swallow || commandResult.swallow { return nil }
    if type == .flagsChanged || type == .keyUp { return Unmanaged.passUnretained(event) }
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }
    inputGeneration &+= 1

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
            if let id = (obj["acceptCommand"] as? NSNumber)?.intValue {
                DispatchQueue.main.async { if id == commandSessionId && commandPending { commandAccepted = true } }
            }
            if let id = (obj["endCommand"] as? NSNumber)?.intValue {
                DispatchQueue.main.async { if id == commandSessionId { commandPending = false; commandAccepted = false } }
            }
            if obj.keys.contains("command") {
                let key = obj["command"] as? [String: Any]
                let code = (key?["code"] as? NSNumber)?.int64Value ?? -1
                DispatchQueue.main.async {
                    let next = (modifierBits[code] != nil || functionKeyCodes.contains(code)) && code != holdKeyCode ? code : -1
                    if next != commandKeyCode { cancelCommandKey() }
                    commandKeyCode = next
                    let physical = Set((0..<256).map { Int64($0) }.filter { physicalKeyDown($0) })
                    emitCommandEvents(commandKeyState.configure(key: commandKeyCode, capture: false, physical: physical))
                }
            }
            if let allowed = obj["mayRecord"] as? Bool {
                DispatchQueue.main.async {
                    mayRecord = allowed
                    if !allowed {
                        recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = nil; escapeTapUpAt = -Double.infinity
                    }
                }
            }
            if let id = (obj["armEscape"] as? NSNumber)?.intValue {
                DispatchQueue.main.async {
                    if id == escapeSessionId && mayRecord && dictate && (escapePressAt != nil || escapeLocked) {
                        escapeAccepted = true; recordingEscape = true
                    }
                }
            }
            if let id = (obj["disarmEscape"] as? NSNumber)?.intValue {
                DispatchQueue.main.async {
                    if id == escapeSessionId {
                        recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = nil
                    }
                }
            }
            if obj.keys.contains("hold") || obj.keys.contains("captureHoldKey") {
                let key = obj["hold"] as? [String: Any]
                let code = (key?["code"] as? NSNumber)?.int64Value ?? -1
                let capture = obj["captureHoldKey"] as? Bool
                let enabled = obj["dictate"] as? Bool
                DispatchQueue.main.async {
                    if obj.keys.contains("hold") {
                        holdKeyCode = (modifierBits[code] != nil || functionKeyCodes.contains(code)) ? code : -1
                    }
                    if let enabled = enabled, enabled != dictate {
                        dictate = enabled
                        recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = nil; escapeTapUpAt = -Double.infinity
                    }
                    if let capture = capture {
                        captureHoldKey = capture
                        if capture { cancelCommandKey() }
                    }
                    if captureHoldKey { emitCommandEvents(commandKeyState.configure(key: -1, capture: false, physical: [])) }
                    let physical = Set((0..<256).map { Int64($0) }.filter { physicalKeyDown($0) })
                    emitHoldEvents(nativeKeyState.configure(key: holdKeyCode, capture: captureHoldKey, physical: physical))
                }
            }
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
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
    guard trusted,
          let tap = CGEvent.tapCreate(tap: getenv("PEAKFLOW_KEYWATCH_TAP").map { String(cString: $0) } == "hid" ? .cghidEventTap : .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
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

// MARK: - Command Mode (one process retains the actual AX identities)

private struct CommandSnapshot {
    let pid: pid_t
    let window: AXUIElement
    let element: AXUIElement
    let range: CFRange
    let text: String
}

private func commandAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

/// All security/editability checks precede selected-text reads. Unknown is a refusal.
private func commandSnapshot(excluded: [String]) -> (CommandSnapshot?, String) {
    guard AXIsProcessTrusted() else { return (nil, "Allow Accessibility") }
    guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getppid(),
          let bundle = app.bundleIdentifier else { return (nil, "Unsupported app") }
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(ax, 0.25)
    guard let w = commandAttribute(ax, kAXFocusedWindowAttribute), CFGetTypeID(w) == AXUIElementGetTypeID(),
          let f = commandAttribute(ax, kAXFocusedUIElementAttribute), CFGetTypeID(f) == AXUIElementGetTypeID() else { return (nil, "Unsupported field") }
    let window = w as! AXUIElement
    let element = f as! AXUIElement
    guard let title = commandAttribute(window, kAXTitleAttribute) as? String else { return (nil, "Unknown field safety") }
    let metadata = [bundle, app.localizedName ?? "", title].joined(separator: " ")
    for name in excluded {
        let pattern = "(?<![\\p{L}\\p{N}])" + NSRegularExpression.escapedPattern(for: name) + "(?![\\p{L}\\p{N}])"
        if metadata.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil { return (nil, "Private app") }
    }
    guard let role = commandAttribute(element, kAXRoleAttribute) as? String,
          let subrole = commandAttribute(element, kAXSubroleAttribute) as? String else { return (nil, "Unknown field safety") }
    if subrole == (kAXSecureTextFieldSubrole as String) || role == "AXSecureTextField" { return (nil, "Password field") }
    guard ["AXTextField", "AXTextArea", "AXComboBox"].contains(role) else { return (nil, "Unsupported field") }
    var writable = DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &writable) == .success, writable.boolValue,
          (commandAttribute(element, kAXEnabledAttribute) as? Bool) == true else { return (nil, "Read-only field") }
    if let ranges = commandAttribute(element, "AXSelectedTextRanges") as? [Any], ranges.count != 1 { return (nil, "Select one text range") }
    guard let r = commandAttribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(r) == AXValueGetTypeID() else { return (nil, "Unsupported selection") }
    var range = CFRange(location: 0, length: 0)
    guard AXValueGetValue(r as! AXValue, .cfRange, &range), range.location >= 0, range.length > 0 else { return (nil, "Select text first") }
    guard let text = commandAttribute(element, kAXSelectedTextAttribute) as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return (nil, "Select text first") }
    guard text.utf8.count <= 2000 else { return (nil, "Select less text") }
    guard (text as NSString).length == range.length else { return (nil, "Unsupported selection") }
    // A focus change while AX was answering also invalidates capture.
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
          let focused = commandAttribute(ax, kAXFocusedUIElementAttribute), CFEqual(focused, element),
          let focusedWindow = commandAttribute(ax, kAXFocusedWindowAttribute), CFEqual(focusedWindow, window) else { return (nil, "Selection changed") }
    return (CommandSnapshot(pid: app.processIdentifier, window: window, element: element, range: range, text: text), "")
}

private func sameCommandSelection(_ a: CommandSnapshot, _ b: CommandSnapshot) -> Bool {
    a.pid == b.pid && CFEqual(a.window, b.window) && CFEqual(a.element, b.element) &&
    a.range.location == b.range.location && a.range.length == b.range.length && a.text == b.text
}

/// Validate the full snapshot, then re-read focus/range and finish with the cheap frontmost-PID check right before paste.
private func validateCommandSelection(focus: () throws -> Bool, range: () throws -> Bool,
                                      text: () throws -> Bool, frontmost: () throws -> Bool) -> Bool {
    do { return try frontmost() && focus() && range() && text() && focus() && range() && frontmost() }
    catch { return false }
}

private func commandSelectionUnchanged(_ snapshot: CommandSnapshot, pasteboard: NSPasteboard, changeCount: Int) -> Bool {
    let ax = AXUIElementCreateApplication(snapshot.pid)
    guard AXUIElementSetMessagingTimeout(ax, 0.25) == .success,
          AXUIElementSetMessagingTimeout(snapshot.element, 0.25) == .success else { return false }
    return validateCommandSelection(focus: {
        guard let focused = commandAttribute(ax, kAXFocusedUIElementAttribute),
              let window = commandAttribute(ax, kAXFocusedWindowAttribute) else { return false }
        return CFEqual(focused, snapshot.element) && CFEqual(window, snapshot.window)
    }, range: {
        guard let value = commandAttribute(snapshot.element, kAXSelectedTextRangeAttribute),
              CFGetTypeID(value) == AXValueGetTypeID() else { return false }
        var range = CFRange(location: 0, length: 0)
        return AXValueGetValue(value as! AXValue, .cfRange, &range) &&
            range.location == snapshot.range.location && range.length == snapshot.range.length
    }, text: {
        (commandAttribute(snapshot.element, kAXSelectedTextAttribute) as? String) == snapshot.text
    }, frontmost: {
        pasteboard.changeCount == changeCount && NSWorkspace.shared.frontmostApplication?.processIdentifier == snapshot.pid
    })
}

/// Cancellation and the start of paste share one mutex. Once paste starts, always restore.
private final class CommandPasteGate {
    private let mutex = NSLock()
    private var cancelled = false
    private var pasting = false
    private var authorized = false
    private let approval = DispatchSemaphore(value: 0)
    func authorize(_ allowed: Bool) {
        mutex.lock(); authorized = allowed; mutex.unlock()
        approval.signal()
    }
    func waitForApproval() -> Bool {
        if approval.wait(timeout: .now() + 1) != .success { return false }
        mutex.lock(); defer { mutex.unlock() }
        return authorized && !cancelled
    }
    func cancel() {
        mutex.lock(); defer { mutex.unlock() }
        if !pasting { cancelled = true }
    }
    func begin(_ action: () -> Void) -> Bool {
        mutex.lock(); defer { mutex.unlock() }
        if cancelled { return false }
        pasting = true
        action()
        return true
    }
}

/// Dedicated stdin protocol: source text never goes on argv, disk or stderr.
/// The reader stays live while replacement waits for the cross-process clipboard lock.
func runCommandSelection() -> Never {
    guard let line = readLine(), let data = line.data(using: .utf8),
          let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let excluded = config["excluded"] as? [String] else { exit(1) }
    let gate = CommandPasteGate()
    let (captured, reason) = commandSnapshot(excluded: excluded)
    guard let snapshot = captured else { emit(["stage": "capture", "error": reason]); exit(0) }
    emit(["stage": "capture", "text": snapshot.text])
    DispatchQueue.global(qos: .userInitiated).async {
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if obj["cancel"] as? Bool == true { gate.cancel(); DispatchQueue.main.async { exit(0) }; continue }
            if let allowed = obj["authorize"] as? Bool { gate.authorize(allowed); continue }
            guard let text = obj["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let code = obj["keyCode"] as? Int, code >= 0 && code < 256 else { continue }
            DispatchQueue.main.async {
                var ok = false
                if let lock = lockPasteboard() {
                    defer { unlockPasteboard(lock) }
                    emit(["stage": "validate"])
                    guard gate.waitForApproval() else { emit(["stage": "result", "ok": false]); exit(0) }
                    let pb = NSPasteboard.general
                    let before = pb.changeCount
                    if let saved = savePasteboard(),
                       let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
                       let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) {
                        let (current, _) = commandSnapshot(excluded: excluded)
                        if let current = current, sameCommandSelection(snapshot, current), pb.changeCount == before,
                           !physicalKeyDown(Int64(code)) {
                            down.flags = .maskCommand; up.flags = .maskCommand
                            down.setIntegerValueField(.eventSourceUserData, value: syntheticTag)
                            up.setIntegerValueField(.eventSourceUserData, value: syntheticTag)
                            var ours = before
                            let began = gate.begin {
                                writeOwnText(text)
                                ours = pb.changeCount
                                guard !physicalKeyDown(Int64(code)), commandSelectionUnchanged(snapshot, pasteboard: pb, changeCount: ours) else { return }
                                // Global paste cannot close the sub-millisecond window between the last read and the synthetic keystroke.
                                down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                                emit(["stage": "pasting"])
                                ok = true
                            }
                            if ok { usleep(400_000) }
                            if began && pb.changeCount == ours { restorePasteboard(saved) }
                        }
                    }
                }
                emit(["stage": "result", "ok": ok]); exit(0)
            }
        }
        gate.cancel()
        DispatchQueue.main.async { exit(0) }
    }
    // Bound orphaned sessions even if the parent never sends another message.
    DispatchQueue.main.asyncAfter(deadline: .now() + 120) { gate.cancel(); exit(0) }
    RunLoop.main.run()
    exit(0)
}
