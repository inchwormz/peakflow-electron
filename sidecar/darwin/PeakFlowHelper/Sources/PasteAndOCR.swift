/**
 * Paste (Cmd+V) and OCR for QuickBoard on macOS.
 *
 * Paste posts a CGEvent keystroke. That needs only the Accessibility
 * permission (no Automation/AppleEvents prompt, unlike osascript +
 * System Events). OCR uses Apple's Vision framework, on-device.
 */

import Cocoa
import ApplicationServices
import Vision

/// Frontmost on-screen app window that does not belong to `excludedPid`.
/// CGWindowList returns windows front-to-back, so the first match is the
/// app the user was in before PeakFlow took focus.
private func previousAppPid(excluding excludedPid: Int32) -> Int32? {
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for info in windows {
        guard let pid = info[kCGWindowOwnerPID as String] as? Int32, pid != excludedPid else { continue }
        if let layer = info[kCGWindowLayer as String] as? Int, layer != 0 { continue }
        guard let app = NSRunningApplication(processIdentifier: pid),
              app.activationPolicy == .regular else { continue }
        return pid
    }
    return nil
}

/// Send Cmd+V to the focused app. If PeakFlow (our parent process) is still
/// frontmost, hand focus back to the previous app first.
func pasteCmdV() -> String {
    return jsonLine(sendPaste())
}

/// The keystroke behind `paste`, as {"ok", "trusted", "error"?}.
func sendPaste() -> [String: Any] {
    guard AXIsProcessTrusted() else {
        return ["ok": false, "trusted": false]
    }

    let peakflowPid = getppid()
    if let front = NSWorkspace.shared.frontmostApplication,
       front.processIdentifier == peakflowPid,
       let target = previousAppPid(excluding: peakflowPid),
       let app = NSRunningApplication(processIdentifier: target) {
        app.activate(options: [])
        usleep(150_000)
    }

    let source = CGEventSource(stateID: .combinedSessionState)
    let vKey: CGKeyCode = 9 // kVK_ANSI_V
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: false) else {
        return ["ok": false, "trusted": true, "error": "could not create key event"]
    }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return ["ok": true, "trusted": true]
}

/// Recognise text in an image file with Vision. Returns {"text": "..."}.
func recognizeText(path: String) -> String {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return jsonLine(["text": "", "error": "could not read image"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return jsonLine(["text": "", "error": error.localizedDescription])
    }

    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return jsonLine(["text": lines.joined(separator: "\n")])
}
