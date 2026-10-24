// Pure physical-key state. OS reads and event emission stay in Launcher.swift.
struct NativeKeyResult {
    var swallow = false
    var recorded: Int64? = nil
    var events: [String] = []
}
struct NativeKeyState {
    private var key: Int64 = -1
    private var capture = false
    private var active = false
    private var physicalHold = false
    private var pressed: Set<Int64> = []
    private var paired: Set<Int64> = []

    mutating func configure(key: Int64, capture: Bool, physical: Set<Int64>) -> [String] {
        var events: [String] = []
        if key != self.key || (capture && !self.capture) {
            if active { events.append("cancel") }
            active = false; physicalHold = false
        }
        if capture && !self.capture { pressed = physical }
        self.key = key; self.capture = capture
        return events
    }
    mutating func interrupt() -> [String] {
        let events = active ? ["cancel"] : []
        active = false; physicalHold = false
        pressed.removeAll(); paired.removeAll()
        return events
    }
    mutating func feed(code: Int64, down: Bool, up: Bool, repeated: Bool,
                       modifier: Bool, suppress: Bool, otherModifier: Bool,
                       physical: (Int64) -> Bool) -> NativeKeyResult {
        var result = NativeKeyResult()
        pressed = pressed.filter { $0 == code || physical($0) }
        if physicalHold && code != key && !physical(key) {
            if active { result.events.append("cancel") }
            active = false; physicalHold = false
        }
        let already = pressed.contains(code)
        if up { pressed.remove(code) }
        let wasPaired = paired.contains(code)
        if wasPaired {
            if up { paired.remove(code) }
            if code != key || capture || down { result.swallow = true; return result }
        }
        if capture && down && !repeated && !already {
            capture = false; active = false; physicalHold = false
            paired.insert(code); result.swallow = true; result.recorded = code
            return result
        }
        if down { pressed.insert(code) }
        if code == key {
            if down && !repeated && !physicalHold && !already {
                physicalHold = true
                if !modifier || (!otherModifier && pressed.allSatisfy({ $0 == code })) {
                    active = true; result.events.append("down")
                }
            } else if up {
                physicalHold = false
                if active { active = false; result.events.append("up") }
            }
            if suppress && down && !repeated && !already { paired.insert(code) }
            result.swallow = (down && paired.contains(code)) || (up && wasPaired)
        } else if down && active {
            active = false; result.events.append("cancel")
        }
        return result
    }
}
