/* Classic boot probe: if popup.js never marks success, show a clear error. */
window.__PS_BOOT = false;
setTimeout(function () {
  if (window.__PS_BOOT) return;
  var status = document.getElementById("status");
  if (!status) return;
  status.textContent =
    "popup.js failed to load. Run npm run build, then Reload the add-on in about:debugging.";
  status.className = "status error";
}, 500);
