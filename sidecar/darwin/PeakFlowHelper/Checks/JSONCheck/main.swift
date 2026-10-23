// Encoder check, compiled with ../../Sources/JSON.swift + ActiveWindow.swift
// by scripts/checks/helper-json.check.mts. Prints one JSON reply per line.
let tricky = "Line one\nline two \"quoted\" back\\slash\ttab \u{2028} é 🎉"
let win = WindowInfo(pid: 42, x: 1.5, y: -2, w: 800, h: 600, title: tricky, bundleId: "com.example.app", appName: "App \"X\"\n")
print(win.toJSON())
print(jsonString([WindowRect(x: 0, y: 0, w: 10, h: 10).jsonObject]))
print(jsonString([AppInfo(bundleId: "com.example.app", name: tricky).jsonObject]))
print(ProcessInfo(name: tricky, bundleId: "com.example.app").toJSON())
print(jsonString(["error": "Unknown command: \(tricky)"]))
print(jsonString(["x": Double.nan]))
