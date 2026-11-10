# Prolific Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](manifest.json)
[![GitHub Pages](https://img.shields.io/badge/Hosted%20Dashboard-Live-brightgreen.svg)](https://suhasmartha.github.io/Prolific-Kit/)

An all-in-one companion toolkit for Prolific participants. Includes:
1. **Prolific Study Notifier Pro** – A Manifest V3 Chrome extension that tracks study availability in real time and sends instant alerts via Desktop notifications, Telegram, Discord, Pushover, and ntfy.
2. **Prolific Insights Dashboard** – An interactive, client-side earnings & analytics web application hosted live on GitHub Pages.

---

## 🌐 Live Web Dashboard

Access the hosted Prolific Insights dashboard directly in your browser:

👉 **[https://suhasmartha.github.io/Prolific-Kit/](https://suhasmartha.github.io/Prolific-Kit/)**

- **Zero setup required**: No servers, no account logins, no database.
- **100% Private**: Your CSV/Excel export file is parsed directly in your browser using Web APIs. No data is ever sent to any remote server.

---

## ✨ Features

### 1. Prolific Study Notifier Pro (Chrome Extension)
- **Real-Time Monitoring**: Regularly polls Prolific studies in the background using native Manifest V3 alarms and service workers.
- **Multi-Channel Alert Dispatch**:
  - **Desktop Alerts**: Native browser notifications with action buttons.
  - **Telegram Bot**: Instant push notifications with study details and reservation links.
  - **Discord**: Channel notifications via webhooks.
  - **ntfy**: Free, open-source mobile push notifications without registration.
  - **Pushover**: Dedicated mobile push notifications.
- **Audio Notifications**: Custom alert sounds played via an offscreen audio runner.
- **Modern Popup Interface**:
  - Live active and pending balance displays.
  - Active study feed with reward rate indicators and direct study links.
  - Configurable polling frequency slider (10s to 180s).
  - One-click test notification button.

### 2. Prolific Insights (Web Dashboard)
- **Comprehensive Earnings Metrics**: Total earned, pending balance, average hourly rate, completion time, and submissions count.
- **Multi-Currency Support**: Handles GBP (£), USD ($), and EUR (€) without artificial conversion distortions.
- **Outcome Status Tracking**: Breakdown of approved, awaiting review, returned, rejected, and timed-out studies.
- **Visual Analytics**: Interactive charts for daily/monthly earnings trends, hourly pay distribution, and study categories.
- **Export Reports**: Generate clean, shareable PDF summary reports and Power BI-ready CSV datasets.

---

## 🚀 Installation Guide (Chrome Extension)

To load the extension into Google Chrome, Microsoft Edge, Brave, or Opera:

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/SuhasMartha/Prolific-Kit.git
   ```
2. Open your Chromium-based browser and navigate to:
   - Chrome / Brave: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked**.
5. Select the `Prolific-Kit` folder where this repository was cloned.
6. The **Prolific Study Notifier Pro** icon will appear in your extension toolbar. Pin it for quick access!

---

## ⚙️ Configuration & Setup

### Using the Insights Dashboard
1. Go to your [Prolific Submissions page](https://app.prolific.com/submissions).
2. Click **Download submissions** to save your `.csv` file.
3. Open the [Prolific Insights Dashboard](https://suhasmartha.github.io/Prolific-Kit/).
4. Drag and drop your downloaded file onto the page to view your stats.

### Notification Integrations
Inside the extension popup, switch to the **Settings** tab to configure your preferred alerts:

- **Telegram**: Enable the Telegram toggle and link your bot or chat.
- **Discord**: Paste your Discord Channel Webhook URL.
- **ntfy**: Choose any private topic name (e.g. `prolific_alerts_yourname`) and subscribe to it in the free ntfy mobile app.
- **Pushover**: Enter your User Key and Application API Token from your Pushover dashboard.

---

## 🔒 Privacy & Security

- **No Remote Tracking**: All study monitoring happens locally inside your browser session using your existing Prolific credentials.
- **No Third-Party Analytics**: The Insights dashboard runs completely offline in the browser client. Your earnings data never leaves your computer.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

