/**
 * Active window tracking for macOS using CGWindowList and Accessibility APIs.
 *
 * CGWindowListCopyWindowInfo provides window bounds for all on-screen windows.
 * AXUIElement provides focused window info (requires Accessibility permission).
 */

import Cocoa
import ApplicationServices

// MARK: - Data types

struct WindowInfo {
    let pid: Int32
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let title: String
    let bundleId: String
    let appName: String

    func toJSON() -> String {
        let escapedTitle = title.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let escapedName = appName.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return """
        {"pid":\(pid),"x":\(x),"y":\(y),"w":\(w),"h":\(h),\
        "title":"\(escapedTitle)","bundleId":"\(bundleId)","appName":"\(escapedName)"}
        """
    }
}

struct WindowRect {
    let x: Double
    let y: Double
    let w: Double
    let h: Double

    func toJSON() -> String {
        return "{\"x\":\(x),\"y\":\(y),\"w\":\(w),\"h\":\(h)}"
    }
}

struct AppInfo {
    let bundleId: String
    let name: String

    func toJSON() -> String {
        let escapedName = name.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"exe\":\"\(bundleId)\",\"name\":\"\(escapedName)\"}"
    }
}

struct ProcessInfo {
    let name: String
    let bundleId: String

    func toJSON() -> String {
        let escapedName = name.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"name\":\"\(escapedName)\",\"bundleId\":\"\(bundleId)\"}"
    }
}

// MARK: - Ignored bundle IDs (macOS equivalents of Windows IGNORED_CLASSES)

private let ignoredBundleIds: Set<String> = [
    "com.apple.dock",
    "com.apple.WindowManager",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.systemuiserver",
    "com.apple.Spotlight",
    "com.apple.loginwindow"
]

/// Bundle IDs filtered during window enumeration (system chrome, helpers)
private let enumIgnoredBundleIds: Set<String> = [
    "com.apple.dock",
    "com.apple.WindowManager",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.systemuiserver",
    "com.apple.Spotlight",
    "com.apple.loginwindow",
    "com.apple.ViewBridgeAuxiliary",
    "com.apple.universalcontrol",
    "com.apple.TextInputMenuAgent",
    "com.apple.TextInputSwitcher"
]

/// Owner names to skip (for windows without a bundle ID)
private let ignoredOwnerNames: Set<String> = [
    "Window Manager",
    "Dock",
    "SystemUIServer",
    "Control Center",
    "Notification Center"
]

// MARK: - Accessibility check

func checkAccessibility() -> Bool {
    return AXIsProcessTrusted()
}

// MARK: - Active window (focused)

func getActiveWindow() -> WindowInfo? {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return nil }
    let pid = frontApp.processIdentifier
    let bundleId = frontApp.bundleIdentifier ?? ""
    let appName = frontApp.localizedName ?? ""

    // Skip system apps
    if ignoredBundleIds.contains(bundleId) { return nil }

    // Try Accessibility API for focused window bounds (most accurate)
    let appElement = AXUIElementCreateApplication(pid)
    var focusedWindow: AnyObject?
    let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindow)

    guard result == .success, let window = focusedWindow else {
        // Fallback: use CGWindowList to find the frontmost window for this PID
        return getWindowFromCGWindowList(pid: pid, bundleId: bundleId, appName: appName)
    }

    // Get position
    var position: AnyObject?
    AXUIElementCopyAttributeValue(window as! AXUIElement, kAXPositionAttribute as CFString, &position)

    // Get size
    var size: AnyObject?
    AXUIElementCopyAttributeValue(window as! AXUIElement, kAXSizeAttribute as CFString, &size)

    guard let posValue = position, let sizeValue = size else {
        return getWindowFromCGWindowList(pid: pid, bundleId: bundleId, appName: appName)
    }

    var point = CGPoint.zero
    var cgSize = CGSize.zero
    AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &cgSize)

    // Skip tiny windows
    if cgSize.width < 10 || cgSize.height < 10 { return nil }

    // Get title
    var titleValue: AnyObject?
    AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &titleValue)
    let title = (titleValue as? String) ?? ""

    return WindowInfo(
        pid: pid,
        x: Double(point.x),
        y: Double(point.y),
        w: Double(cgSize.width),
        h: Double(cgSize.height),
        title: title,
        bundleId: bundleId,
        appName: appName
    )
}

/// Fallback: find the frontmost window for a PID using CGWindowList
private func getWindowFromCGWindowList(pid: Int32, bundleId: String, appName: String) -> WindowInfo? {
    guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }

    for windowInfo in windowList {
        guard let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? Int32,
              ownerPID == pid,
              let bounds = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
              let x = bounds["X"], let y = bounds["Y"],
              let w = bounds["Width"], let h = bounds["Height"] else {
            continue
        }

        if w < 10 || h < 10 { continue }

        // Skip windows at or above the status bar layer
        if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 { continue }

        let title = windowInfo[kCGWindowName as String] as? String ?? ""

        return WindowInfo(
            pid: pid,
            x: Double(x), y: Double(y), w: Double(w), h: Double(h),
            title: title,
            bundleId: bundleId,
            appName: appName
        )
    }

    return nil
}

// MARK: - All visible windows

func getAllVisibleWindows(filterPid: Int32? = nil) -> [WindowRect] {
    guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    var results: [WindowRect] = []
    let maxWindows = 50

    for windowInfo in windowList {
        if results.count >= maxWindows { break }

        guard let bounds = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
              let x = bounds["X"], let y = bounds["Y"],
              let w = bounds["Width"], let h = bounds["Height"] else {
            continue
        }

        // Skip tiny windows
        if w < 10 || h < 10 { continue }

        // Skip system-level windows (menubar, dock, etc.)
        if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 { continue }

        // Skip ignored apps
        let ownerName = windowInfo[kCGWindowOwnerName as String] as? String ?? ""
        if ignoredOwnerNames.contains(ownerName) { continue }

        // Get owner PID for filtering
        guard let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? Int32 else { continue }

        // Get bundle ID for this PID
        if let app = NSRunningApplication(processIdentifier: ownerPID) {
            if let bid = app.bundleIdentifier, enumIgnoredBundleIds.contains(bid) { continue }
        }

        // PID filter
        if let fpid = filterPid, ownerPID != fpid { continue }

        // Skip PeakFlow overlay windows
        let title = windowInfo[kCGWindowName as String] as? String ?? ""
        if title == "__peakflow_dim__" { continue }

        results.append(WindowRect(x: Double(x), y: Double(y), w: Double(w), h: Double(h)))
    }

    return results
}

// MARK: - Windows for bundle ID

func getWindowsForBundleId(_ targetBundleId: String) -> [WindowRect] {
    guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    // Find all PIDs matching this bundle ID
    let matchingPids = NSWorkspace.shared.runningApplications
        .filter { $0.bundleIdentifier == targetBundleId }
        .map { $0.processIdentifier }
    let pidSet = Set(matchingPids)

    var results: [WindowRect] = []
    let maxWindows = 50

    for windowInfo in windowList {
        if results.count >= maxWindows { break }

        guard let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? Int32,
              pidSet.contains(ownerPID),
              let bounds = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
              let x = bounds["X"], let y = bounds["Y"],
              let w = bounds["Width"], let h = bounds["Height"] else {
            continue
        }

        if w < 10 || h < 10 { continue }
        if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 { continue }

        let title = windowInfo[kCGWindowName as String] as? String ?? ""
        if title == "__peakflow_dim__" { continue }

        results.append(WindowRect(x: Double(x), y: Double(y), w: Double(w), h: Double(h)))
    }

    return results
}

// MARK: - Visible app list

func getVisibleAppList() -> [AppInfo] {
    guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    var seen = [String: String]() // bundleId -> name
    let selfBundleIds: Set<String> = ["pro.getpeakflow.core"]

    for windowInfo in windowList {
        guard let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? Int32 else { continue }

        // Skip system-level windows
        if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 { continue }

        let ownerName = windowInfo[kCGWindowOwnerName as String] as? String ?? ""
        if ignoredOwnerNames.contains(ownerName) { continue }

        // Skip PeakFlow overlay windows
        let title = windowInfo[kCGWindowName as String] as? String ?? ""
        if title == "__peakflow_dim__" || title.isEmpty { continue }

        guard let app = NSRunningApplication(processIdentifier: ownerPID),
              let bundleId = app.bundleIdentifier else { continue }

        if enumIgnoredBundleIds.contains(bundleId) { continue }
        if selfBundleIds.contains(bundleId) { continue }
        if seen[bundleId] != nil { continue }

        let name = app.localizedName ?? ownerName
        seen[bundleId] = name
    }

    return seen.map { AppInfo(bundleId: $0.key, name: $0.value) }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
}

// MARK: - Process info lookup

/// PID-to-process-info cache
private var pidCache = [Int32: ProcessInfo]()

func clearPidCache() {
    pidCache.removeAll()
}

func getProcessInfo(pid: Int32) -> ProcessInfo? {
    if let cached = pidCache[pid] { return cached }

    guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
    let info = ProcessInfo(
        name: app.localizedName ?? "",
        bundleId: app.bundleIdentifier ?? ""
    )
    pidCache[pid] = info
    return info
}
