import { csharpNativeKeyDecision } from './native-key-state'

/** Pure C# shell around the shared transition table; no Windows API calls. */
export function windowsKeyStateSource(): string {
  return `
class NativeKeyResult {
  public bool swallow;
  public int recorded = -1;
  public List<string> events = new List<string>();
}
class NativeKeyState {
  int key;
  bool capture, active, physicalHold;
  HashSet<uint> pressed = new HashSet<uint>();
  HashSet<uint> paired = new HashSet<uint>();
  ${csharpNativeKeyDecision()}
  public List<string> Configure(int nextKey, bool nextCapture, HashSet<uint> physical) {
    List<string> events = new List<string>();
    if (key != nextKey || (nextCapture && !capture)) {
      if (active) events.Add("cancel");
      active = physicalHold = false;
    }
    if (nextCapture && !capture) pressed = new HashSet<uint>(physical);
    key = nextKey; capture = nextCapture;
    return events;
  }
  public NativeKeyResult Feed(uint code, bool down, bool up, bool repeat, bool modifier, bool suppress, bool otherModifier, HashSet<uint> physical) {
    NativeKeyResult result = new NativeKeyResult();
    // Low-level hooks run before async state includes this event: only reconcile OTHER keys.
    pressed.RemoveWhere(delegate(uint k) { return k != code && !physical.Contains(k); });
    if (physicalHold && code != (uint)key && !physical.Contains((uint)key)) {
      if (active) result.events.Add("cancel");
      active = physicalHold = false;
    }
    bool already = pressed.Contains(code);
    if (up) pressed.Remove(code);
    bool wasPaired = paired.Contains(code);
    if (wasPaired) {
      if (up) paired.Remove(code);
      if (code != (uint)key || capture || down) { result.swallow = true; return result; }
    }
    bool alone = !otherModifier;
    if (modifier) foreach (uint k in pressed) {
      if (k != code && !(key == 0xA5 && k == 0xA2)) alone = false;
    }
    int action = Decide(capture, down, up, repeat, already, code == (uint)key, active, physicalHold, !modifier || alone, suppress);
    if (down) pressed.Add(code);
    if ((action & 1) != 0) {
      capture = active = physicalHold = false;
      paired.Add(code); result.swallow = true; result.recorded = (int)code; return result;
    }
    if (code == (uint)key && down && !already && !repeat) physicalHold = true;
    if ((action & 2) != 0) { active = true; result.events.Add("down"); }
    if ((action & 4) != 0) { active = false; result.events.Add("up"); }
    if (code == (uint)key && up) physicalHold = false;
    if ((action & 8) != 0) { active = false; result.events.Add("cancel"); }
    if ((action & 16) != 0) paired.Add(code);
    result.swallow = (action & 16) != 0 || (up && wasPaired);
    return result;
  }
}
`
}
