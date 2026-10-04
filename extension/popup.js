const $ = (id) => document.getElementById(id);
const VIDEO_SITES =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|reddit\.com|soundcloud\.com|bilibili\.com|bandcamp\.com|streamable\.com|rumble\.com)$/i;

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 1 ? 1 : 0)} ${units[i]}`;
}

function shortAddress(url) {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return `${u.hostname}${file ? ` · ${decodeURIComponent(file)}` : ''}`;
  } catch {
    return url;
  }
}

function showResult(button, reply, doneLabel) {
  if (reply.ok) {
    button.textContent = doneLabel;
    setTimeout(() => window.close(), 700);
  } else {
    button.disabled = false;
    button.textContent = 'Try again';
    $('page-note').textContent = reply.error ?? 'Something went wrong.';
    if (reply.missing) $('missing').hidden = false;
  }
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url ?? '';
  const webPage = /^https?:/i.test(pageUrl);

  const sendPage = $('send-page');
  sendPage.disabled = !webPage;
  $('page-note').textContent = webPage ? shortAddress(pageUrl) : 'Open a web page to send it.';
  sendPage.addEventListener('click', async () => {
    sendPage.disabled = true;
    sendPage.textContent = 'Sending…';
    showResult(sendPage, await chrome.runtime.sendMessage({ type: 'send-page', url: pageUrl, title: tab.title }), 'Sent to HyperStream');
  });

  const key = `tab:${tab?.id}`;
  const found = ((await chrome.storage.session.get(key))[key] ?? []).slice().reverse();
  // Likely a video page: the app starts looking it up now, so "Download" is instant.
  if (webPage && (found.length || VIDEO_SITES.test(new URL(pageUrl).hostname))) {
    chrome.runtime.sendMessage({ type: 'prefetch', url: pageUrl });
  }
  if (found.length) {
    $('media').hidden = false;
    const list = $('media-list');
    for (const item of found) {
      const li = document.createElement('li');
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = item.kind;
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = [formatSize(item.size), shortAddress(item.url)].filter(Boolean).join(' · ');
      where.title = item.url;
      const get = document.createElement('button');
      get.className = 'get';
      get.textContent = 'Download';
      get.addEventListener('click', async () => {
        get.disabled = true;
        get.textContent = 'Sending…';
        const reply = await chrome.runtime.sendMessage({ type: 'send-media', url: item.url, page: pageUrl, title: tab.title });
        showResult(get, reply, 'Sent');
      });
      li.append(kind, where, get);
      list.append(li);
    }
  }

  const catchBox = $('catch');
  const { catchDownloads = true } = await chrome.storage.local.get('catchDownloads');
  catchBox.checked = catchDownloads;
  catchBox.addEventListener('change', () => chrome.storage.local.set({ catchDownloads: catchBox.checked }));

  const status = $('status');
  const reply = await chrome.runtime.sendMessage({ type: 'status' });
  if (reply.ok) {
    status.textContent = 'Connected';
    status.className = 'status ok';
  } else {
    status.textContent = 'Not connected';
    status.className = 'status bad';
    status.title = reply.error ?? '';
    $('missing').hidden = false;
  }
}

main();
