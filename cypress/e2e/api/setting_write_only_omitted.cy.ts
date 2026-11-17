// Hand-written -- not part of the generated entity test set.
// PUT /api/setting/:id with the write-only password left out of the body, or sent empty, must leave the
// stored password and the stored API key hash unchanged (Issue #1155). Changing the password needs the
// current password: setting_credential_confirmation.cy.ts. The API key is not a field of this entity at all
// (api_key_storage.cy.ts). The persisted state is read back with the `db:getCredentialState` task.
type CredentialState = { passwordIsNull: boolean; apiKeyIsNull: boolean; passwordHash: string | null };

const EMAIL = 'api_writeonly_setting@example.com';
const SEEDED_PASSWORD = 'not_needed'; // what db:createApiUserWithPermission stores

// The trailing 24-char cuid2 of the key is the user's own id (and the id `setting` expects).
function userIdFromApiKey(apiKey: string): string {
  const match = apiKey.match(/([a-z0-9]{24})$/);
  if (!match) throw new Error(`Could not extract user id from API key: ${apiKey}`);
  return match[1];
}

function putSetting(apiKey: string, body: Record<string, unknown>) {
  return cy.request({
    method: 'PUT',
    url: `/api/setting/${userIdFromApiKey(apiKey)}`,
    headers: { 'X-API-Key': apiKey },
    body: { name: 'Renamed Account', email: EMAIL, ...body },
  });
}

describe('API: setting update leaves omitted write-only fields unchanged', () => {
  let apiKey: string;

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'setting',
      flags: { read: true, update: true },
      label: 'writeonly',
    }).then((key) => {
      apiKey = key;
    });
  });

  function expectCredentialsUntouched() {
    cy.task<CredentialState>('db:getCredentialState', EMAIL).then((state) => {
      expect(state.passwordIsNull, 'password is not cleared').to.eq(false);
      expect(state.passwordHash).to.eq(SEEDED_PASSWORD);
      expect(state.apiKeyIsNull, 'api key hash is not cleared').to.eq(false);
    });
  }

  it('keeps the password and the api key when the body omits both', () => {
    putSetting(apiKey, {}).its('status').should('eq', 200);
    expectCredentialsUntouched();
    // The api_key still authenticates.
    cy.request({ url: `/api/setting/${userIdFromApiKey(apiKey)}`, headers: { 'X-API-Key': apiKey } })
      .its('status').should('eq', 200);
  });

  it('keeps the password and the api key when the body sends them empty', () => {
    putSetting(apiKey, { password: '', api_key: '', api_key_hash: '' }).its('status').should('eq', 200);
    expectCredentialsUntouched();
  });
});
