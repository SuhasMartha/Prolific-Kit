// Main-World Injection Script for Prolific Study Notifier Pro
// Hooks page fetch/XHR and scans storage to capture session token.

(function() {
  // Helper to validate and clean token strings
  function checkToken(val) {
    if (!val || typeof val !== 'string') return null;
    let clean = val.trim();
    
    // Strip leading and trailing quotes if serialized
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

    // If it had a valid prefix, it's almost certainly a captured authorization header.
    if (isPrefixed && clean.length > 10) {
      return type + " " + clean;
    }

    // Exclude JSON/XML/HTML strings
    if (clean.startsWith('{') || clean.startsWith('[') || clean.startsWith('<')) {
      return null;
    }

    // Otherwise, we are scanning localStorage/sessionStorage.
    // 1. Classic Prolific 40-character hex token
    if (/^[0-9a-fA-F]{40}$/.test(clean)) {
      return type + " " + clean;
    }
    // 2. JWT (two dots, containing base64/base64url characters)
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

  // Recursive scanner for objects and nested JSON strings
  function scanValue(val) {
    if (!val) return null;
    if (typeof val === 'string') {
      const clean = val.trim();
      const header = checkToken(clean);
      if (header) {
        return header;
      }
      // Try parsing nested JSON strings (e.g. Redux Persist serialized state)
      if (clean.startsWith('{') || clean.startsWith('[')) {
        try {
          const parsed = JSON.parse(clean);
          return scanValue(parsed);
        } catch(e) {}
      }
    } else if (typeof val === 'object') {
      for (const key in val) {
        const found = scanValue(val[key]);
        if (found) return found;
      }
    }
    return null;
  }

  // A. Scan localStorage & sessionStorage for existing token
  let initialHeader = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key);
    initialHeader = scanValue(val);
    if (initialHeader) break;
  }

  if (!initialHeader) {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const val = sessionStorage.getItem(key);
      initialHeader = scanValue(val);
      if (initialHeader) break;
    }
  }

  const currentDomain = window.location.hostname.endsWith('.co') ? 'https://app.prolific.co' : 'https://app.prolific.com';

  if (initialHeader) {
    window.postMessage({ type: 'PROLIFIC_AUTH_HEADER', authHeader: initialHeader, apiBase: currentDomain }, '*');
  }

  // Hook Storage.prototype.setItem to capture storage updates in real-time
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    const result = originalSetItem.apply(this, arguments);
    try {
      const found = scanValue(value);
      if (found) {
        window.postMessage({ type: 'PROLIFIC_AUTH_HEADER', authHeader: found, apiBase: currentDomain }, '*');
      }
    } catch (e) {
      console.error("[Prolific Notifier] Error scanning setItem value:", e);
    }
    return result;
  };

  // Listen for storage events from other tabs/frames to sync token updates
  window.addEventListener('storage', (event) => {
    try {
      if (event.newValue) {
        const found = scanValue(event.newValue);
        if (found) {
          window.postMessage({ type: 'PROLIFIC_AUTH_HEADER', authHeader: found, apiBase: currentDomain }, '*');
        }
      }
    } catch (e) {
      console.error("[Prolific Notifier] Error scanning storage event value:", e);
    }
  });

  // B. Hook window.fetch to capture Authorization headers in real-time
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    let urlStr = "";
    let headersObj = null;

    if (args[0]) {
      if (typeof args[0] === 'string') {
        urlStr = args[0];
      } else if (typeof args[0] === 'object' && args[0].url) {
        urlStr = args[0].url;
        headersObj = args[0].headers;
      }
    }

    const options = args[1];
    if (options && options.headers) {
      headersObj = options.headers;
    }

    let isProlific = false;
    let apiBase = currentDomain;
    if (urlStr) {
      if (urlStr.includes('api.prolific.com') || urlStr.includes('app.prolific.com')) {
        isProlific = true;
        apiBase = "https://app.prolific.com";
      } else if (urlStr.includes('api.prolific.co') || urlStr.includes('app.prolific.co')) {
        isProlific = true;
        apiBase = "https://app.prolific.co";
      }
    }

    if (isProlific) {
      let authHeader = null;
      if (headersObj) {
        if (typeof headersObj.get === 'function') {
          authHeader = headersObj.get('Authorization') || headersObj.get('authorization');
        } else if (typeof headersObj === 'object') {
          authHeader = headersObj['Authorization'] || headersObj['authorization'];
        }
      }
      if (authHeader) {
        window.postMessage({ type: 'PROLIFIC_AUTH_HEADER', authHeader, apiBase }, '*');
      }
    }
    return originalFetch.apply(this, args);
  };

  // C. Hook XMLHttpRequest to capture Authorization headers in real-time
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
  };

  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (header && typeof header === 'string' && header.toLowerCase() === 'authorization') {
      if (this._url) {
        let isProlific = false;
        let apiBase = currentDomain;
        if (this._url.includes('api.prolific.com') || this._url.includes('app.prolific.com')) {
          isProlific = true;
          apiBase = "https://app.prolific.com";
        } else if (this._url.includes('api.prolific.co') || this._url.includes('app.prolific.co')) {
          isProlific = true;
          apiBase = "https://app.prolific.co";
        }
        if (isProlific) {
          window.postMessage({ type: 'PROLIFIC_AUTH_HEADER', authHeader: value, apiBase }, '*');
        }
      }
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  // D. Emulate Prolific Assistant to hook page React state
  try {
    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.classList.add('pa-enabled');
    } else {
      const appObserver = new MutationObserver((mutations, obs) => {
        const el = document.getElementById('app');
        if (el) {
          el.classList.add('pa-enabled');
          obs.disconnect();
        }
      });
      appObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch (e) {
    console.error("[Prolific Notifier] Failed to set pa-enabled class:", e);
  }

  function mapReactStudyToApiStudy(rs) {
    if (!rs) return null;
    return {
      id: rs.id,
      name: rs.name || rs.title || "Untitled Study",
      reward: rs.study_reward ? rs.study_reward.amount : (rs.reward_amount || 0),
      total_available_places: rs.total_available_places || 0,
      places_taken: rs.places_taken || 0,
      places_left: rs.places_left !== undefined ? rs.places_left : ((rs.total_available_places || 0) - (rs.places_taken || 0)),
      estimated_completion_time: rs.estimated_completion_time || 0,
      average_reward_per_hour: rs.study_estimated_reward_per_hour ? rs.study_estimated_reward_per_hour.amount : 
                               (rs.study_average_reward_per_hour ? rs.study_average_reward_per_hour.amount : 0),
      device_compatibility: rs.device_compatibility || [],
      researcher: rs.researcher || { name: rs.researcher_name || "Unknown", id: rs.researcher_id || "" },
      researcher_name: rs.researcher_name || (rs.researcher && rs.researcher.name) || "Unknown"
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data && event.data.type === "PROLIFIC_REQUEST_STATE") {
      window.postMessage({ type: "__segment_identify_req__" }, "*");
    } else if (event.data && event.data.type === "__segment_identify_res__") {
      const payload = event.data.payload;
      if (payload && payload.studiesList && payload.studies) {
        const apiStudies = [];
        payload.studiesList.forEach(id => {
          const rs = payload.studies[id];
          if (rs) {
            const mapped = mapReactStudyToApiStudy(rs);
            if (mapped) apiStudies.push(mapped);
          }
        });
        window.postMessage({ type: "PROLIFIC_STATE_RESPONSE", studies: apiStudies }, "*");
      }
    }
  });
})();
