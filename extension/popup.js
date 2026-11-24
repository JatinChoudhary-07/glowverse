const tokenInput = document.getElementById('token')
const saveButton = document.getElementById('save')
const dot = document.getElementById('dot')
const state = document.getElementById('state')

function showStatus(status) {
  const connected = Boolean(status && status.connected)
  dot.classList.toggle('dot--on', connected)
  state.textContent = connected
    ? 'Connected'
    : status && status.hasToken
      ? 'Disconnected — is Glowverse running?'
      : 'Paste a token to connect'
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'glowverse:status' }, showStatus)
}

chrome.storage.local.get(['glowverseToken']).then((stored) => {
  tokenInput.value = typeof stored.glowverseToken === 'string' ? stored.glowverseToken : ''
})

saveButton.addEventListener('click', () => {
  const token = tokenInput.value.trim()
  chrome.runtime.sendMessage({ type: 'glowverse:pair', token }, showStatus)
})

refresh()
setInterval(refresh, 2000)
