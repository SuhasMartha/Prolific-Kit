// UI Controller for Prolific Study Notifier Pro

// Catch and handle any uncaught promise rejections from standard network/fetch drops in popup
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const isFetchError = reason && (reason.name === 'TypeError' || (reason.message && (reason.message.includes('Failed to fetch') || reason.message.includes('failed to fetch'))));
  if (isFetchError) {
    console.warn("[Popup] Unhandled network fetch rejection caught:", reason.message || reason);
    event.preventDefault();
  }
});

const DEFAULT_TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE";

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Prolific Notifier] Popup DOMContentLoaded. Initializing...");

  // Safe selectors with fallback warnings
  const getEl = (id) => {
    const el = document.getElementById(id);
    if (!el) console.warn(`[Prolific Notifier] Warning: Element #${id} not found in HTML.`);
    return el;
  };

  // DOM Elements - Navigation & Global
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const checkerToggle = getEl("checker-toggle");
  const errorBanner = getEl("error-banner");
  const errorMsgText = getEl("error-msg-text");
  const btnCloseError = getEl("btn-close-error");

  // DOM Elements - Header status
  const lblLastChecked = getEl("lbl-last-checked");
  const btnCheckNow = getEl("btn-check-now");

  // DOM Elements - Studies Panel (Active)
  const lblBalance = getEl("lbl-balance");
  const lblPending = getEl("lbl-pending");
  const activeStudiesList = getEl("active-studies-list");
  const emptyActivePlaceholder = getEl("empty-active-placeholder");

  // DOM Elements - History Panel (Log)
  const btnClearHistory = getEl("btn-clear-history");
  const btnExportHistory = getEl("btn-export-history");
  const studiesList = getEl("studies-list");
  const emptyFeedPlaceholder = getEl("empty-feed-placeholder");
  const radarToggleHeader = getEl("radar-toggle-header");
  const radarBodyContent = getEl("radar-body-content");
  const radarToggleIcon = getEl("radar-toggle-icon");
  const filterHistoryAll = getEl("filter-history-all");
  const filterHistoryMissed = getEl("filter-history-missed");

  // DOM Elements - Settings Panel Status
  const statusDot = getEl("status-dot");
  const statusText = getEl("status-text");

  const themeToggle = getEl("theme-toggle");
  const overlayToggle = getEl("overlay-toggle");
  const persistentNotificationsToggle = getEl("persistent-notifications-toggle");
  const persistentIntervalSelect = getEl("persistent-interval-select");
  const persistentMaxAlertsSelect = getEl("persistent-max-alerts-select");
  const persistentIntervalContainer = getEl("persistent-interval-container");

  // DOM Elements - Settings (Sound/Beep)
  const soundToggle = getEl("sound-toggle");
  const soundSelect = getEl("sound-select");
  const btnTestSound = getEl("btn-test-sound");
  const soundVolumeRange = getEl("sound-volume-range");
  const lblSoundVolume = getEl("lbl-sound-volume");

  // DOM Elements - Settings (Sliders & Filters)
  const minRewardRange = getEl("min-reward-range");
  const lblMinReward = getEl("lbl-min-reward");
  const minHourlyRange = getEl("min-hourly-range");
  const lblMinHourly = getEl("lbl-min-hourly");
  const minPlacesRange = getEl("min-places-range");
  const lblMinPlaces = getEl("lbl-min-places");
  const cooldownSelect = getEl("cooldown-select");
  const keywordToggle = getEl("keyword-toggle");
  const keywordTextarea = getEl("keyword-textarea");
  const groupKeywordTextarea = getEl("group-keyword-textarea");
  const txtFavoriteResearchers = getEl("txt-favorite-researchers");
  const txtBlockedResearchers = getEl("txt-blocked-researchers");
  const lblAiSummary = getEl("lbl-ai-summary");

  // DOM Elements - Settings (Automation)
  const startupToggle = getEl("startup-toggle");
  const focusToggle = getEl("focus-toggle");
  const openInNewWindowToggle = getEl("open-in-new-window-toggle");

  // DOM Elements - Settings (Account link actions)
  const btnSignOut = getEl("btn-sign-out");

  // DOM Elements - Telegram Webhook Card
  const telegramToggle = getEl("telegram-toggle");
  const txtTelegramToken = getEl("txt-telegram-token");
  const telegramQrContainer = getEl("telegram-qr-container");
  const telegramQrImg = getEl("telegram-qr-img");
  const telegramBotLink = getEl("telegram-bot-link");
  const telegramQrStatus = getEl("telegram-qr-status");
  const telegramQrDot = getEl("telegram-qr-dot");
  const telegramQrStatusText = getEl("telegram-qr-status-text");

  // DOM Elements - Discord Card
  const discordToggle = getEl("discord-toggle");
  const discordBody = getEl("discord-body");
  const txtDiscordWebhook = getEl("txt-discord-webhook");

  // DOM Elements - ntfy Card
  const ntfyToggle = getEl("ntfy-toggle");
  const ntfyBody = getEl("ntfy-body");
  const txtNtfyTopic = getEl("txt-ntfy-topic");

  // DOM Elements - Pushover Card
  const pushoverToggle = getEl("pushover-toggle");
  const pushoverBody = getEl("pushover-body");
  const txtPushoverUser = getEl("txt-pushover-user");
  const txtPushoverToken = getEl("txt-pushover-token");

  // DOM Elements - Polling frequency
  const pollingRange = getEl("polling-range");
  const lblPollingInterval = getEl("lbl-polling-interval");
  const btnSendTest = getEl("btn-send-test");

  // Safe UI Interaction Helpers
  const safeSetChecked = (el, val) => { if (el) el.checked = !!val; };
  const safeSetValue = (el, val) => { if (el) el.value = (val !== undefined && val !== null) ? val : ""; };
  const safeSetText = (el, val) => { if (el) el.textContent = (val !== undefined && val !== null) ? val : ""; };
  const safeAddListener = (el, event, handler) => { if (el) el.addEventListener(event, handler); };

  // Dynamic slider track highlight coloring
  function updateSliderBackground(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const percentage = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percentage}%, var(--border-light) ${percentage}%, var(--border-light) 100%)`;
  }

  // Format currencies in GBP and USD (approx exchange rate 1 GBP = 1.30 USD)
  const formatGbpUsd = (val) => {
    const gbp = parseFloat(val) || 0;
    const usd = gbp * 1.30;
    return `£${gbp.toFixed(2)} ($${usd.toFixed(2)})`;
  };

  const formatGbpUsdHourly = (val) => {
    const gbp = parseFloat(val) || 0;
    const usd = gbp * 1.30;
    return `£${gbp.toFixed(2)}/hr ($${usd.toFixed(2)}/hr)`;
  };



  // Telegram QR / Autoconnect Controller
  let telegramPollInterval = null;

  function stopTelegramPolling() {
    if (telegramPollInterval) {
      clearInterval(telegramPollInterval);
      telegramPollInterval = null;
    }
  }

  function showTelegramConnectedStatus(text) {
    if (telegramQrStatus) {
      telegramQrStatus.className = "qr-status-indicator success";
      if (telegramQrDot) telegramQrDot.className = "qr-status-dot";
      if (telegramQrStatusText) telegramQrStatusText.textContent = text;
    }
  }

  async function checkTelegramConnection() {
    stopTelegramPolling();

    if (!telegramToggle || !telegramToggle.checked) {
      if (telegramQrContainer) telegramQrContainer.style.display = "none";
      return;
    }

    if (telegramQrContainer) telegramQrContainer.style.display = "block";

    // Set status to checking initially
    if (telegramQrStatus) {
      telegramQrStatus.className = "qr-status-indicator";
      if (telegramQrDot) {
        telegramQrDot.className = "qr-status-dot pulse-dot active checking";
      }
      if (telegramQrStatusText) telegramQrStatusText.textContent = "Verifying bot connection...";
    }

    let botUser = "Prolific_Notifier_Bot";
    let botName = "Prolific Notifier Bot";
    let isValid = false;

    // Get or create session ID and retrieve any custom token
    chrome.storage.local.get(["telegramChatId", "telegramSessionId", "telegramBotToken"], async (store) => {
      const activeToken = (store.telegramBotToken && store.telegramBotToken.trim()) || DEFAULT_TELEGRAM_BOT_TOKEN;

      if (activeToken && activeToken !== "YOUR_TELEGRAM_BOT_TOKEN_HERE" && activeToken !== "7294810293:AAH-dummy-token-here") {
        try {
          const getMeUrl = `https://api.telegram.org/bot${activeToken}/getMe`;
          const response = await fetch(getMeUrl);
          if (response.ok) {
            const data = await response.json();
            if (data.ok && data.result) {
              botUser = data.result.username;
              botName = data.result.first_name || botUser;
              isValid = true;
            }
          }
        } catch (err) {
          console.log("Telegram verification failed, using fallback:", err);
        }
      }

      let sessId = store.telegramSessionId;
      if (!sessId) {
        sessId = String(Math.floor(100000 + Math.random() * 900000));
        chrome.storage.local.set({ telegramSessionId: sessId });
      }

      const botLink = `https://t.me/${botUser}?start=${sessId}`;

      // Set link and QR Code image
      if (telegramBotLink) {
        telegramBotLink.href = botLink;
        telegramBotLink.textContent = `@${botUser}`;
      }
      if (telegramQrImg) {
        telegramQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(botLink)}`;
      }

      // Check if Chat ID is already set
      if (store.telegramChatId) {
        showTelegramConnectedStatus(`Connected to bot: ${botName}`);
        return;
      }

      if (isValid) {
        // No Chat ID, let's poll for updates using the real bot token
        if (telegramQrStatus) {
          telegramQrStatus.className = "qr-status-indicator";
          if (telegramQrDot) {
            telegramQrDot.className = "qr-status-dot pulse-dot active checking";
          }
          if (telegramQrStatusText) telegramQrStatusText.textContent = `Scan QR & click Start (ID: ${sessId})...`;
        }

        // First fetch updates to find latest update_id to use as offset
        let offset = 0;
        try {
          const updatesRes = await fetch(`https://api.telegram.org/bot${activeToken}/getUpdates?limit=1&offset=-1`);
          if (updatesRes.ok) {
            const updatesData = await updatesRes.json();
            if (updatesData.ok && updatesData.result && updatesData.result.length > 0) {
              offset = updatesData.result[0].update_id + 1;
            }
          }
        } catch (e) {
          console.log("Error getting initial updates offset:", e);
        }

        // Start Polling every 2.5 seconds
        telegramPollInterval = setInterval(async () => {
          try {
            const updatesUrl = `https://api.telegram.org/bot${activeToken}/getUpdates?offset=${offset}&timeout=0`;
            const pollRes = await fetch(updatesUrl);
            if (pollRes.ok) {
              const pollData = await pollRes.json();
              if (pollData.ok && pollData.result && pollData.result.length > 0) {
                for (const update of pollData.result) {
                  if (update.update_id >= offset) {
                    offset = update.update_id + 1;
                  }
                  if (update.message && update.message.chat) {
                    const text = (update.message.text || "").trim();
                    if (text === `/start ${sessId}` || text === `/start`) {
                      const chatId = update.message.chat.id;
                      const senderName = update.message.from.username
                        ? `@${update.message.from.username}`
                        : (update.message.from.first_name || "User");

                      stopTelegramPolling();
                      chrome.storage.local.set({ telegramChatId: String(chatId) });
                      showTelegramConnectedStatus(`Connected to ${senderName}!`);

                      // Send welcome test message
                      fetch(`https://api.telegram.org/bot${activeToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          chat_id: chatId,
                          text: `🎉 Prolific Study Notifier Pro connected successfully! You will receive new study notifications here.`
                        })
                      }).catch(e => console.error("Error sending welcome message:", e));

                      break;
                    }
                  }
                }
              }
            }
          } catch (pollErr) {
            console.error("Error polling Telegram updates:", pollErr);
          }
        }, 2500);
      } else {
        // Token is dummy or verification failed, show simulated instruction / connection
        if (telegramQrStatus) {
          telegramQrStatus.className = "qr-status-indicator warning";
          if (telegramQrDot) {
            telegramQrDot.className = "qr-status-dot pulse-dot active warning";
          }
          if (telegramQrStatusText) {
            telegramQrStatusText.textContent = `Demo Mode: Add your own Bot Token in Settings or code to connect.`;
          }
        }
      }
    });
  }

  let joinedIdsCache = [];
  let missedIdsCache = [];
  let activeHistoryFilter = "all"; // "all" or "missed"

  // Load Saved Settings & Initialize UI
  try {
    chrome.storage.local.get(null, (settings) => {
      console.log("[Prolific Notifier] Storage settings loaded:", settings);

      // Caches for badging
      joinedIdsCache = settings.joinedStudyIds || [];
      missedIdsCache = (settings.missedStudiesHistory || []).map(m => m.id);

      // Global Checker Switch
      safeSetChecked(checkerToggle, settings.enabled !== false);

      // Balance & Earnings display
      const userBal = parseFloat(settings.userBalance) || 0;
      const userPend = parseFloat(settings.userPendingBalance) || 0;
      safeSetText(lblBalance, `£${userBal.toFixed(2)}`);
      safeSetText(lblPending, `£${userPend.toFixed(2)}`);

      // Sound settings
      safeSetChecked(soundToggle, settings.soundEnabled !== false);
      safeSetValue(soundSelect, settings.soundType || "chime");

      const volVal = settings.soundVolume !== undefined ? settings.soundVolume : 100;
      safeSetValue(soundVolumeRange, volVal);
      safeSetText(lblSoundVolume, `${volVal}%`);

      // Filter settings
      const minRewVal = settings.minReward !== undefined ? settings.minReward : 0.00;
      const minHrVal = settings.minHourlyRate !== undefined ? settings.minHourlyRate : 0.00;
      const minPlVal = settings.minPlaces !== undefined ? settings.minPlaces : 1;
      const cdVal = settings.cooldownDuration !== undefined ? settings.cooldownDuration : 1;
      const kwEnabled = settings.keywordFilterEnabled === true;
      const kwVal = settings.keywords || "";

      safeSetValue(minRewardRange, minRewVal);
      safeSetText(lblMinReward, formatGbpUsd(minRewVal));
      safeSetValue(minHourlyRange, minHrVal);
      safeSetText(lblMinHourly, formatGbpUsdHourly(minHrVal));
      safeSetValue(minPlacesRange, minPlVal);
      safeSetText(lblMinPlaces, minPlVal);
      safeSetValue(cooldownSelect, cdVal);
      safeSetChecked(keywordToggle, kwEnabled);
      safeSetValue(keywordTextarea, kwVal);
      if (groupKeywordTextarea) groupKeywordTextarea.style.display = kwEnabled ? "block" : "none";

      // Researcher controls settings
      safeSetValue(txtFavoriteResearchers, settings.favoriteResearchers || "");
      safeSetValue(txtBlockedResearchers, settings.blockedResearchers || "");

      // Automation settings
      safeSetChecked(startupToggle, settings.openOnStartup === true);
      safeSetChecked(focusToggle, settings.focusOnNewStudy === true);
      safeSetChecked(openInNewWindowToggle, settings.openInNewWindow !== false); // default ON

      // Telegram Settings
      safeSetChecked(telegramToggle, settings.telegramEnabled === true);
      safeSetValue(txtTelegramToken, settings.telegramBotToken || "");
      checkTelegramConnection();

      // Discord Settings
      safeSetChecked(discordToggle, settings.discordEnabled === true);
      safeSetValue(txtDiscordWebhook, settings.discordWebhookUrl || "");
      if (discordBody) discordBody.style.display = settings.discordEnabled === true ? "block" : "none";

      // ntfy Settings
      safeSetChecked(ntfyToggle, settings.ntfyEnabled === true);
      safeSetValue(txtNtfyTopic, settings.ntfyTopic || "");
      if (ntfyBody) ntfyBody.style.display = settings.ntfyEnabled === true ? "block" : "none";

      // Pushover Settings
      safeSetChecked(pushoverToggle, settings.pushoverEnabled === true);
      safeSetValue(txtPushoverUser, settings.pushoverUserKey || "");
      safeSetValue(txtPushoverToken, settings.pushoverAppToken || "");
      if (pushoverBody) pushoverBody.style.display = settings.pushoverEnabled === true ? "block" : "none";

      // Polling Interval
      const intervalVal = settings.interval || 10; // default 10
      safeSetValue(pollingRange, intervalVal);
      safeSetText(lblPollingInterval, `${intervalVal}s`);

      // Initial range slider dynamic background fills
      [minRewardRange, minHourlyRange, minPlacesRange, soundVolumeRange, pollingRange].forEach(updateSliderBackground);

      // Radar expand state
      if (settings.radarExpanded) {
        if (radarBodyContent) radarBodyContent.style.display = "block";
        if (radarToggleIcon) radarToggleIcon.textContent = "▲";
      }

      // Update Status, History, Radar and Active lists
      updateStatusDisplay(settings.checkerStatus, settings.lastCheckTime, settings.lastError, settings.lastSuccessCheckTime);
      renderStudiesHistory(settings.studiesHistory || []);
      renderActiveStudies(settings.activeStudies || []);
      renderStudyRadar(settings.studyRadarStats || {});

      // Update AI Summary initially
      updateAISummary(
        settings.activeStudies || [],
        settings.studiesHistory || [],
        settings.studyRadarStats || {},
        settings.lastError,
        settings.checkerStatus,
        settings.lastSuccessCheckTime
      );

      // Theme setting load
      const currentTheme = settings.themeMode || "light";
      safeSetChecked(themeToggle, currentTheme === "dark");
      safeSetChecked(overlayToggle, settings.overlayEnabled === true);
      safeSetChecked(persistentNotificationsToggle, settings.persistentNotificationsEnabled === true);
      safeSetValue(persistentIntervalSelect, settings.persistentNotificationInterval || 15);
      safeSetValue(persistentMaxAlertsSelect, settings.persistentNotificationMaxCount || 5);
      if (persistentIntervalContainer) {
        persistentIntervalContainer.style.display = settings.persistentNotificationsEnabled === true ? "block" : "none";
      }
      if (currentTheme === "dark") {
        document.body.classList.add("dark");
      } else {
        document.body.classList.remove("dark");
      }
    });
  } catch (err) {
    console.error("[Prolific Notifier] Error in chrome.storage initialization:", err);
  }

  // Keep Status & Balance Display Fresh (1s polling)
  let lastCheckTimeCache = 0;
  setInterval(() => {
    try {
      chrome.storage.local.get([
        "checkerStatus",
        "lastCheckTime",
        "lastError",
        "studiesHistory",
        "activeStudies",
        "userBalance",
        "userPendingBalance",
        "joinedStudyIds",
        "missedStudiesHistory",
        "studyRadarStats",
        "lastSuccessCheckTime"
      ], (data) => {
        updateStatusDisplay(data.checkerStatus, data.lastCheckTime, data.lastError, data.lastSuccessCheckTime);

        // Update caches
        joinedIdsCache = data.joinedStudyIds || [];
        missedIdsCache = (data.missedStudiesHistory || []).map(m => m.id);

        // Update Balance & Projected dynamically
        const userBal = parseFloat(data.userBalance) || 0;
        const userPend = parseFloat(data.userPendingBalance) || 0;
        safeSetText(lblBalance, `£${userBal.toFixed(2)}`);
        safeSetText(lblPending, `£${userPend.toFixed(2)}`);

        // Refresh dynamic study lists if a fetch has occurred
        if (data.lastCheckTime !== lastCheckTimeCache) {
          lastCheckTimeCache = data.lastCheckTime;
          renderStudiesHistory(data.studiesHistory || []);
          renderActiveStudies(data.activeStudies || []);
          renderStudyRadar(data.studyRadarStats || {});
        }

        // Always keep AI Summary fresh based on current data
        updateAISummary(
          data.activeStudies || [],
          data.studiesHistory || [],
          data.studyRadarStats || {},
          data.lastError,
          data.checkerStatus,
          data.lastSuccessCheckTime
        );
      });
    } catch (e) {
      console.error("[Prolific Notifier] Error in live refresh interval:", e);
    }
  }, 1000);

  // Tab Navigation Handling
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = document.getElementById(targetTab);
      if (panel) panel.classList.add("active");
    });
  });

  // Global Checker Enable/Disable
  safeAddListener(checkerToggle, "change", () => {
    chrome.storage.local.set({ enabled: checkerToggle.checked });
  });

  // Appearance / Theme toggle
  safeAddListener(themeToggle, "change", () => {
    if (themeToggle) {
      const isDark = themeToggle.checked;
      const theme = isDark ? "dark" : "light";
      chrome.storage.local.set({ themeMode: theme }, () => {
        if (isDark) {
          document.body.classList.add("dark");
        } else {
          document.body.classList.remove("dark");
        }
        // Force repaint range slider fills as --primary color might have changed
        [minRewardRange, minHourlyRange, minPlacesRange, soundVolumeRange, pollingRange].forEach(updateSliderBackground);
      });
    }
  });

  // Widget toggle
  safeAddListener(overlayToggle, "change", () => {
    if (overlayToggle) {
      chrome.storage.local.set({ overlayEnabled: overlayToggle.checked });
    }
  });

  // Persistent notifications toggle
  safeAddListener(persistentNotificationsToggle, "change", () => {
    if (persistentNotificationsToggle) {
      const enabled = persistentNotificationsToggle.checked;
      chrome.storage.local.set({ persistentNotificationsEnabled: enabled });
      if (persistentIntervalContainer) {
        persistentIntervalContainer.style.display = enabled ? "block" : "none";
      }
    }
  });

  safeAddListener(persistentIntervalSelect, "change", () => {
    if (persistentIntervalSelect) {
      chrome.storage.local.set({ persistentNotificationInterval: parseInt(persistentIntervalSelect.value, 10) });
    }
  });

  safeAddListener(persistentMaxAlertsSelect, "change", () => {
    if (persistentMaxAlertsSelect) {
      chrome.storage.local.set({ persistentNotificationMaxCount: parseInt(persistentMaxAlertsSelect.value, 10) });
    }
  });

  // Manual Check Now Reload Button in Header
  safeAddListener(btnCheckNow, "click", () => {
    console.log("[Prolific Notifier] Check Now clicked. Message sent to background...");
    if (btnCheckNow) {
      btnCheckNow.classList.add("spinning");
      btnCheckNow.disabled = true;
    }

    chrome.runtime.sendMessage({ action: "check_now" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[Prolific Notifier] Message check_now failed:", chrome.runtime.lastError.message);
      }

      setTimeout(() => {
        if (btnCheckNow) {
          btnCheckNow.classList.remove("spinning");
          btnCheckNow.disabled = false;
        }

        // Load latest to display immediately
        chrome.storage.local.get([
          "checkerStatus",
          "lastCheckTime",
          "lastError",
          "studiesHistory",
          "activeStudies",
          "userBalance",
          "userPendingBalance",
          "joinedStudyIds",
          "missedStudiesHistory",
          "studyRadarStats",
          "lastSuccessCheckTime"
        ], (data) => {
          updateStatusDisplay(data.checkerStatus, data.lastCheckTime, data.lastError, data.lastSuccessCheckTime);
  
          // Update caches
          joinedIdsCache = data.joinedStudyIds || [];
          missedIdsCache = (data.missedStudiesHistory || []).map(m => m.id);
  
          // Update Balance & Projected dynamically
          const userBal = parseFloat(data.userBalance) || 0;
          const userPend = parseFloat(data.userPendingBalance) || 0;
          safeSetText(lblBalance, `£${userBal.toFixed(2)}`);
          safeSetText(lblPending, `£${userPend.toFixed(2)}`);
  
          // Refresh dynamic study lists if a fetch has occurred
          if (data.lastCheckTime !== lastCheckTimeCache) {
            lastCheckTimeCache = data.lastCheckTime;
            renderStudiesHistory(data.studiesHistory || []);
            renderActiveStudies(data.activeStudies || []);
            renderStudyRadar(data.studyRadarStats || {});
          }
  
          // Always keep AI Summary fresh based on current data
          updateAISummary(
            data.activeStudies || [],
            data.studiesHistory || [],
            data.studyRadarStats || {},
            data.lastError,
            data.checkerStatus,
            data.lastSuccessCheckTime
          );
        });
      }, 1000);
    });
  });

  // Radar toggle collapsible header listener
  safeAddListener(radarToggleHeader, "click", () => {
    if (radarBodyContent) {
      const isExpanded = radarBodyContent.style.display !== "none";
      radarBodyContent.style.display = isExpanded ? "none" : "block";
      if (radarToggleIcon) radarToggleIcon.textContent = isExpanded ? "▼" : "▲";
      chrome.storage.local.set({ radarExpanded: !isExpanded });
    }
  });

  // History Tab Filter Switch
  safeAddListener(filterHistoryAll, "click", () => {
    activeHistoryFilter = "all";
    if (filterHistoryAll) filterHistoryAll.classList.add("active");
    if (filterHistoryMissed) filterHistoryMissed.classList.remove("active");
    chrome.storage.local.get("studiesHistory", (data) => {
      renderStudiesHistory(data.studiesHistory || []);
    });
  });

  safeAddListener(filterHistoryMissed, "click", () => {
    activeHistoryFilter = "missed";
    if (filterHistoryAll) filterHistoryAll.classList.remove("active");
    if (filterHistoryMissed) filterHistoryMissed.classList.add("active");
    chrome.storage.local.get("studiesHistory", (data) => {
      renderStudiesHistory(data.studiesHistory || []);
    });
  });

  // Clear History Action
  safeAddListener(btnClearHistory, "click", () => {
    if (confirm("Are you sure you want to clear your study history and missed tracker log?")) {
      chrome.storage.local.set({ studiesHistory: [], missedStudiesHistory: [] }, () => {
        renderStudiesHistory([]);
      });
    }
  });

  // Export History Action
  safeAddListener(btnExportHistory, "click", () => {
    chrome.storage.local.get("studiesHistory", (data) => {
      const history = data.studiesHistory || [];
      if (history.length === 0) {
        alert("No study history available to export.");
        return;
      }
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(history, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `prolific_history_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });
  });

  // Close Error Banner Action
  safeAddListener(btnCloseError, "click", () => {
    if (errorBanner) errorBanner.style.display = "none";
    chrome.storage.local.remove("lastError");
  });

  // --- Notification Channel Listeners ---

  // Desktop Sound Toggle & Selection
  safeAddListener(soundToggle, "change", () => {
    chrome.storage.local.set({ soundEnabled: soundToggle.checked });
  });

  safeAddListener(soundSelect, "change", () => {
    chrome.storage.local.set({ soundType: soundSelect.value });
  });

  safeAddListener(btnTestSound, "click", () => {
    const soundVal = soundSelect ? soundSelect.value : "chime";
    chrome.runtime.sendMessage({
      action: "play_sound",
      soundType: soundVal
    });
  });

  // Volume slider control
  safeAddListener(soundVolumeRange, "input", (e) => {
    if (soundVolumeRange) {
      safeSetText(lblSoundVolume, `${soundVolumeRange.value}%`);
      updateSliderBackground(soundVolumeRange);
    }
  });

  safeAddListener(soundVolumeRange, "change", () => {
    if (soundVolumeRange) {
      chrome.storage.local.set({ soundVolume: parseInt(soundVolumeRange.value, 10) });
    }
  });

  // --- Slider and Filter Listeners ---

  // Reward Slider
  safeAddListener(minRewardRange, "input", () => {
    if (minRewardRange) {
      safeSetText(lblMinReward, formatGbpUsd(minRewardRange.value));
      updateSliderBackground(minRewardRange);
    }
  });

  safeAddListener(minRewardRange, "change", () => {
    if (minRewardRange) {
      chrome.storage.local.set({ minReward: parseFloat(minRewardRange.value) });
    }
  });

  // Hourly Rate Slider
  safeAddListener(minHourlyRange, "input", () => {
    if (minHourlyRange) {
      safeSetText(lblMinHourly, formatGbpUsdHourly(minHourlyRange.value));
      updateSliderBackground(minHourlyRange);
    }
  });

  safeAddListener(minHourlyRange, "change", () => {
    if (minHourlyRange) {
      chrome.storage.local.set({ minHourlyRate: parseFloat(minHourlyRange.value) });
    }
  });

  // Available Places Slider
  safeAddListener(minPlacesRange, "input", () => {
    if (minPlacesRange) {
      safeSetText(lblMinPlaces, minPlacesRange.value);
      updateSliderBackground(minPlacesRange);
    }
  });

  safeAddListener(minPlacesRange, "change", () => {
    if (minPlacesRange) {
      chrome.storage.local.set({ minPlaces: parseInt(minPlacesRange.value, 10) });
    }
  });

  // Cooldown Dropdown
  safeAddListener(cooldownSelect, "change", () => {
    if (cooldownSelect) {
      chrome.storage.local.set({ cooldownDuration: parseInt(cooldownSelect.value, 10) });
    }
  });

  // Keyword Toggle and textarea
  safeAddListener(keywordToggle, "change", () => {
    if (keywordToggle) {
      const enabled = keywordToggle.checked;
      chrome.storage.local.set({ keywordFilterEnabled: enabled });
      if (groupKeywordTextarea) {
        groupKeywordTextarea.style.display = enabled ? "block" : "none";
      }
    }
  });

  safeAddListener(keywordTextarea, "input", () => {
    if (keywordTextarea) {
      chrome.storage.local.set({ keywords: keywordTextarea.value });
    }
  });

  safeAddListener(txtFavoriteResearchers, "input", () => {
    if (txtFavoriteResearchers) {
      chrome.storage.local.set({ favoriteResearchers: txtFavoriteResearchers.value });
    }
  });

  safeAddListener(txtBlockedResearchers, "input", () => {
    if (txtBlockedResearchers) {
      chrome.storage.local.set({ blockedResearchers: txtBlockedResearchers.value });
    }
  });

  // --- Automation Settings Listeners ---
  safeAddListener(startupToggle, "change", () => {
    chrome.storage.local.set({ openOnStartup: startupToggle.checked });
  });

  safeAddListener(focusToggle, "change", () => {
    chrome.storage.local.set({ focusOnNewStudy: focusToggle.checked });
  });

  safeAddListener(openInNewWindowToggle, "change", () => {
    chrome.storage.local.set({ openInNewWindow: openInNewWindowToggle.checked });
  });

  // --- Sign out Link Action ---
  safeAddListener(btnSignOut, "click", (e) => {
    e.preventDefault();
    if (confirm("Are you sure you want to sign out? This will clear your captured Prolific session token.")) {
      chrome.storage.local.remove(["authHeader"], () => {
        chrome.storage.local.set({
          checkerStatus: "Waiting for login...",
          lastError: "Please keep your Prolific tab open and active to capture your session token. Refresh the tab if it is already open."
        });
        chrome.tabs.create({ url: "https://app.prolific.com/logout" });
      });
    }
  });

  // Telegram Webhook Inputs
  safeAddListener(telegramToggle, "change", () => {
    const enabled = telegramToggle.checked;
    chrome.storage.local.set({ telegramEnabled: enabled });
    if (!enabled) {
      stopTelegramPolling();
    } else {
      checkTelegramConnection();
    }
  });

  safeAddListener(txtTelegramToken, "input", () => {
    if (txtTelegramToken) {
      chrome.storage.local.set({ telegramBotToken: txtTelegramToken.value.trim() });
      checkTelegramConnection();
    }
  });

  // Discord Webhook Listeners
  safeAddListener(discordToggle, "change", () => {
    const enabled = discordToggle.checked;
    chrome.storage.local.set({ discordEnabled: enabled });
    if (discordBody) {
      discordBody.style.display = enabled ? "block" : "none";
    }
  });

  safeAddListener(txtDiscordWebhook, "input", () => {
    if (txtDiscordWebhook) {
      chrome.storage.local.set({ discordWebhookUrl: txtDiscordWebhook.value.trim() });
    }
  });

  // ntfy Listeners
  safeAddListener(ntfyToggle, "change", () => {
    const enabled = ntfyToggle.checked;
    chrome.storage.local.set({ ntfyEnabled: enabled });
    if (ntfyBody) {
      ntfyBody.style.display = enabled ? "block" : "none";
    }
  });

  safeAddListener(txtNtfyTopic, "input", () => {
    if (txtNtfyTopic) {
      chrome.storage.local.set({ ntfyTopic: txtNtfyTopic.value.trim() });
    }
  });

  // Pushover Listeners
  safeAddListener(pushoverToggle, "change", () => {
    const enabled = pushoverToggle.checked;
    chrome.storage.local.set({ pushoverEnabled: enabled });
    if (pushoverBody) {
      pushoverBody.style.display = enabled ? "block" : "none";
    }
  });

  safeAddListener(txtPushoverUser, "input", () => {
    if (txtPushoverUser) {
      chrome.storage.local.set({ pushoverUserKey: txtPushoverUser.value.trim() });
    }
  });

  safeAddListener(txtPushoverToken, "input", () => {
    if (txtPushoverToken) {
      chrome.storage.local.set({ pushoverAppToken: txtPushoverToken.value.trim() });
    }
  });

  // Polling Frequency Slider
  safeAddListener(pollingRange, "input", () => {
    if (pollingRange) {
      const val = pollingRange.value;
      safeSetText(lblPollingInterval, `${val}s`);
      updateSliderBackground(pollingRange);
    }
  });

  safeAddListener(pollingRange, "change", () => {
    if (pollingRange) {
      const val = parseInt(pollingRange.value, 10);
      chrome.storage.local.set({ interval: val });
    }
  });

  // Trigger Send Test Alerts
  safeAddListener(btnSendTest, "click", () => {
    console.log("[Prolific Notifier] Send Test clicked.");
    if (btnSendTest) {
      btnSendTest.disabled = true;
      btnSendTest.textContent = "Sending Test Alerts...";
    }

    chrome.runtime.sendMessage({ action: "send_test_notification" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[Prolific Notifier] Test Alert failed:", chrome.runtime.lastError.message);
      }
      setTimeout(() => {
        if (btnSendTest) {
          btnSendTest.disabled = false;
          btnSendTest.textContent = "🧪 Send Test Desktop + Mobile Alert";
        }
      }, 1500);
    });
  });

  // --- Rendering Utilities ---

  /**
   * Updates the AI Summary panel with a premium natural language overview
   */
  function updateAISummary(activeList, historyList, radarStats, lastError, checkerStatus, lastSuccessTime) {
    if (!lblAiSummary) return;

    const lastSuccess = lastSuccessTime || 0;
    const isGracePeriodActive = (Date.now() - lastSuccess <= 600000);
    const hasError = lastError || (checkerStatus && checkerStatus.includes("Unauthorized"));

    if (hasError && !isGracePeriodActive) {
      lblAiSummary.textContent = "🤖 Connection paused. Prolific session is invalid or expired. Please keep Prolific open and verify you are logged in to resume automatic check updates.";
      return;
    }

    if (activeList && activeList.length > 0) {
      const count = activeList.length;
      const favCount = activeList.filter(s => s.isFavorite).length;

      let totalRew = 0;
      let maxRew = 0;
      let maxHourly = 0;

      activeList.forEach(s => {
        const r = parseFloat(s.reward) || 0;
        const h = parseFloat(s.hourlyRate) || 0;
        totalRew += r;
        if (r > maxRew) maxRew = r;
        if (h > maxHourly) maxHourly = h;
      });

      const avgHourly = totalRew > 0 ? (activeList.reduce((acc, s) => acc + (parseFloat(s.hourlyRate) || 0), 0) / count) : 0;

      let msg = `🤖 Detected ${count} active stud${count === 1 ? "y" : "ies"} waiting for you, offering a total of £${totalRew.toFixed(2)}.`;
      if (favCount > 0) {
        msg += ` Contains ${favCount} premium custom-starred opportunities!`;
      }
      msg += ` The highest reward is £${maxRew.toFixed(2)} with a top rate of £${maxHourly.toFixed(2)}/hr. Click 'Join' to secure your slot before places fill up.`;
      lblAiSummary.textContent = msg;
    } else {
      // Check radar peak times
      let peakKey = "";
      let maxVal = 0;
      for (const key in radarStats) {
        if (radarStats[key] > maxVal) {
          maxVal = radarStats[key];
          peakKey = key;
        }
      }

      let radarMsg = "";
      if (peakKey) {
        const parts = peakKey.split("_");
        const day = parts[0];
        const hr = parseInt(parts[1], 10);
        const ampm = hr >= 12 ? (hr === 12 ? "12 PM" : `${hr - 12} PM`) : (hr === 0 ? "12 AM" : `${hr} AM`);
        radarMsg = ` Historically, your peak study opportunity window occurs on ${day} around ${ampm}.`;
      }

      let historyMsg = "";
      if (historyList && historyList.length > 0) {
        historyMsg = ` You have observed ${historyList.length} total studies.`;
      }

      lblAiSummary.textContent = `🤖 No active studies at the moment. Keep this window or your Prolific tab active to capture the next wave of studies.${radarMsg}${historyMsg}`;
    }
  }

  /**
   * Refreshes Status Indicators and Banner Alerts
   */
  function updateStatusDisplay(status, lastCheckTime, lastError, lastSuccessTime) {
    const lastSuccess = lastSuccessTime || 0;
    const isGracePeriodActive = (Date.now() - lastSuccess <= 600000);
    const hasError = lastError || (status && (status.includes("Unauthorized") || status.includes("Waiting")));

    if (hasError && !isGracePeriodActive) {
      safeSetText(statusText, status || "Stopped");
    } else {
      safeSetText(statusText, (status && status.includes("Checking")) ? "Checking..." : "Running");
    }

    if (statusDot) {
      statusDot.className = "pulse-dot"; // reset
      if (hasError && !isGracePeriodActive) {
        if (status && status.includes("Unauthorized")) {
          statusDot.classList.add("error");
        } else {
          statusDot.classList.add("warning");
        }
      } else if (status && (status.includes("Offline") || status.includes("Disconnected"))) {
        statusDot.classList.add("warning");
      } else {
        statusDot.classList.add("active");
        if (status && status.includes("Checking")) {
          statusDot.classList.add("checking");
        }
      }
    }

    if (lastCheckTime && lastCheckTime > 0) {
      const timeStr = new Date(lastCheckTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      safeSetText(lblLastChecked, timeStr);
    } else {
      safeSetText(lblLastChecked, "Never");
    }

    if (errorBanner) {
      if (lastError && !isGracePeriodActive) {
        safeSetText(errorMsgText, lastError);
        errorBanner.style.display = "flex";
      } else {
        errorBanner.style.display = "none";
      }
    }
  }

  /**
   * Renders active study items in the Studies list
   */
  function renderActiveStudies(activeList) {
    if (!activeStudiesList) return;

    // Clear previous items but keep placeholder in DOM cache
    activeStudiesList.innerHTML = "";

    if (!activeList || activeList.length === 0) {
      if (emptyActivePlaceholder) activeStudiesList.appendChild(emptyActivePlaceholder);
      return;
    }

    activeList.forEach(study => {
      const card = createStudyCardElement(study);
      activeStudiesList.appendChild(card);
    });
  }

  /**
   * Renders study items in history log list
   */
  function renderStudiesHistory(history) {
    if (!studiesList) return;

    studiesList.innerHTML = "";

    if (activeHistoryFilter === "missed") {
      chrome.storage.local.get("missedStudiesHistory", (data) => {
        const missed = data.missedStudiesHistory || [];
        renderList(missed);
      });
    } else {
      renderList(history);
    }

    function renderList(list) {
      if (!list || list.length === 0) {
        if (emptyFeedPlaceholder) studiesList.appendChild(emptyFeedPlaceholder);
        return;
      }

      list.forEach(study => {
        const card = createStudyCardElement(study);
        studiesList.appendChild(card);
      });
    }
  }

  /**
   * Creates a study card element
   */
  function createStudyCardElement(study) {
    const card = document.createElement("div");
    card.className = study.isFavorite ? "study-card favorite" : "study-card";

    const timeAgo = getRelativeTimeString(study.timestamp);
    const compatibilityStr = study.isMobile ? "📱 Mobile Supported" : "💻 Desktop Only";

    // Determine badge/action button
    let actionBadgeHTML = `<a href="https://app.prolific.com/studies/${study.id}" target="_blank" class="join-badge">Join</a>`;
    if (joinedIdsCache.includes(study.id)) {
      actionBadgeHTML = `<span class="join-badge joined" style="background-color: #d1fae5; color: #065f46; cursor: default;">Joined</span>`;
    } else if (missedIdsCache.includes(study.id)) {
      actionBadgeHTML = `<span class="join-badge missed" style="background-color: #fee2e2; color: #991b1b; cursor: default;">Missed</span>`;
    }

    card.innerHTML = `
      <div class="study-card-top">
        <span class="study-title" title="${escapeHTML(study.name)}">${escapeHTML(study.name)}</span>
        <span class="study-reward">£${study.reward}</span>
      </div>
      <div class="study-details">
        <div class="detail-item">⏱️ Est: <span class="detail-value">${study.estimatedTime}m</span></div>
        <div class="detail-item">📊 Rate: <span class="detail-value">£${study.hourlyRate}/hr</span></div>
        <div class="detail-item">👥 Left: <span class="detail-value">${study.placesLeft}</span></div>
        <div class="detail-item">${compatibilityStr}</div>
      </div>
      <div class="study-footer">
        <span class="study-time">${timeAgo}</span>
        ${actionBadgeHTML}
      </div>
    `;

    const joinLink = card.querySelector(".join-badge:not(.joined):not(.missed)");
    if (joinLink) {
      joinLink.addEventListener("click", () => {
        chrome.storage.local.get("joinedStudyIds", (store) => {
          const joined = store.joinedStudyIds || [];
          if (!joined.includes(study.id)) {
            joined.push(study.id);
            chrome.storage.local.set({ joinedStudyIds: joined });
          }
        });
        chrome.runtime.sendMessage({ action: "study_joined", studyId: study.id });
      });
    }

    return card;
  }

  /**
   * Renders the Study Radar analytics heatmap
   */
  function renderStudyRadar(stats) {
    const container = getEl("radar-heatmap");
    if (!container) return;
    container.innerHTML = "";

    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const dayAbbreviations = {
      "Monday": "Mon",
      "Tuesday": "Tue",
      "Wednesday": "Wed",
      "Thursday": "Thu",
      "Friday": "Fri",
      "Saturday": "Sat",
      "Sunday": "Sun"
    };

    // Calculate max value to scale colors relatively
    let maxVal = 0;
    for (const key in stats) {
      if (stats[key] > maxVal) {
        maxVal = stats[key];
      }
    }

    // Add hours header row
    const headerRow = document.createElement("div");
    headerRow.className = "heatmap-row heatmap-hours-header";
    const spacer = document.createElement("div");
    spacer.className = "heatmap-day-label";
    headerRow.appendChild(spacer);
    for (let h = 0; h < 24; h++) {
      const lbl = document.createElement("span");
      lbl.className = "heatmap-hour-label";
      if (h === 0) lbl.textContent = "12a";
      else if (h === 6) lbl.textContent = "6a";
      else if (h === 12) lbl.textContent = "12p";
      else if (h === 18) lbl.textContent = "6p";
      else lbl.textContent = "";
      headerRow.appendChild(lbl);
    }
    container.appendChild(headerRow);

    // Add row for each day
    days.forEach(day => {
      const row = document.createElement("div");
      row.className = "heatmap-row";

      const dayLabel = document.createElement("span");
      dayLabel.className = "heatmap-day-label";
      dayLabel.textContent = dayAbbreviations[day];
      row.appendChild(dayLabel);

      for (let h = 0; h < 24; h++) {
        const count = stats[`${day}_${h}`] || 0;
        let lvl = 0;
        if (maxVal > 0 && count > 0) {
          const ratio = count / maxVal;
          if (ratio <= 0.33) lvl = 1;
          else if (ratio <= 0.66) lvl = 2;
          else lvl = 3;
        }

        const cell = document.createElement("span");
        cell.className = `heatmap-cell lvl-${lvl}`;

        // Formatted hour for tooltip
        const hourStr = h === 0 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;
        cell.title = `${day} ${hourStr}: ${count} study${count === 1 ? "" : "s"} detected`;
        row.appendChild(cell);
      }
      container.appendChild(row);
    });
  }


  /**
   * Helper to format relative time
   */
  function getRelativeTimeString(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return "Just now";
    if (diff < 60) return `${diff}s ago`;

    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Escape HTML to prevent injection
   */
  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }
});
