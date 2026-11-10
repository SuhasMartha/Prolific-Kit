// Background Engine for Prolific Study Notifier Pro

// Catch and handle any uncaught promise rejections from standard network/fetch drops
self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const isFetchError = reason && (reason.name === 'TypeError' || (reason.message && (reason.message.includes('Failed to fetch') || reason.message.includes('failed to fetch'))));
  if (isFetchError) {
    console.warn("[Background] Unhandled network fetch rejection caught:", reason.message || reason);
    event.preventDefault(); // Prevent Chrome from raising a red flag error badge
  }
});

const DEFAULT_TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE";

const ALARM_NAME = "prolific_check_alarm";

// Network recovery retry state
let retryCount = 0;
const MAX_RETRIES = 3;
let retryTimeoutId = null;

function onCheckSuccess() {
  retryCount = 0;
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  chrome.storage.local.set({ lastSuccessCheckTime: Date.now() });
}

function scheduleNetworkRetry() {
  if (retryCount >= MAX_RETRIES) {
    console.log("[Background] Max network retries reached. Stopping retries.");
    retryCount = 0;
    return;
  }

  retryCount++;
  const delay = retryCount * 5000; // 5s, 10s, 15s
  console.log(`[Background] Scheduling network retry #${retryCount} in ${delay / 1000}s...`);

  if (retryTimeoutId) clearTimeout(retryTimeoutId);
  retryTimeoutId = setTimeout(() => {
    console.log(`[Background] Executing network retry #${retryCount}...`);
    checkStudies();
  }, delay);
}

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(() => {
  injectContentScriptIntoExistingTabs();

  chrome.storage.local.get(null, (settings) => {
    const defaults = {
      enabled: true,
      interval: 10, // in seconds (default set to 10 as requested)
      soundEnabled: true,
      soundType: "chime",
      soundVolume: 100,
      openOnStartup: false,
      focusOnNewStudy: true,
      telegramEnabled: false,
      telegramChatId: "",
      ntfyEnabled: false,
      ntfyTopic: "",
      pushoverEnabled: false,
      pushoverUserKey: "",
      pushoverAppToken: "",
      discordEnabled: false,
      discordWebhookUrl: "",
      studiesHistory: [],
      activeStudies: [],
      minReward: 0.00,
      minHourlyRate: 0.00,
      minPlaces: 1,
      cooldownDuration: 1,
      keywordFilterEnabled: false,
      keywords: "",
      lastActiveIds: [],
      lastSeenCache: {},
      lastCheckTime: 0,
      checkerStatus: "Stopped",
      userBalance: "0.00",
      userPendingBalance: "0.00",
      userEmail: "",
      themeMode: "light",
      missedStudiesHistory: [],
      joinedStudyIds: [],
      studyRadarStats: {},
      radarExpanded: false,
      overlayCollapsed: false,
      overlayPosition: null,
      overlayEnabled: false,
      persistentNotificationsEnabled: false,
      persistentNotificationInterval: 15,
      persistentNotificationMaxCount: 5,
      unacknowledgedStudies: [],
      openInNewWindow: true
    };

    const newSettings = {};
    for (const key in defaults) {
      if (settings[key] === undefined) {
        newSettings[key] = defaults[key];
      }
    }

    if (Object.keys(newSettings).length > 0) {
      chrome.storage.local.set(newSettings, () => {
        console.log("Default settings initialized with content scripts.");
        if (newSettings.enabled !== false && (settings.enabled || defaults.enabled)) {
          startAlarm(newSettings.interval || settings.interval || defaults.interval);
        }
      });
    } else {
      if (settings.enabled) {
        startAlarm(settings.interval);
      }
    }
  });
});

// Watch for changes in settings
chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeStudies || changes.checkerStatus || changes.lastError) {
    updateBrowserBadge();
  }
  if (changes.enabled) {
    if (changes.enabled.newValue) {
      chrome.storage.local.get("interval", (data) => {
        startAlarm(data.interval || 60);
      });
    } else {
      stopAlarm();
    }
  } else if (changes.interval && changes.interval.newValue) {
    chrome.storage.local.get("enabled", (data) => {
      if (data.enabled) {
        startAlarm(changes.interval.newValue);
      }
    });
  }
});

// Setup alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkStudies();
  }
});

// Setup periodic timer to check unacknowledged study reminders every 5 seconds
setInterval(checkReminders, 5000);

function startAlarm(intervalSeconds) {
  stopAlarm();
  const minutes = Math.max(1, intervalSeconds / 60);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
  chrome.storage.local.set({ checkerStatus: "Running" });
  console.log(`Alarm started with interval: ${minutes} minutes.`);
  // Run initial check immediately
  checkStudies();
}

function stopAlarm() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.storage.local.set({ checkerStatus: "Stopped" });
  console.log("Alarm stopped.");
}

// Keep track of studies actively notified to avoid duplicates
let notifiedStudiesCache = new Set();

// Perform checks (studies + account balance)
async function checkStudies() {
  chrome.storage.local.set({ lastCheckTime: Date.now(), checkerStatus: "Checking..." });
  pollTelegramCallbacks();

  // Try tab-assisted checking first
  // Service workers get third-party cookies blocked for background fetches.
  // Querying open Prolific tabs and asking content.js to check via the page's first-party context
  // is 100% reliable and preserves session details.
  chrome.tabs.query({ url: ["*://app.prolific.com/*", "*://app.prolific.co/*"] }, async (tabs) => {
    if (tabs && tabs.length > 0) {
      let messageSent = false;
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: "trigger_check" });
          messageSent = true;
          console.log(`[Background] Dispatched trigger_check to Prolific tab: ${tab.id}`);
          break; // successfully triggered, exit loop
        } catch (err) {
          console.log(`[Background] Failed to send trigger_check to tab: ${tab.id}`, err.message);
        }
      }
      if (messageSent) {
        return; // Complete check via content script
      }

      // If we are here, we found open Prolific tabs, but none of them responded.
      // Reload the first tab to reconnect and wake up the content script context.
      console.log("[Background] Prolific tabs found but none responded. Reloading tab to reconnect...");
      const now = Date.now();
      chrome.storage.local.get("lastTabReloadTime", (data) => {
        const lastReload = data.lastTabReloadTime || 0;
        if (now - lastReload > 300000) { // 5 mins cooldown
          chrome.storage.local.set({
            lastTabReloadTime: now,
            checkerStatus: "Reconnecting...",
            lastError: "Reconnecting to Prolific tab. Waking up context..."
          }, () => {
            chrome.tabs.reload(tabs[0].id);
          });
        } else {
          chrome.storage.local.set({
            checkerStatus: "Waiting for Prolific tab...",
            lastError: "Prolific tab detected but not responding. Please refresh or keep it active."
          });
        }
      });
      runBackgroundFetchFallback();
      return;
    }

    // Fallback if no tabs are open or communicating
    console.log("[Background] No open Prolific tabs found, attempting background fetch fallback...");
    runBackgroundFetchFallback();
  });
}

// Fallback direct check (uses stored authHeader to bypass cookie constraints)
async function runBackgroundFetchFallback() {
  chrome.storage.local.get(["authHeader", "apiBase"], async (store) => {
    const authHeader = store.authHeader;
    const apiBase = store.apiBase || "https://api.prolific.com";
    const resolvedApiBase = apiBase.replace("://app.", "://api.");

    try {
      // 1. Fetch balance fallback
      try {
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
        if (balanceResponse.ok) {
          const balanceData = await balanceResponse.json();
          saveBalanceData(balanceData);
        }
      } catch (e) {
        console.log("[Background] Fallback balance check failed:", e);
      }

      // 2. Fetch studies fallback
      let response;
      if (authHeader) {
        response = await fetch(`${resolvedApiBase}/api/v1/participant/studies/?is_assistant=1`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": authHeader,
            "x-legacy-auth": "false",
            "x-client-version": "prolific-assistant/5.36.0"
          }
        });
      }
      if (!response || response.status === 401 || response.status === 403) {
        console.log("[Background] Stored token empty or unauthorized. Retrying fetch with session cookies...");
        response = await fetch(`${resolvedApiBase}/api/v1/participant/studies/?is_assistant=1`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "x-legacy-auth": "false",
            "x-client-version": "prolific-assistant/5.36.0"
          },
          credentials: "include"
        });
      }

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        chrome.storage.local.set({
          checkerStatus: "Unauthorized (Please log in)",
          lastError: "Your session is expired or invalid. Please open Prolific and log in."
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Verify response is JSON (prevent parsing HTML redirect page)
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        chrome.storage.local.set({
          checkerStatus: "Unauthorized (Please log in)",
          lastError: "Your session is invalid. Please refresh Prolific and log in."
        });
        return;
      }

      const data = await response.json();
      const studies = data.results || [];

      chrome.storage.local.set({
        checkerStatus: "Running",
        lastError: null
      });
      onCheckSuccess();

      if (studies.length > 0) {
        processStudies(studies);
      }
    } catch (error) {
      const isFetchError = error && (error.name === 'TypeError' || (error.message && (error.message.includes('Failed to fetch') || error.message.includes('failed to fetch'))));
      if (isFetchError) {
        console.warn("[Background] Network check failed in direct fallback check:", error.message || error);
      } else {
        console.error("[Background] Error in direct fallback check:", error);
      }
      const isOffline = !navigator.onLine || (error.message && error.message.includes("Failed to fetch"));
      if (isOffline) {
        chrome.storage.local.set({
          checkerStatus: "Offline (Reconnecting...)",
          lastError: "Network connection lost. Waiting for connection..."
        });
        scheduleNetworkRetry();
      } else {
        chrome.storage.local.set({
          checkerStatus: "Waiting for Prolific tab...",
          lastError: "Failed background check. Please keep a Prolific tab open and refresh it to connect."
        });
      }
    }
  });
}

// Fetch participant profile balance/earnings (unused directly now, but kept for logic reference)
async function checkBalance() {
  try {
    chrome.storage.local.get(["apiBase"], async (store) => {
      const apiBase = store.apiBase || "https://api.prolific.com";
      const resolvedApiBase = apiBase.replace("://app.", "://api.");
      try {
        const response = await fetch(`${resolvedApiBase}/api/v1/users/me/`, {
          method: "GET",
          headers: {
            "Accept": "application/json"
          },
          credentials: "include"
        });

        if (response.ok) {
          const data = await response.json();
          saveBalanceData(data);
        }
      } catch (error) {
        console.error("Error checking balance:", error);
      }
    });
  } catch (error) {
    console.error("Error in checkBalance outer:", error);
  }
}

// // HTML escaper for Telegram parse_mode: "HTML"
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Formats study notification message in user's requested template (Plain Text)
// Returns the currency symbol for a given currency code
function getCurrencySymbol(currencyCode) {
  switch ((currencyCode || "GBP").toUpperCase()) {
    case "USD": return "$";
    case "EUR": return "€";
    case "CAD": return "CA$";
    case "AUD": return "A$";
    case "GBP":
    default:    return "£";
  }
}

function formatStudyMessage(study) {
  const dateObj = study.timestamp ? new Date(study.timestamp) : new Date();
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const nameStr = study.name || "Untitled Study";
  const researcherStr = study.researcherName || "Unknown";

  const sym = getCurrencySymbol(study.currencyCode);
  const rewardStr = `${sym}${study.reward || "0.00"}`;
  const hourlyStr = `${sym}${study.hourlyRate || "0.00"}`;

  const devs = study.devices || study.deviceCompatibility || study.device_compatibility;
  let devicesStr = "";
  if (Array.isArray(devs) && devs.length > 0) {
    devicesStr = devs.map(d => String(d).charAt(0).toUpperCase() + String(d).slice(1).toLowerCase()).join(" ");
  } else if (study.isMobile) {
    devicesStr = "Desktop Mobile Tablet";
  } else {
    devicesStr = "Desktop";
  }

  const estTime = study.estimatedTime || 0;
  const places = study.placesLeft !== undefined ? study.placesLeft : 0;
  const studyType = study.studyType || "Survey";

  return `📡 ${nameStr}
🤖 By ${researcherStr}
💰 ${rewardStr} (${hourlyStr}/hr) • ${places} places • ${estTime} mins • ${studyType}
📱 Devices : ${devicesStr}
⏰ Time : ${formattedTime}`;
}

// Formats study notification message in user's requested template for Telegram
function formatStudyMessageHtml(study) {
  const dateObj = study.timestamp ? new Date(study.timestamp) : new Date();
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const escName = escapeHtml(study.name || "Untitled Study");
  const escResearcher = escapeHtml(study.researcherName || "Unknown");

  const sym = getCurrencySymbol(study.currencyCode);
  const rewardStr = `${sym}${study.reward || "0.00"}`;
  const hourlyStr = `${sym}${study.hourlyRate || "0.00"}`;

  const devs = study.devices || study.deviceCompatibility || study.device_compatibility;
  let devicesStr = "";
  if (Array.isArray(devs) && devs.length > 0) {
    devicesStr = devs.map(d => String(d).charAt(0).toUpperCase() + String(d).slice(1).toLowerCase()).join(" ");
  } else if (study.isMobile) {
    devicesStr = "Desktop Mobile Tablet";
  } else {
    devicesStr = "Desktop";
  }

  const estTime = study.estimatedTime || 0;
  const places = study.placesLeft !== undefined ? study.placesLeft : 0;
  const studyType = study.studyType || "Survey";

  return `<b>📡 ${escName}</b>
<b>🤖 By ${escResearcher}</b>
<i>💰 ${rewardStr} (${hourlyStr}/hr) • ${places} places • ${estTime} mins • ${studyType}</i>
<b>📱 Devices :</b><i> ${devicesStr}</i>
<b>⏰Time :</b><i> ${formattedTime}</i>`;
}

// Process studies list
async function processStudies(studies) {
  chrome.storage.local.get([
    "studiesHistory",
    "soundEnabled",
    "soundType",
    "minReward",
    "minHourlyRate",
    "minPlaces",
    "cooldownDuration",
    "keywordFilterEnabled",
    "keywords",
    "lastSeenCache",
    "lastActiveIds",
    "studyRadarStats",
    "joinedStudyIds",
    "missedStudiesHistory",
    "activeStudies",
    "favoriteResearchers",
    "blockedResearchers",
    "persistentNotificationsEnabled",
    "unacknowledgedStudies"
  ], async (data) => {
    let history = data.studiesHistory || [];
    const studyRadarStats = data.studyRadarStats || {};
    const activeStudies = data.activeStudies || [];
    const joinedStudyIds = data.joinedStudyIds || [];
    const missedStudiesHistory = data.missedStudiesHistory || [];
    const favoriteResearchersStr = data.favoriteResearchers || "";
    const blockedResearchersStr = data.blockedResearchers || "";
    const persistentEnabled = data.persistentNotificationsEnabled === true;
    let unacknowledged = data.unacknowledgedStudies || [];

    const favorites = favoriteResearchersStr.split(",").map(f => f.trim().toLowerCase()).filter(f => f.length > 0);
    const blocked = blockedResearchersStr.split(",").map(b => b.trim().toLowerCase()).filter(b => b.length > 0);
    const soundEnabled = data.soundEnabled !== false;
    const soundType = data.soundType || "chime";
    const minReward = parseFloat(data.minReward) || 0.00;
    const minHourlyRate = parseFloat(data.minHourlyRate) || 0.00;
    const minPlaces = parseInt(data.minPlaces) || 1;
    const cooldownDuration = parseInt(data.cooldownDuration) || 60; // in minutes
    const keywordFilterEnabled = data.keywordFilterEnabled === true;
    const keywordsStr = data.keywords || "";
    const lastSeenCache = data.lastSeenCache || {};
    const lastActiveIds = data.lastActiveIds || [];

    const activeList = [];
    const keywords = keywordsStr.split(",").map(k => k.trim().toLowerCase()).filter(k => k.length > 0);

    const incomingMap = {};
    for (const s of (studies || [])) {
      incomingMap[s.id] = s;
    }

    const nextUnacknowledged = [];

    // 1. Process previous unacknowledged studies
    for (const unackStudy of unacknowledged) {
      const incomingStudy = incomingMap[unackStudy.id];
      const isJoined = joinedStudyIds.includes(unackStudy.id);

      let placesLeft = 0;
      if (incomingStudy) {
        const totalPlaces = incomingStudy.total_available_places || 0;
        const takenPlaces = incomingStudy.places_taken || 0;
        placesLeft = incomingStudy.places_left !== undefined ? incomingStudy.places_left : (totalPlaces - takenPlaces);
      }

      const isTestStudy = unackStudy.id && unackStudy.id.startsWith("test_");
      if (((incomingStudy && placesLeft > 0) || isTestStudy) && !isJoined) {
        nextUnacknowledged.push(unackStudy);
      } else {
        console.log(`[Background] Clearing unacknowledged study ${unackStudy.id}`);
      }
    }

    let newStudiesFound = false;
    let firstNewStudy = null;
    const newLastActiveIds = [];

    // 2. Process incoming studies
    for (const study of (studies || [])) {
      const studyId = study.id;
      newLastActiveIds.push(studyId);

      const rewardAmount = study.reward ? (study.reward / 100).toFixed(2) : "0.00";
      const totalPlaces = study.total_available_places || 0;
      const takenPlaces = study.places_taken || 0;
      const placesLeft = study.places_left !== undefined ? study.places_left : (totalPlaces - takenPlaces);
      const estTime = study.estimated_completion_time || 0;
      const studyName = study.name || "Untitled Study";
      const hourlyRate = study.average_reward_per_hour ? (study.average_reward_per_hour / 100).toFixed(2) : "0.00";
      const currencyCode = study.currency_code || study.reward_currency_code || "GBP";

      const rewardNum = parseFloat(rewardAmount) || 0;
      const hourlyRateNum = parseFloat(hourlyRate) || 0;

      const deviceComp = study.device_compatibility || [];
      const isMobile = deviceComp.includes("mobile");
      const resObj = study.researcher;
      const researcherId = resObj ? (typeof resObj === "object" ? resObj.id : resObj) : null;
      const researcherName = resObj && typeof resObj === "object" ? resObj.name : (study.researcher_name || "Unknown");

      // Apply Researcher Filters
      const lowerResearcherName = (researcherName || "").toLowerCase();
      const lowerResearcherId = (researcherId || "").toLowerCase();

      const isBlocked = blocked.some(b => lowerResearcherName.includes(b) || lowerResearcherId === b);
      if (isBlocked) {
        console.log(`[Background] Muted and hid study from blocked researcher: ${researcherName} (${researcherId})`);
        continue;
      }

      const isFavorite = favorites.some(f => lowerResearcherName.includes(f) || lowerResearcherId === f);

      // Apply Filters
      // 1. Reward
      if (rewardNum < minReward) continue;
      // 2. Hourly rate
      if (hourlyRateNum < minHourlyRate) continue;
      // 3. Places left
      if (placesLeft < minPlaces) continue;

      // Store in active studies list
      const studyItem = {
        id: studyId,
        name: studyName,
        reward: rewardAmount,
        placesLeft: placesLeft,
        estimatedTime: estTime,
        hourlyRate: hourlyRate,
        currencyCode: currencyCode,
        timestamp: Date.now(),
        isMobile: isMobile,
        devices: deviceComp,
        deviceCompatibility: deviceComp,
        researcherId: researcherId,
        researcherName: researcherName,
        isFavorite: isFavorite
      };
      activeList.push(studyItem);

      // 4. Keyword filter for notification/history addition
      if (keywordFilterEnabled && keywords.length > 0) {
        const lowerName = studyName.toLowerCase();
        const matchesKeyword = keywords.some(kw => lowerName.includes(kw));
        if (!matchesKeyword) continue;
      }

      // 5. Cooldown/Re-appear checks
      let shouldNotify = false;

      if (!notifiedStudiesCache.has(studyId) && !history.some(h => h.id === studyId)) {
        // Completely new study
        shouldNotify = true;
      } else if (lastSeenCache[studyId] && !lastActiveIds.includes(studyId)) {
        // Study was seen before, disappeared (not in last active), and now reappeared
        const timeSinceLastSeen = (Date.now() - lastSeenCache[studyId]) / 60000; // in minutes
        if (timeSinceLastSeen >= cooldownDuration) {
          shouldNotify = true;
        } else {
          console.log(`[Background] Study ${studyId} reappeared too quickly (${timeSinceLastSeen.toFixed(1)}m < ${cooldownDuration}m). Skipping notification.`);
        }
      }

      // Update last seen timestamp
      lastSeenCache[studyId] = Date.now();

      if (shouldNotify) {
        newStudiesFound = true;
        if (!firstNewStudy) firstNewStudy = studyItem;
        notifiedStudiesCache.add(studyId);

        // Remove duplicate entry if already present in history
        history = history.filter(h => h.id !== studyId);
        history.unshift(studyItem);
        if (history.length > 55) history.pop();

        // Notify local
        triggerLocalNotification(studyItem);

        // Notify mobile webhooks
        dispatchMobileNotifications(studyItem);

        // Add to unacknowledged list for future re-notification
        if (!nextUnacknowledged.some(u => u.id === studyItem.id)) {
          studyItem.detectedAt = Date.now();
          studyItem.reminderCount = 0;
          nextUnacknowledged.push(studyItem);
        }

        // Open separate new webpage tab for this study while keeping old page intact
        openStudyInNewTab(studyItem);

        // Record study radar stats
        const now = new Date();
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dayName = days[now.getDay()];
        const hour = now.getHours();
        const radarKey = `${dayName}_${hour}`;
        studyRadarStats[radarKey] = (studyRadarStats[radarKey] || 0) + 1;
      }
    }

    // Cleanup old entries from lastSeenCache to prevent growth (e.g. older than 7 days)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const id in lastSeenCache) {
      if (lastSeenCache[id] < cutoff) {
        delete lastSeenCache[id];
      }
    }

    // Detect missed studies
    const missedCandidates = activeStudies.filter(prevStudy =>
      !newLastActiveIds.includes(prevStudy.id) && !joinedStudyIds.includes(prevStudy.id)
    );

    const newMissedHistory = [...missedStudiesHistory];
    missedCandidates.forEach(prevStudy => {
      if (!newMissedHistory.some(m => m.id === prevStudy.id)) {
        newMissedHistory.unshift({
          ...prevStudy,
          missedAt: Date.now()
        });
      }
    });

    if (newMissedHistory.length > 50) {
      newMissedHistory.splice(50);
    }

    // Save to storage
    chrome.storage.local.set({
      activeStudies: activeList,
      studiesHistory: history,
      lastSeenCache: lastSeenCache,
      lastActiveIds: newLastActiveIds,
      studyRadarStats: studyRadarStats,
      missedStudiesHistory: newMissedHistory,
      unacknowledgedStudies: nextUnacknowledged
    }, () => {
      checkReminders();
    });

    if (newStudiesFound) {
      // Keep original Prolific page untouched without reloading
      if (soundEnabled) {
        playSound(soundType, firstNewStudy);
      }
    }
  });
}

// Save profile balance details to chrome.storage
function saveBalanceData(data) {
  const userEmail = data.email || "";

  let userBalance = "0.00";
  if (data.balance !== undefined) {
    if (Number.isInteger(data.balance)) {
      userBalance = (data.balance / 100).toFixed(2);
    } else {
      userBalance = Number(data.balance).toFixed(2);
    }
  }

  let userPendingBalance = "0.00";
  const pendingVal = data.pending_balance !== undefined ? data.pending_balance :
    (data.balance_pending !== undefined ? data.balance_pending : data.pending_earnings);

  if (pendingVal !== undefined) {
    if (Number.isInteger(pendingVal)) {
      userPendingBalance = (pendingVal / 100).toFixed(2);
    } else {
      userPendingBalance = Number(pendingVal).toFixed(2);
    }
  }

  chrome.storage.local.set({
    userEmail,
    userBalance,
    userPendingBalance
  });
}

// Trigger desktop browser system notifications
function triggerLocalNotification(study, titlePrefix = "") {
  const compatibilityStr = study.isMobile ? "📱 Mobile Supported" : "💻 Desktop Only";
  const sym = getCurrencySymbol(study.currencyCode);
  const title = titlePrefix
    ? `${titlePrefix} | 🔬 New Study Available! (${sym}${study.reward})`
    : `🔬 New Study Available! (${sym}${study.reward})`;

  // Clear previous notification if it exists to ensure the new one flashes / plays sound
  chrome.notifications.clear(study.id, () => {
    chrome.notifications.create(study.id, {
      type: "basic",
      iconUrl: "icon.png",
      title: title,
      message: `${study.name}\nEst: ${study.estimatedTime}m (${sym}${study.hourlyRate}/hr) | Left: ${study.placesLeft}\n${compatibilityStr}\nRes: ${study.researcherName}`,
      priority: 2,
      buttons: [{ title: "Open Prolific" }]
    });
  });
}

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: `https://app.prolific.com/studies/${notificationId}` });
  chrome.notifications.clear(notificationId);
  acknowledgeStudy(notificationId);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: `https://app.prolific.com/studies/${notificationId}` });
  chrome.notifications.clear(notificationId);
  acknowledgeStudy(notificationId);
});

// Sound Player Offscreen initiator (with load-retry protection)
async function playSound(soundType, study = null) {
  try {
    await createOffscreenDocument();

    // Get sound volume from storage
    chrome.storage.local.get("soundVolume", async (data) => {
      const volumeVal = data.soundVolume !== undefined ? parseInt(data.soundVolume, 10) : 100;
      const volume = volumeVal / 100;

      let finalSoundType = soundType;
      if (study && study.isFavorite) {
        finalSoundType = "success"; // Play triumphant arpeggio for favorite researchers
      }

      // Retrying message dispatch in case offscreen script hasn't finished DOM binding
      let success = false;
      for (let i = 0; i < 5; i++) {
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'play_sound', soundType: finalSoundType, volume, study }, (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(res);
              }
            });
          });
          if (response && response.success) {
            success = true;
            break;
          }
        } catch (err) {
          console.log(`[Background] Sound playback attempt ${i + 1} failed, retrying...`, err.message);
        }
        await new Promise(r => setTimeout(r, 80));
      }
    });
  } catch (err) {
    console.error("Audio playback failure:", err);
  }
}

// Open a separate new webpage tab/window for a newly detected study, keeping the old page intact
function openStudyInNewTab(study) {
  if (!study || !study.id) return;
  chrome.storage.local.get(["focusOnNewStudy", "openInNewWindow"], (data) => {
    if (data.focusOnNewStudy !== false) {
      const studyUrl = study.id.startsWith("test_")
        ? "https://app.prolific.com/studies"
        : `https://app.prolific.com/studies/${study.id}`;

      const openInNewWindow = data.openInNewWindow !== false; // default true

      if (openInNewWindow) {
        // Open in a new browser window (popup-style)
        chrome.windows.create({ url: studyUrl, focused: true, type: "normal" }, (newWindow) => {
          if (chrome.runtime.lastError) {
            console.error("[Background] Failed to open new window for study:", chrome.runtime.lastError.message);
          } else if (newWindow) {
            console.log(`[Background] Opened new window ${newWindow.id} for study ${study.id}`);
          }
        });
      } else {
        // Open in a new tab in the current window
        chrome.tabs.create({ url: studyUrl, active: true }, (newTab) => {
          if (chrome.runtime.lastError) {
            console.error("[Background] Failed to open separate study tab:", chrome.runtime.lastError.message);
          } else if (newTab) {
            console.log(`[Background] Opened separate study tab ${newTab.id} for study ${study.id}`);
            if (newTab.windowId) {
              chrome.windows.update(newTab.windowId, { focused: true });
            }
          }
        });
      }
    }
  });
}

// Reload any open Prolific studies tabs to reflect new studies in UI
// Checks focused window state: skips reload if user is actively viewing the Prolific studies tab
function reloadProlificTabs() {
  chrome.windows.getLastFocused({ populate: false }, (lastFocusedWindow) => {
    const focusedWindowId = lastFocusedWindow ? lastFocusedWindow.id : null;
    const isWindowFocused = lastFocusedWindow ? lastFocusedWindow.focused : false;

    chrome.tabs.query({ url: ["*://app.prolific.com/studies*", "*://app.prolific.co/studies*"] }, (tabs) => {
      if (tabs && tabs.length > 0) {
        for (const tab of tabs) {
          if (tab.id) {
            // If this is the active tab in the currently focused window, skip reloading to avoid interrupting the user
            if (tab.active && tab.windowId === focusedWindowId && isWindowFocused) {
              console.log(`[Background] Prolific tab ${tab.id} is active and focused. Skipping reload to prevent interruption.`);
              continue;
            }
            try {
              chrome.tabs.reload(tab.id);
              console.log(`[Background] Reloaded background Prolific studies tab: ${tab.id}`);
            } catch (err) {
              console.error(`[Background] Failed to reload tab ${tab.id}:`, err);
            }
          }
        }
      }
    });
  });
}

// Browser Startup Listener
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("openOnStartup", (data) => {
    if (data.openOnStartup === true) {
      chrome.tabs.create({ url: "https://app.prolific.com/studies" });
    }
  });
});

let creatingOffscreen;
async function createOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // Check if it already exists
  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (contexts.length > 0) {
        return;
      }
    } catch (e) {
      console.log("[Background] error in getContexts:", e);
    }
  }

  // If already creating, wait for it
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Notification chime for studies.'
  });

  try {
    await creatingOffscreen;
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document') && !err.message.includes('Only one offscreen document')) {
      throw err;
    }
  } finally {
    creatingOffscreen = null;
  }
}


// Dispatch to active webhook streams
function dispatchMobileNotifications(study) {
  chrome.storage.local.get([
    "telegramEnabled",
    "telegramChatId",
    "telegramBotToken",
    "ntfyEnabled",
    "ntfyTopic",
    "pushoverEnabled",
    "pushoverUserKey",
    "pushoverAppToken",
    "discordEnabled",
    "discordWebhookUrl"
  ], (settings) => {

    // 1. Telegram Bot
    if (settings.telegramEnabled && settings.telegramChatId) {
      const chatId = settings.telegramChatId.trim();
      const botToken = (settings.telegramBotToken && settings.telegramBotToken.trim()) || DEFAULT_TELEGRAM_BOT_TOKEN;
      const htmlAlert = formatStudyMessageHtml(study);

      const inlineKeyboard = [
        [
          { text: "🔗 Open Prolific", url: study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}` },
          { text: "✅ Acknowledge", callback_data: `ack:${study.id}` }
        ]
      ];

      if (botToken && botToken !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlAlert,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.ok && data.result) {
            const messageId = data.result.message_id;
            chrome.storage.local.get("telegramAlertsCache", (cacheStore) => {
              const cache = cacheStore.telegramAlertsCache || {};
              cache[study.id] = { messageIds: [messageId], chatId };
              chrome.storage.local.set({ telegramAlertsCache: cache });
            });
          }
        })
        .catch(err => console.error("Telegram notification failed:", err));
      }
    }

    // 2. ntfy Notification
    if (settings.ntfyEnabled && settings.ntfyTopic) {
      const topic = settings.ntfyTopic.trim();
      const sym = getCurrencySymbol(study.currencyCode);
      const title = study.isFavorite ? `⭐ FAVORITE: New Prolific Study (${sym}${study.reward})` : `New Prolific Study (${sym}${study.reward})`;
      const body = `🔬 Study: ${study.name}\n💰 Reward: ${sym}${study.reward} (${sym}${study.hourlyRate}/hr)\n⏱️ Time: ${study.estimatedTime} mins\n👥 Places: ${study.placesLeft}`;
      const url = study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}`;

      fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        body: body,
        headers: {
          "Title": title,
          "Priority": study.isFavorite ? "5" : "4",
          "Click": url,
          "Tags": study.isFavorite ? "star,moneybag" : "microscope"
        }
      }).catch(err => console.error("ntfy notification failed:", err));
    }

    // 3. Pushover Notification
    if (settings.pushoverEnabled && settings.pushoverUserKey && settings.pushoverAppToken) {
      const user = settings.pushoverUserKey.trim();
      const token = settings.pushoverAppToken.trim();
      const sym = getCurrencySymbol(study.currencyCode);
      const title = study.isFavorite ? `⭐ FAVORITE: New Prolific Study (${sym}${study.reward})` : `New Prolific Study (${sym}${study.reward})`;
      const message = `🔬 Study: ${study.name}\nReward: ${sym}${study.reward} (${sym}${study.hourlyRate}/hr)\nTime: ${study.estimatedTime} mins\nPlaces: ${study.placesLeft}`;
      const url = study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}`;
      const url_title = "Open Prolific";
      const priority = study.isFavorite ? 1 : 0;

      fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: token,
          user: user,
          message: message,
          title: title,
          url: url,
          url_title: url_title,
          priority: priority
        })
      }).catch(err => console.error("Pushover notification failed:", err));
    }

    // 4. Discord Notification
    if (settings.discordEnabled && settings.discordWebhookUrl) {
      const webhookUrl = settings.discordWebhookUrl.trim();
      const isFavorite = study.isFavorite;
      const compatibilityStr = study.isMobile ? "📱 Mobile Supported" : "💻 Desktop Only";
      const sym = getCurrencySymbol(study.currencyCode);

      const payload = {
        embeds: [{
          title: isFavorite ? "⭐ FAVORITE RESEARCHER: New Study!" : "🔬 New Study Available!",
          color: isFavorite ? 16753920 : 3447003, // Gold or Blurple
          url: study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}`,
          fields: [
            { name: "Reward", value: `${sym}${study.reward} (${sym}${study.hourlyRate}/hr)`, inline: true },
            { name: "Time", value: `${study.estimatedTime} mins`, inline: true },
            { name: "Places Left", value: `${study.placesLeft}`, inline: true },
            { name: "Title", value: study.name },
            { name: "Researcher", value: study.researcherName || "Unknown", inline: true },
            { name: "Compatibility", value: compatibilityStr, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      };

      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(err => console.error("Discord notification failed:", err));
    }
  });
}

// Send mobile reminders with inline buttons and update cached messageIds list
function sendMobileReminders(study, labelText, htmlLabelText) {
  chrome.storage.local.get([
    "telegramEnabled",
    "telegramChatId",
    "telegramBotToken",
    "telegramAlertsCache",
    "ntfyEnabled",
    "ntfyTopic",
    "pushoverEnabled",
    "pushoverUserKey",
    "pushoverAppToken",
    "discordEnabled",
    "discordWebhookUrl"
  ], (store) => {

    // 1. Telegram reminder
    if (store.telegramEnabled && store.telegramChatId) {
      const chatId = store.telegramChatId.trim();
      const botToken = (store.telegramBotToken && store.telegramBotToken.trim()) || DEFAULT_TELEGRAM_BOT_TOKEN;
      const text = `${htmlLabelText}\n\n${formatStudyMessageHtml(study)}`;
      const inlineKeyboard = [
        [
          { text: "🔗 Open Prolific", url: study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}` },
          { text: "✅ Acknowledge", callback_data: `ack:${study.id}` }
        ]
      ];

      if (botToken && botToken !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: inlineKeyboard }
          })
        })
          .then(res => res.json())
          .then(data => {
            if (data && data.ok && data.result) {
              const messageId = data.result.message_id;
              const cache = store.telegramAlertsCache || {};
              if (!cache[study.id]) {
                cache[study.id] = { messageIds: [], chatId };
              }
              if (!cache[study.id].messageIds) {
                cache[study.id].messageIds = [];
              }
              cache[study.id].messageIds.push(messageId);
              chrome.storage.local.set({ telegramAlertsCache: cache });
            }
          })
          .catch(err => console.error("Telegram reminder send failed:", err));
      }
    }

    // 2. ntfy reminder
    if (store.ntfyEnabled && store.ntfyTopic) {
      const topic = store.ntfyTopic.trim();
      fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        body: `🔬 Study: ${study.name}\n💰 Reward: £${study.reward} (£${study.hourlyRate}/hr)\n⏱️ Time: ${study.estimatedTime} mins\n👥 Places: ${study.placesLeft}`,
        headers: {
          "Title": `${labelText}: Prolific Study Available!`,
          "Priority": "5",
          "Click": study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}`,
          "Tags": "warning,alarm"
        }
      }).catch(err => console.error("ntfy reminder send failed:", err));
    }

    // 3. Pushover reminder
    if (store.pushoverEnabled && store.pushoverUserKey && store.pushoverAppToken) {
      const user = store.pushoverUserKey.trim();
      const token = store.pushoverAppToken.trim();
      fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token,
          user: user,
          title: `${labelText}: Prolific Study Available!`,
          message: `🔬 Study: ${study.name}\nReward: £${study.reward} (£${study.hourlyRate}/hr)\nTime: ${study.estimatedTime} mins\nPlaces: ${study.placesLeft}`,
          url: study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}`,
          url_title: "Open Prolific",
          priority: 1
        })
      }).catch(err => console.error("Pushover reminder send failed:", err));
    }

    // 4. Discord reminder
    if (store.discordEnabled && store.discordWebhookUrl) {
      const webhookUrl = store.discordWebhookUrl.trim();
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: `${labelText}: Prolific Study Available!`,
            color: 15158332, // Red
            description: `🔬 **New Study Available**\n**Reward:** £${study.reward} (£${study.hourlyRate}/hr)\n**Title:** *${study.name}*`,
            url: study.id.startsWith("test_") ? "https://app.prolific.com/studies" : `https://app.prolific.com/studies/${study.id}`
          }]
        })
      }).catch(err => console.error("Discord reminder failed:", err));
    }
  });
}

// Check unacknowledged study reminders periodically
function checkReminders() {
  chrome.storage.local.get([
    "persistentNotificationsEnabled",
    "persistentNotificationInterval",
    "persistentNotificationMaxCount",
    "unacknowledgedStudies",
    "joinedStudyIds",
    "activeStudies",
    "soundEnabled",
    "soundType"
  ], (data) => {
    const persistentEnabled = data.persistentNotificationsEnabled === true;
    if (!persistentEnabled) return;

    const intervalSecs = data.persistentNotificationInterval || 15;
    const maxCount = data.persistentNotificationMaxCount !== undefined ? data.persistentNotificationMaxCount : 5;

    let unacknowledged = data.unacknowledgedStudies || [];
    if (unacknowledged.length === 0) return;

    const joinedStudyIds = data.joinedStudyIds || [];
    const activeStudies = data.activeStudies || [];
    const soundEnabled = data.soundEnabled !== false;
    const soundType = data.soundType || "chime";

    let changed = false;
    let reNotifiedAny = false;
    let firstReNotifiedStudy = null;
    const nextUnacknowledged = [];

    for (const unackStudy of unacknowledged) {
      const isJoined = joinedStudyIds.includes(unackStudy.id);
      const isTestStudy = unackStudy.id && unackStudy.id.startsWith("test_");
      const isActive = isTestStudy || activeStudies.some(s => s.id === unackStudy.id);

      if (isActive && !isJoined) {
        nextUnacknowledged.push(unackStudy);

        // Initialize fields if not present
        if (unackStudy.detectedAt === undefined) {
          unackStudy.detectedAt = Date.now();
          changed = true;
        }
        if (unackStudy.reminderCount === undefined) {
          unackStudy.reminderCount = 0;
          changed = true;
        }

        const elapsedSecs = Math.floor((Date.now() - unackStudy.detectedAt) / 1000);
        const nextReminderIndex = unackStudy.reminderCount + 1;

        if (nextReminderIndex <= maxCount && elapsedSecs >= intervalSecs * nextReminderIndex) {
          unackStudy.reminderCount = nextReminderIndex;
          const isFinal = (nextReminderIndex === maxCount);
          const label = isFinal ? "🚨 FINAL REMINDER" : `🚨 REMINDER #${nextReminderIndex}`;
          const htmlLabel = isFinal ? "🚨 <b>FINAL REMINDER</b>" : `🚨 <b>REMINDER #${nextReminderIndex}</b>`;

          console.log(`[Background] Interval reached. Sending reminder #${nextReminderIndex} (${isFinal ? 'FINAL' : 'regular'}) for study: ${unackStudy.id}`);
          sendMobileReminders(unackStudy, label, htmlLabel);
          triggerLocalNotification(unackStudy, label);
          reNotifiedAny = true;
          changed = true;
          if (!firstReNotifiedStudy) firstReNotifiedStudy = unackStudy;
        }
      } else {
        console.log(`[Background] Clearing unacknowledged study ${unackStudy.id} from queue`);
        changed = true;
      }
    }

    if (changed) {
      chrome.storage.local.set({ unacknowledgedStudies: nextUnacknowledged });
    }

    if (reNotifiedAny && soundEnabled) {
      playSound(soundType, firstReNotifiedStudy);
    }
  });
}

// Pull Callback Queries via getUpdates to handle Acknowledge button clicks
function pollTelegramCallbacks() {
  chrome.storage.local.get(["telegramEnabled", "telegramChatId", "telegramBotToken", "telegramUpdateOffset"], (store) => {
    if (!store.telegramEnabled || !store.telegramChatId) return;

    const botToken = (store.telegramBotToken && store.telegramBotToken.trim()) || DEFAULT_TELEGRAM_BOT_TOKEN;
    if (!botToken || botToken === "YOUR_TELEGRAM_BOT_TOKEN_HERE") return;

    const offset = store.telegramUpdateOffset || 0;
    fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=0`)
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.result && data.result.length > 0) {
          let nextOffset = offset;
          for (const update of data.result) {
            if (update.update_id >= nextOffset) {
              nextOffset = update.update_id + 1;
            }

            if (update.callback_query) {
              const callbackQuery = update.callback_query;
              const callbackData = callbackQuery.data || "";

              if (callbackData.startsWith("ack:")) {
                const studyId = callbackData.substring(4);
                console.log(`[Background] Telegram callback acknowledge received for study: ${studyId}`);

                acknowledgeStudy(studyId);

                // Answer callback query
                fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    callback_query_id: callbackQuery.id,
                    text: "Study acknowledged!"
                  })
                }).catch(e => console.error("Error answering callback query:", e));
              }
            }
          }

          if (nextOffset > offset) {
            chrome.storage.local.set({ telegramUpdateOffset: nextOffset });
          }
        }
      })
      .catch(err => {
        const isFetchError = err && (err.name === 'TypeError' || (err.message && (err.message.includes('Failed to fetch') || err.message.includes('failed to fetch'))));
        if (isFetchError) {
          console.warn("Telegram callbacks poll offline / network check failed:", err.message || err);
        } else {
          console.error("Error polling Telegram callbacks in background:", err);
        }
      });
  });
}

// IPC Messages handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'check_now') {
    checkStudies().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'save_auth_header') {
    chrome.storage.local.set({
      authHeader: message.authHeader,
      apiBase: message.apiBase || "https://api.prolific.com",
      checkerStatus: "Running",
      lastError: null
    });
    onCheckSuccess();
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'study_joined') {
    acknowledgeStudy(message.studyId);
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'play_sound') {
    playSound(message.soundType, message.study);
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'studies_fetched') {
    chrome.storage.local.set({
      checkerStatus: "Running",
      lastError: null
    });
    onCheckSuccess();
    processStudies(message.studies);
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'balance_fetched') {
    chrome.storage.local.set({
      checkerStatus: "Running",
      lastError: null
    });
    onCheckSuccess();
    saveBalanceData(message.userData);
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'update_status') {
    chrome.storage.local.set({
      checkerStatus: message.status,
      lastError: message.error
    });
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'content_fetch_failed') {
    console.log("[Background] Content script fetch failed. Falling back to background fetch...");
    runBackgroundFetchFallback();
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'prolific_opened') {
    chrome.storage.local.get("unacknowledgedStudies", (store) => {
      const unack = store.unacknowledgedStudies || [];
      if (unack.length > 0) {
        console.log(`[Background] Prolific tab opened/focused. Auto-acknowledging ${unack.length} studies.`);
        unack.forEach(study => {
          acknowledgeStudy(study.id);
        });
      }
    });
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'send_test_notification') {
    const dummyStudy = {
      id: "test_" + Date.now(),
      name: "Test Alert",
      reward: "3.83",
      placesLeft: 100,
      estimatedTime: 19,
      hourlyRate: "12.10",
      timestamp: Date.now(),
      isMobile: true,
      devices: ["desktop", "mobile", "tablet"],
      deviceCompatibility: ["desktop", "mobile", "tablet"],
      researcherId: "60d9aadeb86739de712faee0",
      researcherName: "Prolific Notifier",
      detectedAt: Date.now(),
      reminderCount: 0
    };

    triggerLocalNotification(dummyStudy);
    dispatchMobileNotifications(dummyStudy);

    chrome.storage.local.get(["soundType", "unacknowledgedStudies"], (data) => {
      playSound(data.soundType || 'chime');
      const unack = data.unacknowledgedStudies || [];
      unack.push(dummyStudy);
      chrome.storage.local.set({ unacknowledgedStudies: unack }, () => {
        checkReminders();
      });
    });

    sendResponse({ success: true });
    return true;
  }
});

// Acknowledge a study (Joined or Notification Clicked) to clear remote device notifications
function acknowledgeStudy(studyId) {
  // Clear local desktop notification if still showing
  chrome.notifications.clear(studyId);

  chrome.storage.local.get(["joinedStudyIds", "telegramAlertsCache", "unacknowledgedStudies", "telegramBotToken"], (store) => {
    const joined = store.joinedStudyIds || [];
    if (!joined.includes(studyId)) {
      joined.push(studyId);
    }

    let unack = store.unacknowledgedStudies || [];
    unack = unack.filter(s => s.id !== studyId);

    const cache = store.telegramAlertsCache || {};
    const alertInfo = cache[studyId];
    if (alertInfo) {
      const { messageIds, chatId } = alertInfo;
      const botToken = (store.telegramBotToken && store.telegramBotToken.trim()) || DEFAULT_TELEGRAM_BOT_TOKEN;
      // Only delete reminder messages (indices 1 onwards), keep the main alert message (index 0)
      const idsToDelete = (messageIds || []).slice(1);

      if (idsToDelete.length > 0 && botToken && botToken !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
        console.log(`[Background] Deleting ${idsToDelete.length} Telegram reminder messages for study ${studyId}`);
        Promise.all(idsToDelete.map(msgId => {
          return fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: msgId
            })
          }).catch(err => console.error(`Failed to delete Telegram message ${msgId}:`, err));
        })).then(() => {
          delete cache[studyId];
          chrome.storage.local.set({
            joinedStudyIds: joined,
            telegramAlertsCache: cache,
            unacknowledgedStudies: unack
          });
        });
      } else {
        delete cache[studyId];
        chrome.storage.local.set({
          joinedStudyIds: joined,
          telegramAlertsCache: cache,
          unacknowledgedStudies: unack
        });
      }
    } else {
      chrome.storage.local.set({
        joinedStudyIds: joined,
        unacknowledgedStudies: unack
      });
    }
  });
}

// Update Browser Extension Badge based on active studies count and status errors
function updateBrowserBadge() {
  chrome.storage.local.get(["activeStudies", "lastError", "checkerStatus", "lastSuccessCheckTime"], (data) => {
    const activeCount = (data.activeStudies || []).length;
    const status = data.checkerStatus || "";
    const lastError = data.lastError || "";
    const lastSuccess = data.lastSuccessCheckTime || 0;

    const isGracePeriodActive = (Date.now() - lastSuccess <= 600000);
    const hasError = lastError || status.includes("Unauthorized") || status.includes("Waiting");

    if (hasError && !isGracePeriodActive) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }); // Red for error
      chrome.action.setTitle({ title: `Error: ${lastError || status}` });
    } else if (activeCount > 0) {
      chrome.action.setBadgeText({ text: String(activeCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }); // Red for active studies
      chrome.action.setTitle({ title: `${activeCount} active studies available!` });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Prolific Study Notifier Pro" });
    }
  });
}

// Initialize badge state on runtime events
chrome.runtime.onInstalled.addListener(() => {
  updateBrowserBadge();
});
chrome.runtime.onStartup.addListener(() => {
  updateBrowserBadge();
});

// Dynamically inject content script into existing Prolific tabs upon install/update
async function injectContentScriptIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["*://app.prolific.com/*", "*://app.prolific.co/*"]
    });
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          });
          console.log(`[Background] Dynamically injected content.js into tab ${tab.id}`);
        } catch (err) {
          console.log(`[Background] Failed to inject content.js into tab ${tab.id}:`, err.message);
        }
      }
    }
  } catch (e) {
    console.error("[Background] Error querying tabs for dynamic injection:", e);
  }
}
