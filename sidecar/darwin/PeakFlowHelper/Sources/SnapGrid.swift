/**
 * SnapGrid: move and resize other apps' windows (macOS).
 *
 * Persistent-helper commands (coordinates are global, top-left origin, in
 * points, the same space as Electron's screen API):
 *   sg-front                         → the frontmost app's focused window
 *   sg-windows                       → standard on-screen windows, front to back
 *   sg-set <pid> <wid> <x> <y> <w> <h> → move/resize that window (wid 0 = the app's focused window)
 *   sg-raise <pid> <wid>             → raise that window and activate its app
 *   sg-tiling                        → {"edgeDrag": bool}: macOS's own drag-to-edge tiling is on
 *
 * Long-running mode `peakflow-helper drag-watch` prints one JSON line per
 * window-drag event (start / move / end) until stdin closes. All of it needs
 * Accessibility, which FocusDim already asks for.
 */

import Cocoa
import ApplicationServices

/// Private but stable since 10.7 (Rectangle, Magnet and others rely on it):
/// the CGWindowID behind an AX window element.
@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

func axWindowId(_ window: AXUIElement) -> Int {
    var wid: CGWindowID = 0
    return _AXUIElementGetWindow(window, &wid) == .success ? Int(wid) : 0
}

func axFrame(_ window: AXUIElement) -> CGRect? {
    var posRef: AnyObject?
    var sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let posValue = posRef, let sizeValue = sizeRef else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

private func frameJSON(_ r: CGRect) -> [String: Any] {
    return ["x": Double(r.origin.x), "y": Double(r.origin.y), "w": Double(r.size.width), "h": Double(r.size.height)]
}

private func setPosition(_ window: AXUIElement, _ p: CGPoint) {
    var point = p
    if let value = AXValueCreate(.cgPoint, &point) {
        AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value)
    }
}

private func setSize(_ window: AXUIElement, _ s: CGSize) {
    var size = s
    if let value = AXValueCreate(.cgSize, &size) {
        AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, value)
    }
}

/// Move and resize a window. Size, then position, then size again: a window
/// that can't grow past the screen edge at its old position gets its full
/// size on the second pass. Apps with "enhanced user interface" on (set by
/// VoiceOver-style tools) animate every change, so it is switched off while
/// moving and restored after.
func setWindowFrame(app: AXUIElement, window: AXUIElement, frame: CGRect) -> CGRect? {
    let enhancedKey = "AXEnhancedUserInterface" as CFString
    var enhancedRef: AnyObject?
    let wasEnhanced = AXUIElementCopyAttributeValue(app, enhancedKey, &enhancedRef) == .success && (enhancedRef as? Bool) == true
    if wasEnhanced { AXUIElementSetAttributeValue(app, enhancedKey, kCFBooleanFalse) }
    defer { if wasEnhanced { AXUIElementSetAttributeValue(app, enhancedKey, kCFBooleanTrue) } }

    setSize(window, frame.size)
    setPosition(window, frame.origin)
    setSize(window, frame.size)
    return axFrame(window)
}

private func focusedWindow(of app: AXUIElement) -> AXUIElement? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &ref) == .success, let w = ref else { return nil }
    return (w as! AXUIElement)
}

/// Find an app's window by CGWindowID (0 = its focused window).
private func findWindow(pid: Int32, wid: Int) -> (AXUIElement, AXUIElement)? {
    let app = AXUIElementCreateApplication(pid)
    if wid == 0 { return focusedWindow(of: app).map { (app, $0) } }
    var windowsRef: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef) == .success,
          let windows = windowsRef as? [AXUIElement] else { return nil }
    for w in windows where axWindowId(w) == wid { return (app, w) }
    return nil
}

private func appInfo(_ pid: Int32) -> [String: Any] {
    let app = NSRunningApplication(processIdentifier: pid)
    return ["appName": app?.localizedName ?? "", "bundleId": app?.bundleIdentifier ?? ""]
}

/// sg-front: the frontmost app's focused window.
func sgFront() -> String {
    RunLoop.current.run(mode: .default, before: Date())
    guard let front = NSWorkspace.shared.frontmostApplication else { return "null" }
    let pid = front.processIdentifier
    let app = AXUIElementCreateApplication(pid)
    guard let window = focusedWindow(of: app), let frame = axFrame(window) else {
        return jsonString(["pid": Int(pid), "windowId": 0, "frame": NSNull()].merging(appInfo(pid)) { a, _ in a })
    }
    var result: [String: Any] = ["pid": Int(pid), "windowId": axWindowId(window), "frame": frameJSON(frame)]
    result.merge(appInfo(pid)) { a, _ in a }
    return jsonString(result)
}

/// sg-windows: normal on-screen windows (layer 0), front to back.
func sgWindows() -> String {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return "[]"
    }
    var out: [[String: Any]] = []
    for info in list {
        if out.count >= 30 { break }
        guard let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
              let pid = info[kCGWindowOwnerPID as String] as? Int32,
              let wid = info[kCGWindowNumber as String] as? Int,
              let b = info[kCGWindowBounds as String] as? [String: CGFloat],
              let x = b["X"], let y = b["Y"], let w = b["Width"], let h = b["Height"] else { continue }
        if w < 80 || h < 60 { continue }
        if let alpha = info[kCGWindowAlpha as String] as? Double, alpha < 0.05 { continue }
        let title = info[kCGWindowName as String] as? String ?? ""
        if title == "__peakflow_dim__" { continue }
        var row: [String: Any] = ["pid": Int(pid), "windowId": wid, "title": title,
                                  "frame": ["x": Double(x), "y": Double(y), "w": Double(w), "h": Double(h)]]
        row.merge(appInfo(pid)) { a, _ in a }
        out.append(row)
    }
    return jsonString(out)
}

/// sg-set <pid> <wid> <x> <y> <w> <h>
func sgSet(_ arg: String?) -> String {
    let parts = (arg ?? "").split(separator: " ").map(String.init)
    guard parts.count == 6, let pid = Int32(parts[0]), pid > 0, let wid = Int(parts[1]),
          let x = Double(parts[2]), let y = Double(parts[3]), let w = Double(parts[4]), let h = Double(parts[5]),
          x.isFinite, y.isFinite, w.isFinite, h.isFinite, w > 0, h > 0 else {
        return jsonString(["ok": false, "error": "usage: sg-set pid wid x y w h"])
    }
    guard let (app, window) = findWindow(pid: pid, wid: wid) else {
        return jsonString(["ok": false, "error": "window not found"])
    }
    // A full-screen (own Space) window can't be tiled; leave it alone
    var fsRef: AnyObject?
    if AXUIElementCopyAttributeValue(window, "AXFullScreen" as CFString, &fsRef) == .success, (fsRef as? Bool) == true {
        return jsonString(["ok": false, "error": "full screen"])
    }
    let before = axFrame(window)
    guard let after = setWindowFrame(app: app, window: window, frame: CGRect(x: x, y: y, width: w, height: h)) else {
        return jsonString(["ok": false, "error": "could not move"])
    }
    var result: [String: Any] = ["ok": true, "frame": frameJSON(after), "windowId": axWindowId(window)]
    if let b = before { result["before"] = frameJSON(b) }
    return jsonString(result)
}

/// sg-raise <pid> <wid>
func sgRaise(_ arg: String?) -> String {
    let parts = (arg ?? "").split(separator: " ").map(String.init)
    guard parts.count == 2, let pid = Int32(parts[0]), pid > 0, let wid = Int(parts[1]) else {
        return jsonString(["ok": false])
    }
    if let (_, window) = findWindow(pid: pid, wid: wid) {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }
    let ok = NSRunningApplication(processIdentifier: pid)?.activate(options: []) ?? false
    return jsonString(["ok": ok])
}

/// sg-tiling: is macOS's own "drag windows to screen edges to tile" on?
/// It exists from macOS 15 and is on unless the user turned it off.
func sgTiling() -> String {
    guard Foundation.ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 15, minorVersion: 0, patchVersion: 0)) else {
        return jsonString(["edgeDrag": false])
    }
    let defaults = UserDefaults(suiteName: "com.apple.WindowManager")
    let on = (defaults?.object(forKey: "EnableTilingByEdgeDrag") as? Bool) ?? true
    return jsonString(["edgeDrag": on])
}

// MARK: - Drag watcher

/// Watches the mouse globally and reports when the user drags a window by its
/// title bar: {"e":"start",pid,windowId}, then {"e":"move",x,y} (cursor, top-left
/// global points, about 60 a second), then {"e":"end",x,y,pid,windowId}.
/// A drag that resizes the window (or doesn't move it) reports nothing.
final class DragWatcher {
    private var window: AXUIElement?
    private var pid: Int32 = 0
    private var startFrame: CGRect = .zero
    private var moving = false
    private var checked = 0
    private var lastMove = Date.distantPast
    private let systemWide = AXUIElementCreateSystemWide()

    private func emit(_ obj: [String: Any]) {
        print(jsonString(obj))
        fflush(stdout)
    }

    private func cursor(_ event: NSEvent) -> CGPoint {
        return event.cgEvent?.location ?? .zero
    }

    func mouseDown(_ event: NSEvent) {
        reset()
        let p = cursor(event)
        var elementRef: AXUIElement?
        guard AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &elementRef) == .success,
              let element = elementRef else { return }
        var win: AXUIElement = element
        var roleRef: AnyObject?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
        if (roleRef as? String) != (kAXWindowRole as String) {
            var winRef: AnyObject?
            guard AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &winRef) == .success,
                  let w = winRef else { return }
            win = (w as! AXUIElement)
        }
        guard let frame = axFrame(win) else { return }
        var ownerPid: pid_t = 0
        AXUIElementGetPid(win, &ownerPid)
        window = win
        pid = ownerPid
        startFrame = frame
    }

    func mouseDragged(_ event: NSEvent) {
        guard let win = window else { return }
        if !moving {
            // Check the first few drag events only: a window that hasn't moved
            // by then is being resized or wasn't grabbed by its title bar.
            checked += 1
            if checked > 12 { window = nil; return }
            guard let now = axFrame(win) else { return }
            let moved = abs(now.origin.x - startFrame.origin.x) + abs(now.origin.y - startFrame.origin.y) > 2
            let resized = abs(now.size.width - startFrame.size.width) + abs(now.size.height - startFrame.size.height) > 2
            if resized { window = nil; return }
            if !moved { return }
            moving = true
            emit(["e": "start", "pid": Int(pid), "windowId": axWindowId(win)])
        }
        let t = Date()
        if t.timeIntervalSince(lastMove) < 0.016 { return }
        lastMove = t
        let p = cursor(event)
        emit(["e": "move", "x": Double(p.x), "y": Double(p.y)])
    }

    func mouseUp(_ event: NSEvent) {
        if moving, let win = window {
            let p = cursor(event)
            emit(["e": "end", "x": Double(p.x), "y": Double(p.y), "pid": Int(pid), "windowId": axWindowId(win)])
        }
        reset()
    }

    private func reset() {
        window = nil
        moving = false
        checked = 0
    }
}

func runDragWatch() -> Never {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let watcher = DragWatcher()
    NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown]) { watcher.mouseDown($0) }
    NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDragged]) { watcher.mouseDragged($0) }
    NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp]) { watcher.mouseUp($0) }
    // Quit when PeakFlow goes away (stdin closes) so no watcher is left behind
    Thread.detachNewThread {
        while readLine() != nil {}
        exit(0)
    }
    print(jsonString(["e": "ready", "trusted": AXIsProcessTrusted()]))
    fflush(stdout)
    app.run()
    exit(0)
}
