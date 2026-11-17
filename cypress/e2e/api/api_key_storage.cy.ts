// Hand-written -- not part of the generated entity test set.
// An API key is stored only as its SHA-256 hash (user.api_key_hash). The key authenticates, the stored hash
// does not, and neither the key nor the hash appears in any REST response, export, import or audit row; a
// request cannot set either one. Verified by: api_key_storage.cy.ts.
import { TEST_API_KEY } from '../../support/test-credentials';

type ApiKeyStorage = { hash: string | null; issuedAt: string | null; hasPlaintextColumn: boolean };

const EMAIL = 'api_keystore_setting@example.com'; // what db:createApiUserWithPermission derives from label/entity

// The trailing 24-char cuid2 of the key is the user's own id (and the id `setting` expects).
function userIdFromApiKey(apiKey: string): string {
  const match = apiKey.match(/([a-z0-9]{24})$/);
  if (!match) throw new Error(`Could not extract user id from API key: ${apiKey}`);
  return match[1];
}

function expectNoSecret(body: unknown, secrets: string[]) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  secrets.forEach((secret) => expect(text, 'response must not contain the key or its hash').to.not.contain(secret));
}

describe('API: API key storage', () => {
  let apiKey: string;
  let hash: string;

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'setting',
      flags: { read: true, update: true },
      label: 'keystore',
    }).then((key) => {
      apiKey = key;
      return cy.task<string>('apiKey:hash', key).then((h) => {
        hash = h;
      });
    });
  });

  it('stores the SHA-256 of the key, as PostgreSQL computes it, and keeps no plaintext column', () => {
    cy.task<ApiKeyStorage>('db:getApiKeyStorage', EMAIL).then((storage) => {
      expect(storage.hash).to.eq(hash);
      expect(storage.hash).to.match(/^[0-9a-f]{64}$/);
      expect(storage.hasPlaintextColumn, 'user.api_key no longer exists').to.eq(false);
    });
    cy.task<string>('db:sqlSha256', apiKey).then((sqlHash) => expect(sqlHash).to.eq(hash));
    // Non-ASCII input: the hash is taken over the UTF-8 bytes on both sides.
    const unicode = 'mk_ключ-ü-キー';
    cy.task<string>('apiKey:hash', unicode).then((nodeHash) => {
      cy.task<string>('db:sqlSha256', unicode).then((sqlHash) => expect(sqlHash).to.eq(nodeHash));
    });
  });

  it('authenticates with the key and with nothing else', () => {
    const id = userIdFromApiKey(apiKey);
    cy.request({ url: `/api/setting/${id}`, headers: { 'X-API-Key': apiKey } }).its('status').should('eq', 200);
    cy.request({ url: `/api/setting/${id}`, headers: { 'Authorization': `Bearer ${apiKey}` } }).its('status').should('eq', 200);
    // The stored hash is not a credential.
    cy.request({ url: `/api/setting/${id}`, headers: { 'X-API-Key': hash }, failOnStatusCode: false })
      .its('status').should('eq', 401);
    cy.request({ url: `/api/setting/${id}`, headers: { 'X-API-Key': `${apiKey}x` }, failOnStatusCode: false })
      .its('status').should('eq', 401);
  });

  it('returns neither the key nor its hash from any read, list, export or search', () => {
    const id = userIdFromApiKey(apiKey);
    const secrets = [apiKey, hash];
    const asKeyUser = { 'X-API-Key': apiKey };
    const asAdmin = { 'X-API-Key': TEST_API_KEY };

    cy.request({ url: `/api/setting/${id}`, headers: asKeyUser }).then((res) => expectNoSecret(res.body, secrets));
    cy.request({ url: `/api/user/${id}`, headers: asAdmin }).then((res) => {
      expect(res.status).to.eq(200);
      expectNoSecret(res.body, secrets);
    });
    cy.request({ url: '/api/user', headers: asAdmin }).then((res) => expectNoSecret(res.body, secrets));
    cy.request({ url: '/api/user/export', headers: asAdmin }).then((res) => {
      expect(res.status).to.eq(200);
      expectNoSecret(res.body, secrets);
      expectNoSecret(JSON.stringify(res.headers), secrets);
    });
    cy.request({ url: '/api/user/options?q=keystore', headers: asAdmin, failOnStatusCode: false })
      .then((res) => expectNoSecret(res.body, secrets));
    // A search for the key, or for its hash, finds nothing.
    secrets.forEach((secret) => {
      cy.request({ url: `/api/user?search=${secret}`, headers: asAdmin, failOnStatusCode: false })
        .then((res) => expect(JSON.stringify(res.body)).to.not.contain(EMAIL));
    });
  });

  it('cannot be set or changed by a request body', () => {
    const id = userIdFromApiKey(apiKey);
    const attackerKey = 'mk_attacker_chosen_key';
    cy.task<string>('apiKey:hash', attackerKey).then((attackerHash) => {
      cy.request({
        method: 'PUT',
        url: `/api/setting/${id}`,
        headers: { 'X-API-Key': apiKey },
        body: {
          name: 'Renamed Account',
          email: EMAIL,
          api_key: attackerKey,
          api_key_hash: attackerHash,
          api_key_issued_at: '2000-01-01T00:00:00.000Z',
        },
        failOnStatusCode: false,
      });
      cy.task<ApiKeyStorage>('db:getApiKeyStorage', EMAIL).then((storage) => {
        expect(storage.hash, 'stored hash is unchanged').to.eq(hash);
      });
      cy.request({ url: `/api/setting/${id}`, headers: { 'X-API-Key': attackerKey }, failOnStatusCode: false })
        .its('status').should('eq', 401);
      cy.request({ url: `/api/setting/${id}`, headers: { 'X-API-Key': apiKey } }).its('status').should('eq', 200);
    });
  });

  it('cannot be set by a CSV import of the user entity', () => {
    cy.task<{ id: string; email: string }>('db:createUserWithName', { name: 'keystore_import_target' }).then((record) => {
      const csv = `name,api_key_hash,api_key\nkeystore_import_target,${hash},${apiKey}`;
      cy.request({
        method: 'POST',
        url: '/api/user/import',
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { csv, dryRun: true },
        failOnStatusCode: false,
      });
      cy.task<ApiKeyStorage>('db:getApiKeyStorage', record.email).then((storage) => {
        expect(storage.hash, 'an import never writes a key').to.eq(null);
      });
    });
  });

  it('never writes the key or its hash into the audit log', () => {
    const id = userIdFromApiKey(apiKey);
    cy.request({
      method: 'PUT',
      url: `/api/setting/${id}`,
      headers: { 'X-API-Key': apiKey },
      body: { name: 'Renamed Account', email: EMAIL },
    }).its('status').should('eq', 200);
    [apiKey, hash].forEach((secret) => {
      cy.task<number>('db:countAuditLogRowsMentioning', secret).should('eq', 0);
    });
  });
});
