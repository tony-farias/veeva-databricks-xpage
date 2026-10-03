(function installXPageStartupGuard() {
  "use strict";

  var bootFailure;

  function describeFailure(event) {
    var target = event && event.target;
    if (target && target !== window) {
      var resource = target.src || target.href;
      if (resource) return "A required X-Page resource could not load: " + resource;
    }

    return (event && event.message) || "The X-Page application did not start.";
  }

  function showFailure(message) {
    bootFailure = bootFailure || message;

    function render() {
      var root = document.getElementById("root");
      if (!root || root.childElementCount > 0) return;

      var panel = document.createElement("div");
      panel.setAttribute("role", "alert");
      panel.style.cssText = [
        "box-sizing:border-box",
        "max-width:680px",
        "margin:48px auto",
        "padding:24px",
        "border:1px solid #f2b8b5",
        "border-radius:14px",
        "background:#fff7f6",
        "color:#5f2120",
        "font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      ].join(";");

      var title = document.createElement("strong");
      title.style.cssText = "display:block;margin-bottom:8px;font-size:18px";
      title.textContent = "This X-Page could not start";

      var detail = document.createElement("div");
      detail.textContent = bootFailure;

      panel.appendChild(title);
      panel.appendChild(detail);
      root.replaceChildren(panel);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", render, { once: true });
    } else {
      render();
    }
  }

  window.addEventListener(
    "error",
    function onStartupError(event) {
      showFailure(describeFailure(event));
    },
    true,
  );

  window.addEventListener("unhandledrejection", function onStartupRejection(event) {
    var reason = event && event.reason;
    showFailure(reason && reason.message ? reason.message : String(reason || "Startup failed."));
  });

  window.setTimeout(function checkForMountedApplication() {
    var root = document.getElementById("root");
    if (!root || root.childElementCount === 0) {
      showFailure("The application bundle did not run. Check the Web Inspector console for details.");
    }
  }, 2500);
})();
