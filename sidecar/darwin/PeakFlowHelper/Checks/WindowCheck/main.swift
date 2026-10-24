// Compile with Sources/JSON.swift + ActiveWindow.swift, like Checks/JSONCheck.
import Cocoa
import ApplicationServices

func window(pid: Int32 = 42, width: CGFloat = 1820, height: CGFloat = 1410,
            alpha: CGFloat = 1, layer: Int = 0) -> [String: Any] {
    return [
        kCGWindowOwnerPID as String: pid,
        kCGWindowBounds as String: ["X": CGFloat(-1), "Y": CGFloat(30), "Width": width, "Height": height],
        kCGWindowAlpha as String: alpha,
        kCGWindowLayer as String: layer
    ]
}

func pick(_ windows: [[String: Any]]) -> WindowInfo? {
    return selectWindowFromCGWindowList(windows, pid: 42, bundleId: "com.google.Chrome", appName: "Chrome")
}

let real = window()
let bubble = window(width: 386, height: 22)
let transparent = window(alpha: 0)
precondition(pick([bubble, transparent, real])?.h == 1410, "skip Chrome link bubble and invisible window")
precondition(pick([bubble, transparent]) == nil, "never fall back to a rejected window")
precondition(pick([]) == nil)
precondition(pick([window(pid: 99), window(layer: 1), real])?.pid == 42)
precondition(pick([window(width: 49, height: 600), window(width: 800, height: 49)]) == nil)
precondition(pick([window(width: 50, height: 50)])?.w == 50)
precondition(pick([window(width: 500, height: 400, alpha: 0.5), real])?.w == 500, "keep front-to-back ordering")
var withoutAlpha = real
withoutAlpha.removeValue(forKey: kCGWindowAlpha as String)
precondition(pick([withoutAlpha]) != nil, "missing alpha preserves existing behavior")

precondition(isAXFocusWindow(role: kAXWindowRole, subrole: kAXStandardWindowSubrole, width: 1820, height: 1410))
precondition(isAXFocusWindow(role: kAXWindowRole, subrole: kAXDialogSubrole, width: 300, height: 200))
precondition(!isAXFocusWindow(role: kAXHelpTagRole, subrole: "AXUnknown", width: 386, height: 22))
precondition(!isAXFocusWindow(role: kAXHelpTagRole, subrole: nil, width: 800, height: 600))
precondition(!isAXFocusWindow(role: kAXWindowRole, subrole: kAXHelpTagRole, width: 800, height: 600))
precondition(!isAXFocusWindow(role: kAXWindowRole, subrole: nil, width: 386, height: 22))
precondition(!isAXFocusWindow(role: nil, subrole: nil, width: 800, height: 600))
print("window selection check: OK")
