import Foundation
var failures = 0
func check(_ value: Bool, _ message: String) {
    if !value { failures += 1; print("FAIL: \(message)") }
}
func feed(_ s: inout NativeKeyState, _ code: Int64, _ down: Bool, _ physical: Set<Int64> = [], _ repeated: Bool = false) -> NativeKeyResult {
    s.feed(code: code, down: down, up: !down, repeated: repeated,
           modifier: code == 62, suppress: code != 62, otherModifier: false,
           physical: { physical.contains($0) })
}
var s = NativeKeyState()
_ = feed(&s, 0, true, [0])
_ = s.configure(key: 62, capture: true, physical: [0])
check(!feed(&s, 0, true, [0], true).swallow, "K1: repeat forwards")
check(!feed(&s, 0, false).swallow, "K1: held typing release forwards")
check(feed(&s, 122, true, [122]).recorded == 122, "K1: fresh press records")
_ = s.configure(key: 62, capture: false, physical: [122])
check(feed(&s, 122, false).swallow, "K1: consumed down retains paired release")
s = NativeKeyState()
_ = s.configure(key: 62, capture: true, physical: [0])
check(feed(&s, 0, true, [0]).recorded == nil, "K1: held before capture is ignored")
_ = feed(&s, 0, false)
check(feed(&s, 53, true, [53]).recorded == 53, "K6: Escape reaches recorder cancellation")
check(feed(&s, 53, false).swallow, "K6: Escape release paired")
s = NativeKeyState()
_ = s.configure(key: 62, capture: false, physical: [])
_ = feed(&s, 0, true, [0]) // lost key-up
var events: [String] = []
for down in [true, false, true, false] { events += feed(&s, 62, down, down ? [62] : []).events }
check(events == ["down", "up", "down", "up"], "K2: lost release recovers hold and both taps")
_ = feed(&s, 62, true, [62])
check(s.configure(key: 122, capture: false, physical: [62]) == ["cancel"], "K6: settings mid-hold cancels")
check(feed(&s, 62, false).events.isEmpty, "K6: old hold release cannot end new hold")
check(!feed(&s, 122, false).swallow, "K1: unmatched release forwards")
_ = feed(&s, 122, true, [122])
check(s.interrupt() == ["cancel"], "K2/K6: tap disabled mid-hold cancels")
check(feed(&s, 122, false).events.isEmpty, "K6: interrupted release cannot finish hold")
check(!feed(&s, 122, false).swallow, "K1: interruption clears pair ownership")
if failures != 0 { exit(1) }
print("Swift native key sequences passed")
