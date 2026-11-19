"""
Regression tests for API key cache invalidation on delete (Issue #1397).

lib/api-auth.ts keeps a per-process cache of API key hash -> user for up to
5 minutes, and a cache hit returns the user id without reading the database.
Deleting a `user` row through the generated service must drop the deleted
rows' key hashes from that cache once the delete commits, so the key stops
authenticating on the instance that handled the delete at once. Every other
entity must not touch the cache.
"""
import re

import pytest

from build_context import API_KEY_CACHE_MODELS
from test_permission_cache_invalidation import _render

CALL = 'for (const _hash of _deletedApiKeyHashes) invalidateApiKeyCache(_hash);'
COLLECT = 'if (_row.api_key_hash) _deletedApiKeyHashes.push(_row.api_key_hash);'


def _delete_body(out: str) -> str:
    return re.search(r'export async function delete\w+\(.*?\n}\n', out, re.S).group(0)


def test_api_key_cache_models_is_user():
    assert API_KEY_CACHE_MODELS == {'user'}


@pytest.mark.parametrize('model', sorted(API_KEY_CACHE_MODELS))
def test_delete_drops_the_deleted_rows_api_keys_after_commit(model):
    out = _render(model)
    assert "import { invalidateApiKeyCache } from '@/lib/api-auth';" in out
    body = _delete_body(out)
    assert body.count(COLLECT) == 1
    assert body.count(CALL) == 1
    # Collected inside the transaction, after the no-op early return, so a
    # delete that removed nothing drops nothing.
    tx_end = body.index('  });\n')
    assert body.index('if (_deleted.count === 0) return;') < body.index(COLLECT) < tx_end
    # Dropped only after the transaction committed.
    assert body.index(CALL) > tx_end
    # add/update do not touch the API key cache.
    assert out.count('invalidateApiKeyCache') == 2  # import + delete


def test_other_entities_do_not_touch_the_api_key_cache():
    for model in ('thing', 'role', 'permission'):
        out = _render(model)
        assert 'invalidateApiKeyCache' not in out
        assert '_deletedApiKeyHashes' not in out
