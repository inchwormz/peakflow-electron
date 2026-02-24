/**
 * PeakFlow Focus — Popup script
 * Reads cached state from chrome.storage and renders status UI.
 */

function formatTime(secs) {
  var m = Math.floor(secs / 60);
  var s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function getModeText(state) {
  if (state.active && state.mode === 'work') return 'Focus session in progress';
  if (state.mode === 'short_break') return 'Short break';
  if (state.mode === 'long_break') return 'Long break';
  return 'Timer is idle';
}

function render(state, isConnected) {
  var pill = document.getElementById('status-pill');
  var statusText = document.getElementById('status-text');
  var connView = document.getElementById('connected-view');
  var discView = document.getElementById('disconnected-view');

  if (!isConnected) {
    pill.className = 'status-pill disconnected';
    statusText.textContent = 'Off';
    connView.style.display = 'none';
    discView.style.display = 'block';
    return;
  }

  pill.className = 'status-pill connected';
  statusText.textContent = 'Live';
  connView.style.display = 'block';
  discView.style.display = 'none';

  document.getElementById('mode-text').textContent = getModeText(state);

  var timerEl = document.getElementById('timer-display');
  timerEl.textContent = formatTime(state.remaining || 0);
  timerEl.className = 'timer-display ' + (state.active ? 'work' : state.mode === 'idle' ? 'idle' : 'break');

  var listEl = document.getElementById('site-list');
  var emptyEl = document.getElementById('empty-state');
  listEl.innerHTML = '';

  if (state.sites && state.sites.length > 0) {
    emptyEl.style.display = 'none';
    state.sites.forEach(function (site) {
      var li = document.createElement('li');
      var icon = document.createElement('span');
      icon.className = 'block-icon';
      icon.textContent = '\u270B';
      li.appendChild(icon);
      li.appendChild(document.createTextNode(site));
      listEl.appendChild(li);
    });
  } else {
    emptyEl.style.display = 'block';
  }
}

// Initial render from cached state
chrome.storage.local.get(['peakflowState', 'connected'], function (data) {
  var state = data.peakflowState || { active: false, mode: 'idle', sites: [], remaining: 0 };
  render(state, data.connected || false);
});

// Live updates while popup is open
chrome.storage.onChanged.addListener(function () {
  chrome.storage.local.get(['peakflowState', 'connected'], function (data) {
    var state = data.peakflowState || { active: false, mode: 'idle', sites: [], remaining: 0 };
    render(state, data.connected || false);
  });
});
