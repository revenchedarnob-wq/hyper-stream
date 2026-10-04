# HyperStream: keeps one yt-dlp running so each use skips its start-up.
#
# Installed next to HyperStream's own copy of yt-dlp and started as
# `yt-dlp hyperstream-worker:serve`. It reads one request per line on stdin,
# {"id": n, "args": [...]}, runs it exactly as the command line would, and answers with
# JSON lines: {"id": n, "o": line} (output), {"id": n, "e": line} (messages and errors),
# then {"id": n, "exit": code}. It does nothing unless started with that exact address.
import contextlib
import json
import os
import sys
import time

from yt_dlp.extractor.common import InfoExtractor


class _Lines:
    """A text stream that sends each complete line as one message."""

    def __init__(self, send, key):
        self._send, self._key, self._pending = send, key, ''

    def write(self, text):
        self._pending += text
        *lines, self._pending = self._pending.split('\n')
        for line in lines:
            self._send(self._key, line)
        return len(text)

    def close_line(self):
        if self._pending:
            self._send(self._key, self._pending)
            self._pending = ''

    def flush(self):
        pass

    def isatty(self):
        return False


def _serve():
    import yt_dlp

    out = sys.__stdout__.buffer
    current = [0]
    # Already reported by yt-dlp when raised; the command line exits quietly on these.
    reported = tuple(
        cls for cls in (
            getattr(yt_dlp.utils, 'DownloadError', None),
            getattr(getattr(yt_dlp, 'cookies', None), 'CookieLoadError', None),
        ) if cls)

    def send(key, value):
        out.write((json.dumps({'id': current[0], key: value}) + '\n').encode())
        out.flush()

    send('ready', time.time())
    for raw in sys.__stdin__.buffer:
        try:
            request = json.loads(raw)
        except ValueError:
            continue
        current[0] = request.get('id', 0)
        stdout, stderr = _Lines(send, 'o'), _Lines(send, 'e')
        code = 0
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                code = yt_dlp._real_main(request['args'])
            except SystemExit as e:
                code = e.code
            except reported:
                code = 1
            except Exception as e:  # what the command line would print before exiting
                stderr.write(f'ERROR: {e}\n')
                code = 1
        stdout.close_line()
        stderr.close_line()
        if isinstance(code, str):
            send('e', code)
            code = 1
        send('exit', code if isinstance(code, int) else 0)
    os._exit(0)


class HyperStreamWorkerIE(InfoExtractor):
    _VALID_URL = r'hyperstream-worker:serve$'
    IE_NAME = 'hyperstream:worker'

    def _real_extract(self, url):
        _serve()
