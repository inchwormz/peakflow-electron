/**
 * PeakFlow Focus — Blocked page script
 * Reads URL params and renders the countdown timer.
 */

var params = new URLSearchParams(window.location.search);
var site = params.get('site') || 'this site';
var remaining = parseInt(params.get('remaining') || '0', 10);

document.getElementById('blocked-domain').textContent = site;

function formatTime(secs) {
  var m = Math.floor(secs / 60);
  var s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function tick() {
  document.getElementById('timer').textContent = formatTime(remaining);
  if (remaining > 0) {
    remaining--;
    setTimeout(tick, 1000);
  }
}

tick();

// Back button — no inline javascript: href allowed in MV3
document.getElementById('back-btn').addEventListener('click', function () {
  history.back();
});
