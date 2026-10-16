import pytest
from test_security import client, store, login
from app import mapdata


@pytest.fixture
def mapdir(tmp_path, monkeypatch):
    monkeypatch.setattr(mapdata, 'MAP_DIR', tmp_path)
    return tmp_path


def test_map_status_empty(client, mapdir):
    login(client)
    j = client.get('/api/map/status').json()
    assert j['installed'] is False and j['size_mb'] == 0 and j['fonts'] == 0 and j['job'] is None


def test_map_status_installed(client, mapdir):
    login(client)
    (mapdir / 'china.pmtiles').write_bytes(b'0' * 1048576)
    d = mapdir / 'fonts' / 'Noto Sans Regular'
    d.mkdir(parents=True)
    (d / '0-255.pbf').write_bytes(b'x')
    sd = mapdir / 'sprites'
    sd.mkdir()
    (sd / 'light.json').write_text('{}')
    j = client.get('/api/map/status').json()
    assert j['installed'] is True and j['size_mb'] == 1 and j['fonts'] == 1 and j['sprites'] == 1


def test_map_download_forbidden_for_viewer(client, mapdir):
    login(client, 'guest')
    assert client.post('/api/map/download').status_code == 403


def test_map_download_conflict_while_running(client, mapdir, monkeypatch):
    login(client)
    monkeypatch.setattr(mapdata, '_job', {'stage': 'pmtiles', 'detail': '', 'error': '', 'done': False})
    assert client.post('/api/map/download').status_code == 409
