// HyperStream browser extension: finds videos on pages, sends pages and downloads to the app.
// Everything goes to the locally installed app through native messaging; nothing leaves the PC.

const HOST = 'com.hyperstream.bridge';
const MENU_ID = 'hyperstream-send';

/** Files that are worth handing over when the browser starts downloading them. */
const CATCH_EXTENSIONS = new Set(
  ('zip rar 7z gz tgz bz2 xz zst tar iso img vhd vhdx exe msi msix msixbundle appx appxbundle apk xapk ' +
    'dmg pkg deb rpm mp4 mkv webm mov avi wmv flv m4v ts mp3 m4a aac flac wav ogg opus').split(' '),
);
const DEFAULTS = { catchDownloads: true, minSizeMB: 2 };

// ---------------------------------------------------------------- app connection

async function toApp(message) {
  try {
    const reply = await chrome.runtime.sendNativeMessage(HOST, { v: 1, ...message });
    return reply ?? { ok: false, error: 'No answer from HyperStream.' };
  } catch (e) {
    return { ok: false, missing: true, error: String(e?.message ?? e) };
  }
}

/** Cookies the browser would send to these addresses, so sign-in-only media works in the app. */
async function cookiesFor(...urls) {
  const seen = new Map();
  for (const url of urls) {
    if (!/^https?:/i.test(url ?? '')) continue;
    try {
      for (const c of await chrome.cookies.getAll({ url })) {
        seen.set(`${c.domain}|${c.path}|${c.name}`, {
          domain: c.domain,
          hostOnly: c.hostOnly,
          path: c.path,
          secure: c.secure,
          expires: Math.floor(c.expirationDate ?? 0),
          name: c.name,
          value: c.value,
        });
      }
    } catch {
      // No access to this site's cookies: send without.
    }
  }
  return [...seen.values()];
}

async function sendPage(url, title, extra = {}) {
  return toApp({ kind: 'page', url, title: title ?? '', cookies: await cookiesFor(url), userAgent: navigator.userAgent, ...extra });
}

// ---------------------------------------------------------------- media found on pages

const MANIFEST = /\.(m3u8|mpd)(\?|#|$)/i;
const MEDIA_FILE = /\.(mp4|m4v|webm|mkv|mov|flv|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i;
// Pieces of a stream, captions, keys, and sites the app reads from the page link instead.
const IGNORE = /\.(ts|m4s|cmfv|cmfa|vtt|webvtt|key)(\?|#|$)|googlevideo\.com\/videoplayback|[?&](range|bytestart|byterange)=/i;
const MIN_FILE_BYTES = 1024 * 1024;
const MAX_PER_TAB = 25;

function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

function classify(details) {
  const url = details.url;
  if (!/^https?:/i.test(url) || IGNORE.test(url) || details.tabId < 0) return null;
  const type = header(details.responseHeaders, 'content-type').toLowerCase();
  const isManifest = MANIFEST.test(url) || /mpegurl|dash\+xml/.test(type);
  if (isManifest) {
    return { url, kind: /mpd|dash/.test(url + type) ? 'DASH' : 'HLS', size: 0 };
  }
  const isMedia = /^(video|audio)\//.test(type) || MEDIA_FILE.test(url);
  if (!isMedia) return null;
  const range = header(details.responseHeaders, 'content-range');
  const size = Number(range.split('/')[1]) || Number(header(details.responseHeaders, 'content-length')) || 0;
  if (size && size < MIN_FILE_BYTES) return null;
  const ext = (url.match(MEDIA_FILE)?.[1] ?? type.split('/')[1] ?? 'media').toUpperCase();
  return { url, kind: ext.replace(/^X-/, ''), size };
}

/** Same file with different query strings (tokens, ranges) counts once. */
function sameFile(a, b) {
  const strip = (u) => u.split(/[?#]/)[0];
  return strip(a) === strip(b);
}

async function remember(tabId, item) {
  const key = `tab:${tabId}`;
  const list = (await chrome.storage.session.get(key))[key] ?? [];
  if (list.some((x) => sameFile(x.url, item.url))) return;
  list.push({ ...item, at: Date.now() });
  if (list.length > MAX_PER_TAB) list.shift();
  await chrome.storage.session.set({ [key]: list });
  await chrome.action.setBadgeText({ tabId, text: String(list.length) });
}

async function forget(tabId) {
  await chrome.storage.session.remove(`tab:${tabId}`);
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.statusCode >= 400) return;
    const item = classify(details);
    if (item) remember(details.tabId, item);
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders'],
);

chrome.tabs.onUpdated.addListener((tabId, change) => {
  // New page (including in-page navigation on video sites): the old list no longer applies.
  if (change.url) forget(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => forget(tabId));

// ---------------------------------------------------------------- right-click menu

// Lets the app know the extension is installed (and in which browser), even before first use.
chrome.runtime.onStartup.addListener(() => toApp({ kind: 'ping' }));

chrome.runtime.onInstalled.addListener(async () => {
  toApp({ kind: 'ping' });
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  await chrome.storage.local.set({ ...DEFAULTS, ...stored });
  chrome.action.setBadgeBackgroundColor({ color: '#6d5efc' });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Download with HyperStream',
      contexts: ['page', 'link', 'video', 'audio'],
    });
  });
});

function looksLikeFile(url) {
  const name = url.split(/[?#]/)[0].split('/').pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return CATCH_EXTENSIONS.has(ext) && !MEDIA_FILE.test(name) ? name : null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const media = /^https?:/i.test(info.srcUrl ?? '') ? info.srcUrl : null;
  const link = /^https?:/i.test(info.linkUrl ?? '') ? info.linkUrl : null;
  const page = info.pageUrl ?? tab?.url ?? '';
  let reply;
  const fileName = link && looksLikeFile(link);
  if (fileName) {
    reply = await toApp({
      kind: 'file',
      url: link,
      filename: decodeURIComponent(fileName),
      referrer: page,
      cookies: await cookiesFor(link),
      userAgent: navigator.userAgent,
    });
  } else {
    // A video element playing a stream (blob:) has no usable address; the page link works instead.
    reply = await sendPage(media ?? link ?? page, tab?.title, { referrer: page });
  }
  flash(tab?.id, reply);
});

/** Short confirmation on the toolbar icon. */
function flash(tabId, reply) {
  if (tabId == null) return;
  chrome.action.setBadgeText({ tabId, text: reply.ok ? '✓' : '!' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: reply.ok ? '#16a34a' : '#dc2626' });
  if (!reply.ok) chrome.action.setTitle({ tabId, title: `HyperStream: ${reply.error}` });
  setTimeout(async () => {
    const key = `tab:${tabId}`;
    const list = (await chrome.storage.session.get(key))[key] ?? [];
    chrome.action.setBadgeText({ tabId, text: list.length ? String(list.length) : '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#6d5efc' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'HyperStream' }).catch(() => {});
  }, 2500);
}

// ---------------------------------------------------------------- catching browser downloads

// A paused download can be restarted by the browser, which asks again: take each over once.
const handled = new Set();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  suggest(); // keep the browser's own choice; we only decide whether to take the download over
  maybeCatch(item);
});

async function maybeCatch(item) {
  if (handled.has(item.id)) return;
  handled.add(item.id);
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  if (!settings.catchDownloads || item.incognito || item.byExtensionId) return;
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return; // blob:/data: downloads only exist inside the browser
  const name = (item.filename ?? '').split(/[\\/]/).pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!CATCH_EXTENSIONS.has(ext)) return;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize;
  if (size > 0 && size < settings.minSizeMB * 1024 * 1024) return;

  await chrome.downloads.pause(item.id).catch(() => {});
  const reply = await toApp({
    kind: 'file',
    url,
    filename: name,
    size: size > 0 ? size : 0,
    referrer: item.referrer ?? '',
    cookies: await cookiesFor(url),
    userAgent: navigator.userAgent,
  });
  if (reply.ok) {
    await chrome.downloads.cancel(item.id).catch(() => {});
    await chrome.downloads.erase({ id: item.id }).catch(() => {});
  } else {
    // The app isn't available: let the browser finish it as usual.
    await chrome.downloads.resume(item.id).catch(() => {});
  }
}

// ---------------------------------------------------------------- popup requests

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    if (msg.type === 'status') return respond(await toApp({ kind: 'ping' }));
    if (msg.type === 'prefetch') return respond(await toApp({ kind: 'prefetch', url: msg.url }));
    if (msg.type === 'send-page') return respond(await sendPage(msg.url, msg.title));
    if (msg.type === 'send-media') {
      return respond(
        await toApp({
          kind: 'media',
          url: msg.url,
          page: msg.page,
          title: msg.title ?? '',
          referrer: msg.page,
          cookies: await cookiesFor(msg.url, msg.page),
          userAgent: navigator.userAgent,
        }),
      );
    }
    respond({ ok: false, error: 'Unknown request' });
  })();
  return true; // answer asynchronously
});
