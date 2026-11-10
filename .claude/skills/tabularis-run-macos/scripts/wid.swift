// Prints the CGWindowID of the largest on-screen window owned by a pid, for
// `screencapture -l`. The app also owns several small helper windows.
import CoreGraphics

let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
var best = 0
var bestArea = 0.0
for w in list
where (w[kCGWindowOwnerPID as String] as? Int) == pid
  && (w[kCGWindowLayer as String] as? Int) == 0
  && (w[kCGWindowIsOnscreen as String] as? Bool) == true {
  let b = w[kCGWindowBounds as String] as! [String: Double]
  let area = b["Width"]! * b["Height"]!
  if area > bestArea {
    bestArea = area
    best = w[kCGWindowNumber as String] as! Int
  }
}
print(best)
