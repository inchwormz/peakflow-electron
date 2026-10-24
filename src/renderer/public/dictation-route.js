// Run before first paint; packaged renderers allow only scripts from self.
if (new URLSearchParams(location.search).get('toolId') === 'dictation') {
  document.documentElement.setAttribute('data-dictation-pill', '')
}
