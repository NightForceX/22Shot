window.__PS_BOOT = false;
setTimeout(function () {
  if (window.__PS_BOOT) return;
  var status = document.getElementById("status");
  if (!status) return;
  status.textContent =
    "options.js failed to load. Run npm run build, then Reload the add-on in about:debugging.";
  status.style.color = "#c50042";
}, 500);
