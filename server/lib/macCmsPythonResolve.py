#!/usr/bin/env python3
import json
import re
import sys
import time
from urllib.parse import quote, urlparse

import requests


COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'text/html,*/*',
}


def fail(message: str):
    print(message, file=sys.stderr)
    sys.exit(1)


def extract_mac_player_info(html: str):
    patterns = [
        r'mac_player_info\s*=\s*(\{.*?\})\s*<\/script>',
        r'mac_player_info\s*=\s*(\{.*?\})\s*;',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.S)
        if match:
            try:
                return json.loads(match.group(1))
            except Exception:
                continue
    return None


def extract_token(html: str):
    patterns = [
        r'["\']token["\']\s*:\s*["\']([^"\']+)["\']',
        r'token\s*[:=]\s*["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.I)
        if match:
            return match.group(1)
    return None


def make_iframe_base(page_url: str, html: str):
    explicit = re.search(r'https?://newplayer\.[a-zA-Z0-9.-]+', html, re.I)
    if explicit:
        return explicit.group(0)
    parsed = urlparse(page_url)
    host = parsed.hostname or ''
    host = re.sub(r'^www\.', '', host)
    return f'https://newplayer.{host}'


def main():
    if len(sys.argv) < 2:
        fail('missing page url')

    page_url = sys.argv[1]
    session = requests.Session()

    page_res = session.get(page_url, headers=COMMON_HEADERS, timeout=20)
    page_res.raise_for_status()
    page_html = page_res.text

    player_info = extract_mac_player_info(page_html)
    if not player_info or not player_info.get('url') or not player_info.get('from'):
        fail('fallback failed: 未找到 mac_player_info 或关键字段')

    iframe_base = make_iframe_base(page_url, page_html)
    title = 'video'
    encoded_url = player_info['url']
    iframe_url = f'{iframe_base}/player/index.php?code=ok&url={quote(encoded_url, safe="")}&tittle={quote(title, safe="")}'
    ec_url = f'{iframe_base}/player/ec.php?code=ok&url={quote(encoded_url, safe="")}&tittle={quote(title, safe="")}&main_domain={quote(page_url, safe="")}'

    session.get(iframe_url, headers={**COMMON_HEADERS, 'Referer': page_url}, timeout=20).raise_for_status()
    ec_res = session.get(ec_url, headers={**COMMON_HEADERS, 'Referer': page_url}, timeout=20)
    ec_res.raise_for_status()
    token = extract_token(ec_res.text)
    if not token:
        fail('fallback failed: ec.php 未提取到 token')

    resolve_url = f'{iframe_base}/index.php/api/resolve/url'
    started_at = time.time()
    while time.time() - started_at < 60:
        resolve_res = session.post(
            resolve_url,
            data={'token': token},
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json,text/plain,*/*',
                'Referer': ec_url,
                'Origin': iframe_base,
            },
            timeout=20,
        )
        resolve_res.raise_for_status()

        try:
            payload = resolve_res.json()
        except Exception:
            fail('fallback failed: resolve/url 未返回有效 JSON')

        m3u8_url = payload.get('data', {}).get('url') if isinstance(payload.get('data'), dict) else None
        if payload.get('code') == 1 and isinstance(m3u8_url, str) and m3u8_url:
            print(json.dumps({
                'm3u8Url': m3u8_url,
                'context': {
                    'from': player_info.get('from'),
                    'encrypt': player_info.get('encrypt'),
                    'link_next': player_info.get('link_next'),
                    'link_pre': player_info.get('link_pre'),
                    'id': player_info.get('id'),
                    'sid': player_info.get('sid'),
                    'nid': player_info.get('nid'),
                },
            }))
            return

        retry_after_ms = payload.get('data', {}).get('retry_after_ms') if isinstance(payload.get('data'), dict) else None
        if payload.get('code') == 0 and isinstance(retry_after_ms, (int, float)) and retry_after_ms > 0:
            time.sleep(min(retry_after_ms, 35000) / 1000)
            continue

        fail('fallback failed: resolve/url 返回中未找到 data.url')

    fail('fallback failed: resolve/url 超时')


if __name__ == '__main__':
    main()
