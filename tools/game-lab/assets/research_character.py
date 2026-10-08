"""Inspect primary download links and public asset mirrors; executes no remote code."""
import json
import re
import urllib.request
import urllib.parse
import http.cookiejar

def fetch(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()

if __name__ == '__main__':
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base = 'https://quaternius.itch.io/universal-base-characters'
    html = opener.open(base).read().decode()
    token = re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)
    request = urllib.request.Request(base + '/download_url', data=urllib.parse.urlencode({'csrf_token': token}).encode(), headers={'Referer':base,'X-Requested-With':'XMLHttpRequest'})
    result = json.loads(opener.open(request).read())
    print('download response keys:', list(result))
    if result.get('url'):
        page = opener.open(result['url']).read().decode()
        cache = __import__('pathlib').Path.home() / '.codex/orbix-tooling/assets/quaternius-universal'
        cache.mkdir(parents=True, exist_ok=True)
        (cache / 'base-download.html').write_text(page, encoding='utf8')
        print('\n'.join(re.findall(r'.{0,100}(?:upload_id|download_btn|download_url|zip).{0,300}', page)))
        csrf = re.search(r'name="csrf_token" value="([^"]+)"', page).group(1)
        upload = re.search(r'data-upload_id="([0-9]+)"', page).group(1)
        file_request = urllib.request.Request(base + '/file/' + upload, data=urllib.parse.urlencode({'csrf_token':csrf}).encode(), headers={'Referer':result['url'],'X-Requested-With':'XMLHttpRequest'})
        file_result = json.loads(opener.open(file_request).read())
        print('file response keys:', list(file_result))
        if file_result.get('url'):
            target = cache / 'universal-base-characters-standard.zip'
            if not target.exists():
                with opener.open(file_result['url'], timeout=120) as source, target.open('wb') as output:
                    total = 0
                    while chunk := source.read(1024*1024):
                        total += len(chunk)
                        if total > 150*1024*1024:
                            raise ValueError('Asset exceeds 150 MiB')
                        output.write(chunk)
            print('saved:', target.name, target.stat().st_size)
