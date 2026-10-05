// Shields page script: hides leftover ad slots, skips YouTube ads and declines cookie banners.
// Network blocking happens natively; `__HYPERSTREAM_SHIELDS_CONFIG__` is prepended by the app.
(function () {
  if (window.__HYPERSTREAM_SHIELDS__) return;

  var config = window.__HYPERSTREAM_SHIELDS_CONFIG__ || { enabled: true, allowedSites: [] };
  var STYLE_ID = '__hyperstream_shields_style__';

  function pageHost() {
    try {
      return window.top.location.hostname;
    } catch {}
    try {
      var origins = window.location.ancestorOrigins;
      if (origins && origins.length) return new URL(origins[origins.length - 1]).hostname;
    } catch {}
    return window.location.hostname;
  }

  var host = (pageHost() || '').replace(/^www\./, '').toLowerCase();
  var enabled = !!config.enabled && (config.allowedSites || []).indexOf(host) === -1;
  var isTopFrame = window.top === window;
  var isYouTube = /(^|\.)youtube\.com$/.test(host);

  var cosmeticCSS = [
    'ins.adsbygoogle, div[id*="google_ads"], iframe[id*="google_ads"], iframe[src*="googlesyndication.com"],',
    'iframe[src*="doubleclick.net"], div[id^="ad_unit_"], div[id^="dfp-ad-"], div[class*="GoogleActiveViewElement"],',
    '.ytp-ad-overlay-container, .ytp-ad-message-container, .ytp-ad-action-interstitial,',
    'ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-banner-promo-renderer, ytd-in-feed-ad-layout-renderer,',
    'ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-statement-banner-renderer, #masthead-ad, #player-ads,',
    'div[class*="taboola"], div[id*="taboola"], div[class*="outbrain"], div[id*="outbrain"], div[class*="revcontent"],',
    '.trc_related_container, .trc_rbox_div, iframe[src*="amazon-adsystem.com"], div[id*="amzn-assoc-ad"],',
    '.ad-container, .ad-banner, .ad-wrapper, .ad-slot, [data-ad-unit], [data-ad-slot] {',
    '  display: none !important;',
    '}'
  ].join('\n');

  function injectStyles() {
    if (!enabled || document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = cosmeticCSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeStyles() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function skipYouTubeAds() {
    if (!enabled) return;
    try {
      var player = document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
      var video = player && player.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 0) {
        video.muted = true;
        video.currentTime = video.duration;
      }
      var skip = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
      if (skip && typeof skip.click === 'function') skip.click();
    } catch {}
  }

  // Declines optional cookies. Never clicks "accept".
  var REJECT_SELECTORS = [
    '#onetrust-reject-all-handler',
    'button[data-cookiebanner="reject_button"]',
    '.cc-deny',
    'button[data-cy*="reject" i]',
    'button[id*="reject-all" i]',
    'button[class*="reject-all" i]'
  ].join(', ');
  var bannerAttempts = 0;
  function declineCookieBanners() {
    if (!enabled || bannerAttempts > 10) return;
    bannerAttempts++;
    try {
      var button = document.querySelector(REJECT_SELECTORS);
      if (!button) return;
      var text = (button.textContent || '').toLowerCase();
      if (/accept|agree|allow all/.test(text)) return;
      button.click();
      bannerAttempts = 99;
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
  } else {
    injectStyles();
  }

  // Active media stream sniffer: detects playing HTML5 video/audio, HLS, DASH, and WebM streams
  var sniffedMedia = new Set();
  function reportMedia(src, isVideo) {
    if (!src || (src.indexOf('blob:') === 0 && !isVideo)) return;
    if (sniffedMedia.has(src)) return;
    sniffedMedia.add(src);
    var format = 'MP4';
    if (/\.m3u8([?#]|$)/i.test(src)) format = 'HLS';
    else if (/\.mpd([?#]|$)/i.test(src)) format = 'DASH';
    else if (/\.webm([?#]|$)/i.test(src)) format = 'WebM';
    else if (/\.mp3([?#]|$)/i.test(src)) format = 'MP3';
    else if (/\.ogg([?#]|$)/i.test(src)) format = 'OGG';
    else if (/\.wav([?#]|$)/i.test(src)) format = 'WAV';

    var title = document.title || (isVideo ? 'Web Video' : 'Web Audio');
    try {
      if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
        window.chrome.webview.postMessage(JSON.stringify({
          type: 'media-sniffed',
          url: src,
          pageUrl: window.location.href,
          title: title,
          format: format,
          isVideo: isVideo
        }));
      }
    } catch (e) {}
  }

  function scanMediaElements() {
    try {
      var videos = document.getElementsByTagName('video');
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        var src = v.currentSrc || v.src;
        if (src) reportMedia(src, true);
        else {
          var sources = v.getElementsByTagName('source');
          for (var j = 0; j < sources.length; j++) {
            if (sources[j].src) reportMedia(sources[j].src, true);
          }
        }
      }
      var audios = document.getElementsByTagName('audio');
      for (var k = 0; k < audios.length; k++) {
        var a = audios[k];
        var aSrc = a.currentSrc || a.src;
        if (aSrc) reportMedia(aSrc, false);
      }
    } catch (e) {}
  }

  document.addEventListener('play', function (e) {
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      var isV = e.target.tagName === 'VIDEO';
      var src = e.target.currentSrc || e.target.src;
      if (src) reportMedia(src, isV);
    }
  }, true);

  document.addEventListener('loadedmetadata', function (e) {
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      var isV = e.target.tagName === 'VIDEO';
      var src = e.target.currentSrc || e.target.src;
      if (src) reportMedia(src, isV);
    }
  }, true);

  if (isTopFrame) {
    if (isYouTube) setInterval(skipYouTubeAds, 500);
    setInterval(declineCookieBanners, 1500);
    setInterval(scanMediaElements, 2500);
  }

  window.__HYPERSTREAM_SHIELDS__ = {
    set: function (on) {
      enabled = !!on;
      if (enabled) injectStyles();
      else removeStyles();
    }
  };
})();
