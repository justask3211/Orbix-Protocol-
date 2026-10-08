"""Exercise the real authenticated upload, storage and reload paths."""
import base64
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from PIL import Image
from center.tests.test_profiles import _client, _sign_in
from center.api import API_PREFIX


def image_data(fmt='WEBP', size=(512, 300), color='coral'):
    stream = BytesIO()
    Image.new('RGB', size, color).save(stream, format=fmt)
    return f'data:image/{fmt.lower()};base64,' + base64.b64encode(stream.getvalue()).decode()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('CENTER_AVATARS_DIR', str(tmp_path / 'avatars'))
    client = _client(tmp_path)
    headers, address = _sign_in(client)
    return client, headers, address, tmp_path / 'avatars'


@pytest.mark.parametrize('fmt', ['WEBP', 'PNG', 'JPEG'])
def test_upload_before_profile_and_reload(setup, fmt):
    client, headers, address, folder = setup
    response = client.post(f'{API_PREFIX}/profile/image', headers=headers, json={'image': image_data(fmt)})
    assert response.status_code == 200, response.text
    profile = client.get(f'{API_PREFIX}/profile/{address}').json()
    assert profile['hasImage'] is True
    served = client.get(response.json()['url'])
    assert served.status_code == 200
    assert served.headers['content-type'] == 'image/webp'
    with Image.open(BytesIO(served.content)) as image:
        assert image.format == 'WEBP' and image.size == (256, 256)
    assert len(list(folder.glob('*.webp'))) == 1
    assert client.get(f'{API_PREFIX}/profile/image/{address.upper()}').content == served.content


@pytest.mark.parametrize('value', [None, 123, [], 'data:image/webp;base64,%%%%', 'data:image/webp;base64,YWJj', 'data:image/svg+xml;base64,PHN2Zy8+'])
def test_bad_images_rejected(setup, value):
    client, headers, _, _ = setup
    assert client.post(f'{API_PREFIX}/profile/image', headers=headers, json={'image': value}).status_code == 422


def test_limits_and_address_validation(setup):
    client, headers, _, _ = setup
    payload = 'data:image/webp;base64,' + base64.b64encode(b'x' * (2 * 1024 * 1024 + 1)).decode()
    assert client.post(f'{API_PREFIX}/profile/image', headers=headers, json={'image': payload}).status_code == 422
    assert client.get(f'{API_PREFIX}/profile/image/not-a-wallet').status_code == 422
    assert client.post(f'{API_PREFIX}/profile/image', json={'image': image_data()}).status_code == 401


def test_concurrent_overwrite_is_complete_and_revalidated(setup):
    client, headers, address, folder = setup
    def upload(color):
        return client.post(f'{API_PREFIX}/profile/image', headers=headers, json={'image': image_data(color=color)})
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert all(r.status_code == 200 for r in pool.map(upload, ['red', 'blue', 'green', 'yellow']))
    first = client.get(f'{API_PREFIX}/profile/image/{address}')
    with Image.open(BytesIO(first.content)) as image:
        image.load()
        assert image.size == (256, 256)
    assert first.headers['cache-control'] == 'no-cache'
    assert upload('magenta').status_code == 200
    second = client.get(f'{API_PREFIX}/profile/image/{address}')
    assert first.content != second.content and first.headers['etag'] != second.headers['etag']
    assert len(list(folder.iterdir())) == 1
