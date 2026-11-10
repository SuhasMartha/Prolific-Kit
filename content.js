(function () {
  if (window.__prolific_notifier_content_injected__) {
    console.log("[Prolific Notifier] Content script already injected in this window. Skipping duplicate execution.");
    return;
  }
  window.__prolific_notifier_content_injected__ = true;

  // Content Script for Prolific Study Notifier Pro
  // Runs in the page context of app.prolific.com (Isolated World)

  // Catch and handle any uncaught promise rejections from standard network/fetch drops in content script
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const isFetchError = reason && (reason.name === 'TypeError' || (reason.message && (reason.message.includes('Failed to fetch') || reason.message.includes('failed to fetch'))));
    if (isFetchError) {
      console.warn("[Content] Unhandled network fetch rejection caught:", reason.message || reason);
      event.preventDefault();
    }
  });

  // 1. Inject script to execute in the page's MAIN world context.
  // Using src = chrome.runtime.getURL ensures the script is loaded as an external resource,
  // which complies with strict page CSP rules that block inline textContent scripts.
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    console.error("[Prolific Notifier] Failed to inject token capture script:", e);
  }

  let checkIntervalId = null;

  // 2. Helper context validation and cleanup utilities
  function isContextValid() {
    try {
      return typeof chrome !== 'undefined' &&
        chrome.runtime &&
        typeof chrome.runtime.getManifest === 'function' &&
        !!chrome.runtime.getManifest();
    } catch (e) {
      return false;
    }
  }

  function cleanUpInvalidatedContext() {
    if (checkIntervalId) {
      console.log("[Prolific Notifier] Extension context invalidated. Stopping page polling loop.");
      clearInterval(checkIntervalId);
      checkIntervalId = null;
    }
    const existing = document.getElementById("prolific-notifier-overlay");
    if (existing) {
      existing.remove();
    }
  }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) {
      cleanUpInvalidatedContext();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "";
          if (errMsg.includes("context invalidated") || errMsg.includes("Extension context invalidated")) {
            cleanUpInvalidatedContext();
            return;
          }
        }
        if (callback) callback(response);
      });
    } catch (e) {
      cleanUpInvalidatedContext();
    }
  }

  let stateResolveFn = null;

  // 3. Listen to token messages from our injected MAIN-world script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data && event.data.type === 'PROLIFIC_AUTH_HEADER') {
      const authHeader = event.data.authHeader;
      const apiBase = event.data.apiBase;
      safeSendMessage({ action: "save_auth_header", authHeader, apiBase });
    } else if (event.data && event.data.type === 'PROLIFIC_STATE_RESPONSE') {
      if (stateResolveFn) {
        stateResolveFn(event.data.studies);
      }
    }
  });

  function checkToken(val) {
    if (!val || typeof val !== 'string') return null;
    let clean = val.trim();

    if (clean.startsWith('"') && clean.endsWith('"')) {
      clean = clean.slice(1, -1).trim();
    }
    if (clean.startsWith("'") && clean.endsWith("'")) {
      clean = clean.slice(1, -1).trim();
    }

    let isPrefixed = false;
    let type = "Bearer";
    if (clean.toLowerCase().startsWith("bearer ")) {
      clean = clean.substring(7).trim();
      type = "Bearer";
      isPrefixed = true;
    } else if (clean.toLowerCase().startsWith("token ")) {
      clean = clean.substring(6).trim();
      type = "Token";
      isPrefixed = true;
    }

    if (isPrefixed && clean.length > 10) {
      return type + " " + clean;
    }

    if (clean.startsWith('{') || clean.startsWith('[') || clean.startsWith('<')) {
      return null;
    }

    if (/^[0-9a-fA-F]{40}$/.test(clean)) {
      return type + " " + clean;
    }

    const parts = clean.split('.');
    if (parts.length === 3 && parts.every(part => part.length > 0)) {
      if (/^[a-zA-Z0-9_\-\+\/=]+$/.test(parts[0]) &&
        /^[a-zA-Z0-9_\-\+\/=]+$/.test(parts[1]) &&
        /^[a-zA-Z0-9_\-\+\/=]+$/.test(parts[2])) {
        return "Bearer " + clean;
      }
    }
    return null;
  }

  function scanValue(val, depth = 0) {
    if (!val || depth > 5) return null;
    if (typeof val === 'string') {
      const clean = val.trim();
      const header = checkToken(clean);
      if (header) {
        return header;
      }
      if (clean.startsWith('{') || clean.startsWith('[')) {
        try {
          const parsed = JSON.parse(clean);
          return scanValue(parsed, depth + 1);
        } catch (e) { }
      }
    } else if (typeof val === 'object') {
      for (const key in val) {
        try {
          const found = scanValue(val[key], depth + 1);
          if (found) return found;
        } catch (e) { }
      }
    }
    return null;
  }

  function scanLocalStorageForToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("oidc.user:")) {
          const val = localStorage.getItem(key);
          if (val) {
            try {
              const parsed = JSON.parse(val);
              if (parsed && parsed.access_token) {
                return "Bearer " + parsed.access_token;
              }
            } catch (e) { }
          }
        }
      }
    } catch (e) {
      console.error("[Prolific Notifier] Error scanning localStorage directly:", e);
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        const found = scanValue(val);
        if (found) return found;
      }
    } catch (e) {
      console.error("[Prolific Notifier] Error scanning localStorage:", e);
    }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);
        const found = scanValue(val);
        if (found) return found;
      }
    } catch (e) {
      console.error("[Prolific Notifier] Error scanning sessionStorage:", e);
    }
    return null;
  }

  // Check for studies and balance
  async function checkProlificData() {
    if (!isContextValid()) {
      cleanUpInvalidatedContext();
      return;
    }

    const path = window.location.pathname.toLowerCase();
    if (path.includes("/login") || path.includes("/register") || path.includes("/signup") || path.includes("/logout") || path.includes("/welcome")) {
      console.log("[Prolific Notifier] Active page is authentication/welcome. Skipping checks.");
      return;
    }

    console.log("[Prolific Notifier] Executing study and balance check from page context...");

    try {
      chrome.storage.local.get(["authHeader", "apiBase"], async (store) => {
        if (!isContextValid()) {
          cleanUpInvalidatedContext();
          return;
        }

        let authHeader = store ? store.authHeader : null;

        const localToken = scanLocalStorageForToken();
        if (localToken && localToken !== authHeader) {
          console.log("[Prolific Notifier] Found fresh token in page storage. Updating authHeader...");
          authHeader = localToken;
          safeSendMessage({ action: "save_auth_header", authHeader: localToken, apiBase: window.location.origin });
        }

        const resolvedApiBase = window.location.origin.replace("://app.", "://api.");

        try {
          // Try Mode 1: React Store State extraction (silent, no HTTP requests, CORS-safe)
          let studies = null;
          try {
            studies = await new Promise((resolve) => {
              stateResolveFn = resolve;
              window.postMessage({ type: "PROLIFIC_REQUEST_STATE" }, "*");
              setTimeout(() => {
                if (stateResolveFn === resolve) {
                  stateResolveFn = null;
                  resolve(null); // Timeout fallback to Mode 2
                }
              }, 1500);
            });
          } catch (err) {
            console.log("[Prolific Notifier] React state query failed, falling back to fetch:", err);
          }

          if (studies !== null) {
            console.log("[Prolific Notifier] Studies successfully extracted from page React state:", studies.length);
            safeSendMessage({
              action: "studies_fetched",
              studies: studies
            });
          } else {
            // Fallback Mode 2: Fetch studies list from participant/studies endpoint
            console.log("[Prolific Notifier] React state timeout or failed. Falling back to API fetch...");

            let studiesResponse;
            if (authHeader) {
              studiesResponse = await fetch(`${resolvedApiBase}/api/v1/participant/studies/?is_assistant=1`, {
                method: "GET",
                headers: {
                  "Accept": "application/json",
                  "Authorization": authHeader,
                  "x-legacy-auth": "false",
                  "x-client-version": "prolific-assistant/5.36.0"
                }
              });
            }

            // If unauthorized or no authHeader, retry with cookies in first-party context
            if (!studiesResponse || studiesResponse.status === 401 || studiesResponse.status === 403) {
              console.log("[Prolific Notifier] Token missing or unauthorized. Retrying fetch with session cookies...");
              studiesResponse = await fetch(`${resolvedApiBase}/api/v1/participant/studies/?is_assistant=1`, {
                method: "GET",
                headers: {
                  "Accept": "application/json",
                  "x-legacy-auth": "false",
                  "x-client-version": "prolific-assistant/5.36.0"
                },
                credentials: "include"
              });
            }

            if (!isContextValid()) {
              cleanUpInvalidatedContext();
              return;
            }

            if (studiesResponse.status === 401 || studiesResponse.status === 403 || studiesResponse.status === 404) {
              console.log("[Prolific Notifier] Received 401/403/404 on studies check. Reloading page to force session refresh...");
              const now = Date.now();
              chrome.storage.local.get("lastTabReloadTime", (data) => {
                if (!isContextValid()) return;
                const lastReload = data.lastTabReloadTime || 0;
                if (now - lastReload > 300000) { // 5 mins cooldown
                  chrome.storage.local.set({ lastTabReloadTime: now }, () => {
                    window.location.reload();
                  });
                } else {
                  safeSendMessage({
                    action: "update_status",
                    status: "Unauthorized (Please log in)",
                    error: "Your session is expired or invalid. Please open Prolific and log in."
                  });
                }
              });
              return;
            }

            if (!studiesResponse.ok) {
              throw new Error(`Studies check failed with status: ${studiesResponse.status}`);
            }

            // Verify response is JSON (prevent parsing HTML redirect pages)
            const studiesContentType = studiesResponse.headers.get("content-type") || "";
            if (!studiesContentType.includes("application/json")) {
              console.log("[Prolific Notifier] Studies response was not JSON. Attempting to reload page to refresh session...");
              const now = Date.now();
              chrome.storage.local.get("lastTabReloadTime", (data) => {
                if (!isContextValid()) return;
                const lastReload = data.lastTabReloadTime || 0;
                if (now - lastReload > 300000) { // 5 mins cooldown
                  chrome.storage.local.set({ lastTabReloadTime: now }, () => {
                    window.location.reload();
                  });
                } else {
                  safeSendMessage({
                    action: "update_status",
                    status: "Unauthorized (Please log in)",
                    error: "Your session is invalid or expired. Please refresh the page and log in."
                  });
                }
              });
              return;
            }

            const data = await studiesResponse.json();

            if (!isContextValid()) {
              cleanUpInvalidatedContext();
              return;
            }

            safeSendMessage({
              action: "studies_fetched",
              studies: data.results || []
            });
          }

          // B. Fetch user profile balance from dynamic base
          let balanceResponse;
          if (authHeader) {
            balanceResponse = await fetch(`${resolvedApiBase}/api/v1/users/me/`, {
              method: "GET",
              headers: {
                "Accept": "application/json",
                "Authorization": authHeader
              }
            });
          }

          if (!balanceResponse || balanceResponse.status === 401 || balanceResponse.status === 403) {
            balanceResponse = await fetch(`${resolvedApiBase}/api/v1/users/me/`, {
              method: "GET",
              headers: {
                "Accept": "application/json"
              },
              credentials: "include"
            });
          }

          if (!isContextValid()) {
            cleanUpInvalidatedContext();
            return;
          }

          if (balanceResponse.ok) {
            const balanceContentType = balanceResponse.headers.get("content-type") || "";
            if (balanceContentType.includes("application/json")) {
              const userData = await balanceResponse.json();
              if (!isContextValid()) {
                cleanUpInvalidatedContext();
                return;
              }
              safeSendMessage({
                action: "balance_fetched",
                userData: userData
              });
            }
          }
        } catch (error) {
          const isFetchError = error && (error.name === 'TypeError' || (error.message && (error.message.includes('Failed to fetch') || error.message.includes('failed to fetch'))));
          if (isFetchError) {
            console.warn("[Prolific Notifier] Network/fetch check failed (CORS/Network fallback triggering):", error.message || error);
          } else {
            console.error("[Prolific Notifier] Error fetching data (CORS/Network fallback triggering):", error);
          }
          const isOffline = !navigator.onLine || (error.message && error.message.includes("Failed to fetch"));
          if (isOffline) {
            safeSendMessage({
              action: "update_status",
              status: "Offline (Reconnecting...)",
              error: "Network connection lost. Waiting for connection..."
            });
          } else {
            safeSendMessage({
              action: "content_fetch_failed",
              error: error.message || "Failed to fetch in content script"
            });
          }
        }
      });
    } catch (e) {
      if (e.message.includes("context invalidated") || e.message.includes("Extension context invalidated")) {
        cleanUpInvalidatedContext();
      } else {
        console.error("[Prolific Notifier] Storage/runtime access error:", e);
      }
    }
  }

  // Dynamic site theme controller
  function updateThemeOnPage(themeMode) {
    let styleEl = document.getElementById("prolific-dark-mode-styles");

    if (themeMode === "dark") {
      document.documentElement.classList.add("prolific-dark-mode");
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "prolific-dark-mode-styles";
        styleEl.textContent = `
        html.prolific-dark-mode {
          filter: invert(1) hue-rotate(180deg) !important;
          background-color: #000000 !important;
        }
        /* Invert back images, svgs, and videos to retain original color */
        html.prolific-dark-mode img,
        html.prolific-dark-mode svg,
        html.prolific-dark-mode video,
        html.prolific-dark-mode iframe,
        html.prolific-dark-mode canvas,
        html.prolific-dark-mode [style*="background-image"] {
          filter: invert(1) hue-rotate(180deg) !important;
        }
        /* Ensure background is solid black and text contrast is preserved */
        html.prolific-dark-mode body {
          background-color: #000000 !important;
        }
      `;
        (document.head || document.documentElement).appendChild(styleEl);
      }
    } else {
      document.documentElement.classList.remove("prolific-dark-mode");
      if (styleEl) {
        styleEl.remove();
      }
    }
  }

  function startPolling(seconds) {
    if (checkIntervalId) clearInterval(checkIntervalId);
    const ms = seconds * 1000;
    console.log(`[Prolific Notifier] Starting page polling loop: every ${seconds}s`);
    checkIntervalId = setInterval(checkProlificData, ms);
  }

  // Perform initial check on load (delayed by 5s to let the page settle/re-auth), then poll based on storage settings
  setTimeout(checkProlificData, 5000);

  if (isContextValid()) {
    try {
      chrome.storage.local.get(["interval", "themeMode"], (data) => {
        if (!isContextValid()) {
          cleanUpInvalidatedContext();
          return;
        }
        const sec = (data && data.interval) || 60;
        startPolling(sec);

        const theme = (data && data.themeMode) || "light";
        updateThemeOnPage(theme);
      });

      // Watch for changes in settings dynamically
      chrome.storage.onChanged.addListener((changes) => {
        if (!isContextValid()) {
          cleanUpInvalidatedContext();
          return;
        }
        if (changes.interval && changes.interval.newValue) {
          startPolling(changes.interval.newValue);
        }
        if (changes.themeMode) {
          updateThemeOnPage(changes.themeMode.newValue);
        }
        if (changes.activeStudies || changes.lastCheckTime || changes.checkerStatus || changes.overlayCollapsed) {
          updateOverlayUI();
        }
        if (changes.overlayEnabled) {
          checkAndToggleOverlay();
        }
      });

      // Listen to manual trigger requests from the background service worker
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isContextValid()) {
          cleanUpInvalidatedContext();
          return;
        }
        if (message.action === "trigger_check") {
          checkProlificData().then(() => {
            if (isContextValid()) {
              sendResponse({ success: true });
            }
          }).catch((err) => {
            console.error("[Prolific Notifier] trigger_check error:", err);
          });
          return true; // Keep message channel open for async response
        }
      });

      // Listen to online events to recover instantly after sleep or disconnect
      window.addEventListener('online', () => {
        if (!isContextValid()) {
          cleanUpInvalidatedContext();
          return;
        }
        console.log("[Prolific Notifier] Browser went online. Recovering from sleep/offline and checking studies immediately...");
        checkProlificData();
      });
    } catch (e) {
      cleanUpInvalidatedContext();
    }
  }

  // Browser Floating Overlay Widget Implementation
  function makeElementDraggable(elmnt, header) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      // Don't drag if clicking toggle button
      if (e.target.closest('button')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;

      const newTop = elmnt.offsetTop - pos2;
      const newLeft = elmnt.offsetLeft - pos1;

      const maxTop = window.innerHeight - elmnt.offsetHeight - 10;
      const maxLeft = window.innerWidth - elmnt.offsetWidth - 10;

      elmnt.style.top = Math.max(10, Math.min(newTop, maxTop)) + "px";
      elmnt.style.left = Math.max(10, Math.min(newLeft, maxLeft)) + "px";
      elmnt.style.bottom = "auto";
      elmnt.style.right = "auto";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;

      if (isContextValid()) {
        chrome.storage.local.set({
          overlayPosition: {
            top: elmnt.style.top,
            left: elmnt.style.left
          }
        });
      }
    }
  }

  function updateOverlayUI() {
    if (!isContextValid()) return;
    chrome.storage.local.get(["activeStudies", "lastCheckTime", "overlayCollapsed"], (data) => {
      const activeCount = (data.activeStudies || []).length;
      const lastCheck = data.lastCheckTime || 0;

      const countEl = document.getElementById("prolific-overlay-count");
      const timeEl = document.getElementById("prolific-overlay-time");
      const widgetEl = document.getElementById("prolific-notifier-overlay");
      const toggleBtn = document.getElementById("prolific-overlay-toggle-btn");

      if (countEl) countEl.textContent = activeCount;
      if (timeEl) {
        if (lastCheck > 0) {
          timeEl.textContent = new Date(lastCheck).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
        } else {
          timeEl.textContent = "Never";
        }
      }

      if (widgetEl) {
        if (data.overlayCollapsed) {
          widgetEl.classList.add("collapsed");
          if (toggleBtn) toggleBtn.textContent = "▲";
        } else {
          widgetEl.classList.remove("collapsed");
          if (toggleBtn) toggleBtn.textContent = "▼";
        }
      }
    });
  }

  function injectOverlayWidget() {
    if (document.getElementById("prolific-notifier-overlay")) return;

    let style = document.getElementById("prolific-overlay-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "prolific-overlay-styles";
      style.textContent = `
    .prolific-overlay-widget {
      position: fixed;
      top: 70px;
      right: 20px;
      width: 150px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1e293b;
      overflow: hidden;
      transition: width 0.2s, height 0.2s;
    }
    .prolific-overlay-header {
      padding: 6px 10px;
      background: rgba(0, 83, 198, 0.05);
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
    }
    .prolific-overlay-title {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #0053C6;
    }
    .prolific-overlay-toggle {
      background: none;
      border: none;
      font-size: 10px;
      cursor: pointer;
      padding: 2px;
      color: #64748b;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .prolific-overlay-body {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11px;
    }
    .prolific-overlay-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .prolific-overlay-lbl {
      color: #64748b;
      font-weight: 500;
    }
    .prolific-overlay-val {
      font-weight: 600;
    }
    .prolific-overlay-val.active-count {
      color: #16a34a;
      font-weight: 700;
      font-size: 12.5px;
    }
    .prolific-overlay-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #22c55e;
      display: inline-block;
    }
    .prolific-overlay-widget.collapsed {
      height: 27px;
      width: 120px;
    }
    .prolific-overlay-widget.collapsed .prolific-overlay-body {
      display: none;
    }
  `;
      document.head.appendChild(style);
    }

    const widget = document.createElement("div");
    widget.id = "prolific-notifier-overlay";
    widget.className = "prolific-overlay-widget";

    widget.innerHTML = `
    <div class="prolific-overlay-header" id="prolific-overlay-drag-handle">
      <span class="prolific-overlay-title">Notifier Pro</span>
      <button class="prolific-overlay-toggle" id="prolific-overlay-toggle-btn">▼</button>
    </div>
    <div class="prolific-overlay-body">
      <div class="prolific-overlay-row">
        <span class="prolific-overlay-lbl">Studies:</span>
        <span class="prolific-overlay-val active-count" id="prolific-overlay-count">0</span>
      </div>
      <div class="prolific-overlay-row">
        <span class="prolific-overlay-lbl">Last Seen:</span>
        <span class="prolific-overlay-val" id="prolific-overlay-time">Never</span>
      </div>
    </div>
  `;

    document.body.appendChild(widget);

    const dragHandle = document.getElementById("prolific-overlay-drag-handle");
    makeElementDraggable(widget, dragHandle);

    const toggleBtn = document.getElementById("prolific-overlay-toggle-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        if (!isContextValid()) {
          cleanUpInvalidatedContext();
          return;
        }
        try {
          chrome.storage.local.get("overlayCollapsed", (data) => {
            if (!isContextValid()) {
              cleanUpInvalidatedContext();
              return;
            }
            const newState = !data.overlayCollapsed;
            chrome.storage.local.set({ overlayCollapsed: newState }, () => {
              if (isContextValid()) {
                updateOverlayUI();
              }
            });
          });
        } catch (e) {
          cleanUpInvalidatedContext();
        }
      });
    }

    if (isContextValid()) {
      try {
        chrome.storage.local.get(["overlayPosition", "overlayCollapsed"], (data) => {
          if (!isContextValid()) {
            cleanUpInvalidatedContext();
            return;
          }
          if (data.overlayPosition) {
            widget.style.top = data.overlayPosition.top;
            widget.style.left = data.overlayPosition.left;
            widget.style.bottom = "auto";
            widget.style.right = "auto";
          }
          if (data.overlayCollapsed) {
            widget.classList.add("collapsed");
            if (toggleBtn) toggleBtn.textContent = "▲";
          }
          updateOverlayUI();
        });
      } catch (e) {
        cleanUpInvalidatedContext();
      }
    } else {
      cleanUpInvalidatedContext();
    }
  }

  function checkAndToggleOverlay() {
    if (!isContextValid()) {
      cleanUpInvalidatedContext();
      return;
    }
    chrome.storage.local.get("overlayEnabled", (data) => {
      if (!isContextValid()) {
        cleanUpInvalidatedContext();
        return;
      }
      const enabled = data.overlayEnabled === true;
      const existing = document.getElementById("prolific-notifier-overlay");
      if (enabled) {
        if (!existing) {
          if (document.body) {
            injectOverlayWidget();
          } else {
            document.addEventListener("DOMContentLoaded", () => {
              if (!isContextValid()) return;
              try {
                chrome.storage.local.get("overlayEnabled", (d) => {
                  if (!isContextValid()) return;
                  if (d && d.overlayEnabled === true) {
                    injectOverlayWidget();
                  }
                });
              } catch (e) {
                // Ignore
              }
            });
          }
        }
      } else {
        if (existing) {
          existing.remove();
        }
      }
    });
  }

  if (isContextValid()) {
    checkAndToggleOverlay();
  }

  // Automatically acknowledge studies when Prolific tab is opened or becomes visible
  function autoAcknowledgeActiveStudies() {
    if (isContextValid()) {
      chrome.runtime.sendMessage({ action: "prolific_opened" });
    }
  }

  // Run on load
  autoAcknowledgeActiveStudies();

  // Run when tab visibility changes (e.g. switching back to Prolific tab)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      autoAcknowledgeActiveStudies();
    }
  });
  window.addEventListener("focus", autoAcknowledgeActiveStudies);
})();
