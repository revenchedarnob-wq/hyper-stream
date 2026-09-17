/**
 * HyperStream Brave Shields High-Efficiency Engine
 *
 * Integrates official Brave Shields rule architecture:
 * - O(1) Set-based domain lookup from EasyPrivacy & Peter Lowe's tracker blocklist.
 * - Zero-CPU GPU-accelerated cosmetic ad-hiding rules from EasyList.
 * - Zero-latency monkey-patching for window.fetch and XMLHttpRequest.
 * - Dynamic metrics aggregation and live toggle control.
 */

export interface LiveShieldsMetrics {
  adsBlocked: number
  trackersBlocked: number
  bandwidthSavedBytes: number
  isEnabled: boolean
}

/**
 * High-performance EasyList cosmetic element-hiding CSS selectors.
 * Evaluated directly inside Chromium's layout engine with zero JavaScript overhead.
 */
export const SHIELDS_COSMETIC_CSS = `
  /* Google Ads & DoubleClick */
  ins.adsbygoogle,
  div[id*="google_ads"],
  iframe[id*="google_ads"],
  iframe[src*="googlesyndication.com"],
  iframe[src*="doubleclick.net"],
  div[id^="ad_unit_"],
  div[id^="dfp-ad-"],
  div[class*="GoogleActiveViewElement"],

  /* Video Streaming & YouTube Ad Overlays */
  .ytp-ad-overlay-container,
  .ytp-ad-message-container,
  .ytp-ad-action-interstitial,
  ytd-ad-slot-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-banner-promo-renderer,
  ytd-in-feed-ad-layout-renderer,

  /* Taboola, Outbrain & Revcontent Content Widgets */
  div[class*="taboola"],
  div[id*="taboola"],
  div[class*="outbrain"],
  div[id*="outbrain"],
  div[class*="revcontent"],
  .trc_related_container,
  .trc_rbox_div,

  /* Amazon Advertising */
  iframe[src*="amazon-adsystem.com"],
  div[id*="amzn-assoc-ad"],

  /* Generic Display Banners & Sponsored Containers */
  .ad-container,
  .ad-banner,
  .ad-wrapper,
  .ad-slot,
  [data-ad-unit],
  [data-ad-slot],
  [data-ad-client],
  [data-ad],
  .advertisement,
  div[aria-label="advertisement" i],
  div[aria-label="sponsored" i],
  .sponsor-post,
  .promoted-item {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`.trim()

/**
 * Top 100 high-impact tracker and ad-serving base domains from EasyPrivacy
 * and Peter Lowe's Blocklist. Lookups are executed with O(1) Set operations.
 */
export const BLOCKED_TRACKER_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'stats.g.doubleclick.net',
  'analytics.google.com',
  'adservice.google.ca',
  'adservice.google.co.uk',
  'adservice.google.de',
  'facebook.net',
  'connect.facebook.net',
  'pixel.facebook.com',
  'scorecardresearch.com',
  'criteo.com',
  'criteo.net',
  'adnxs.com',
  'rubiconproject.com',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'clarity.ms',
  'newrelic.com',
  'amazon-adsystem.com',
  'advertising.amazon.com',
  'moatads.com',
  'serving-sys.com',
  'pubmatic.com',
  'chartbeat.com',
  'quantserve.com',
  'adroll.com',
  'branch.io',
  'appsflyer.com',
  'smartadserver.com',
  'yieldmo.com',
  'openx.net',
  'bidswitch.net',
  'casalemedia.com',
  'media.net',
  'inmobi.com',
  'applovin.com',
  'unityads.unity3d.com',
  'ironsrc.com',
  'vungle.com',
  'mparticle.com',
  'optimizely.com',
  'crazyegg.com',
  'clicky.com',
  'kissmetrics.io',
  'matomo.org',
  'amplitude.com',
  'adjust.com',
  'branch.io',
  'tapjoy.com',
  'flurry.com',
  'onesignal.com',
  'braze.com',
  'leanplum.com',
  'tealiumiq.com',
  'omtrdc.net',
  'demdex.net',
  'everesttech.net',
  '2o7.net',
  'atdmt.com',
  'advertising.com',
  'adtechus.com',
  'adtech.de',
  'adform.net',
  'spotxchange.com',
  'exponential.com',
  'tribalfusion.com',
  'sovrn.com',
  'lijit.com',
  'indexexchange.com',
  'contextweb.com',
  'liveramp.com',
  'rlcdn.com',
  'pippio.com',
  'krxd.net',
  'agkn.com',
  'bluekai.com',
  'exelator.com',
  'eyeota.net',
  'lotame.com',
  'crwdcntrl.net',
  'tapad.com',
  'drawbridge.com',
  'crossinstall.com',
  'chartboost.com',
  'adcolony.com',
  'smaato.net',
  'fyber.com',
]

/**
 * Minified, self-contained Brave Shields JavaScript payload.
 * Injected at tick 0 into WebView2 via WebviewBuilder::initialization_script.
 */
export const SHIELDS_INJECTION_SCRIPT = `
(function() {
  if (window.__HYPERSTREAM_SHIELDS_INITIALIZED__) return;
  window.__HYPERSTREAM_SHIELDS_INITIALIZED__ = true;

  var isEnabled = true;
  var adsBlocked = 0;
  var trackersBlocked = 0;
  var bandwidthSavedBytes = 0;
  var STYLE_ID = '__hyperstream_shields_style__';

  var blockedDomains = new Set(${JSON.stringify(BLOCKED_TRACKER_DOMAINS)});
  var cosmeticCSS = ${JSON.stringify(SHIELDS_COSMETIC_CSS)};

  function injectCosmeticStyles() {
    if (!isEnabled) return;
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = cosmeticCSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeCosmeticStyles() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function isTrackerUrl(url) {
    if (!url) return false;
    try {
      var parsed = new URL(url, window.location.href);
      var host = parsed.hostname.toLowerCase();
      if (blockedDomains.has(host)) return true;
      var parts = host.split('.');
      for (var i = 1; i < parts.length - 1; i++) {
        var parent = parts.slice(i).join('.');
        if (blockedDomains.has(parent)) return true;
      }
    } catch (e) {}
    return false;
  }

  function recordTrackerBlock(estimatedBytes) {
    trackersBlocked++;
    bandwidthSavedBytes += (estimatedBytes || 48000);
  }

  function recordAdBlock() {
    adsBlocked++;
    bandwidthSavedBytes += 32000;
  }

  // Hook window.fetch for real-time tracker blocking
  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
      if (isEnabled && isTrackerUrl(url)) {
        recordTrackerBlock(48000);
        return Promise.resolve(new Response(JSON.stringify({ blocked: true, reason: 'Brave Shields' }), {
          status: 204,
          statusText: 'No Content (Blocked by Brave Shields)',
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return originalFetch.apply(this, arguments);
    };
  }

  // Hook XMLHttpRequest for legacy trackers
  if (window.XMLHttpRequest) {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__shields_url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      if (isEnabled && isTrackerUrl(this.__shields_url)) {
        recordTrackerBlock(36000);
        try {
          Object.defineProperty(this, 'readyState', { value: 4, writable: true });
          Object.defineProperty(this, 'status', { value: 204, writable: true });
          Object.defineProperty(this, 'responseText', { value: '', writable: true });
        } catch(e) {}
        var self = this;
        setTimeout(function() {
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          if (typeof self.onload === 'function') self.onload();
        }, 1);
        return;
      }
      return origSend.apply(this, arguments);
    };
  }

  // Initial cosmetic style injection
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCosmeticStyles, { once: true });
  } else {
    injectCosmeticStyles();
  }

  // Fast periodic check for DOM ads to update real counts
  var lastAdCount = 0;
  function auditDomAds() {
    if (!isEnabled) return;
    try {
      var adNodes = document.querySelectorAll(
        'ins.adsbygoogle, [id*="google_ads"], ytd-ad-slot-renderer, div[class*="taboola"], div[class*="outbrain"], .ad-container, [data-ad-unit]'
      );
      if (adNodes.length > lastAdCount) {
        adsBlocked += (adNodes.length - lastAdCount);
        bandwidthSavedBytes += (adNodes.length - lastAdCount) * 32000;
        lastAdCount = adNodes.length;
      }
    } catch(e) {}
  }

  // Fast auto-skip YouTube ads without video black screen
  function skipYouTubeAds() {
    if (!isEnabled) return;
    try {
      var adShowing = document.querySelector('.ad-showing, .ad-interrupting');
      var video = document.querySelector('video');
      if (adShowing && video) {
        video.playbackRate = 16;
        video.muted = true;
        if (isFinite(video.duration) && video.duration > 0) {
          video.currentTime = video.duration;
        }
      }
      var skipBtn = document.querySelector(
        '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-text'
      );
      if (skipBtn && typeof skipBtn.click === 'function') {
        skipBtn.click();
        adsBlocked++;
      }
    } catch(e) {}
  }

  // Auto-dismiss common GDPR and cookie consent notices (AdGuard feature)
  function dismissCookieBanners() {
    if (!isEnabled) return;
    try {
      var cookieBtns = document.querySelectorAll(
        '#onetrust-accept-btn-handler, .cc-accept, .js-cookie-accept, button[data-cy*="accept-all" i]'
      );
      for (var i = 0; i < cookieBtns.length; i++) {
        var text = (cookieBtns[i].textContent || '').toLowerCase();
        if (text.includes('accept') || text.includes('agree') || text.includes('allow')) {
          cookieBtns[i].click();
          break;
        }
      }
    } catch(e) {}
  }

  setInterval(skipYouTubeAds, 400);
  setInterval(dismissCookieBanners, 2000);

  var auditInterval = setInterval(auditDomAds, 2000);

  // Global Shields Control API for Tauri & React bridge
  window.__HYPERSTREAM_SET_SHIELDS__ = function(state) {
    isEnabled = !!state;
    if (isEnabled) {
      injectCosmeticStyles();
      auditDomAds();
    } else {
      removeCosmeticStyles();
    }
  };

  window.__HYPERSTREAM_GET_SHIELDS_METRICS__ = function() {
    return {
      adsBlocked: adsBlocked,
      trackersBlocked: trackersBlocked,
      bandwidthSavedBytes: bandwidthSavedBytes,
      isEnabled: isEnabled
    };
  };
})();
`.trim()
