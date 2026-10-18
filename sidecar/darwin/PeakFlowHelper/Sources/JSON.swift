/**
 * JSON output for the helper. Every reply is exactly one line, so all output
 * goes through JSONSerialization: it escapes quotes, backslashes, newlines and
 * control characters in window titles and app names, which hand-built strings
 * did not (a title with a newline split one reply into two lines and
 * desynchronised the Node side).
 */

import Foundation

/// Encode a dictionary or array as one line of JSON.
func jsonString(_ object: Any) -> String {
    // isValidJSONObject also rejects NaN/Infinity, which would otherwise raise
    // an uncatchable Objective-C exception inside JSONSerialization.
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          let text = String(data: data, encoding: .utf8) else {
        return "{\"error\":\"json encoding failed\"}"
    }
    return text
}

/// Encode a dictionary as one line of JSON (handles all string escaping).
func jsonLine(_ object: [String: Any]) -> String {
    return jsonString(object)
}
