// Hand-written — not part of the generated entity test set (cmd_354/357).
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';
import type { MfaUserSeed } from '../../support/mfa-helpers';

const TOKEN_URL = '/api/mobile/auth/token';
const REFRESH_URL = '/api/mobile/auth/refresh';
const SESSIONS_URL = '/api/mobile/auth/sessions';

type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

function login(email: string, password: string, mfa_code?: string) {
  return cy.request({
    method: 'POST',
    url: TOKEN_URL,
    body: { email, password, mfa_code },
    failOnStatusCode: false,
  });
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('API: Mobile Auth (cmd_354/357)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('POST /api/mobile/auth/token', () => {
    it('issues an access/refresh token pair for valid credentials', () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((res) => {
        expect(res.status).to.eq(201);
        const body = res.body as TokenPair;
        expect(body.token_type).to.eq('Bearer');
        expect(body.expires_in).to.eq(900);
        expect(body.access_token.split('.')).to.have.length(3);
        expect(body.refresh_token).to.match(/^[0-9a-f]{64}$/);
        // No email/name/role leakage in the login response (354a section_10.iv).
        expect(body).to.not.have.property('email');
        expect(body).to.not.have.property('name');
        expect(body).to.not.have.property('role');
      });
    });

    it('rejects a wrong password with 401', () => {
      login(TEST_CREDENTIALS.email, 'wrong-password').then((res) => {
        expect(res.status).to.eq(401);
        expect(res.body.error).to.eq('Invalid credentials');
      });
    });

    it('rejects an unknown email with the same 401 message as a wrong password', () => {
      login('nobody-at-all@example.com', 'whatever123').then((res) => {
        expect(res.status).to.eq(401);
        expect(res.body.error).to.eq('Invalid credentials');
      });
    });

    it('rejects an SSO-only (passwordless) user with 401', () => {
      cy.task<{ email: string }>('db:createPasswordlessUser').then(({ email }) => {
        login(email, 'anything123').then((res) => {
          expect(res.status).to.eq(401);
          expect(res.body.error).to.eq('Invalid credentials');
        });
      });
    });

    it('requires MFA when enabled (403 MFA_REQUIRED), then succeeds with a valid code', () => {
      cy.task<MfaUserSeed>('db:seedMfaUser').then((mfaUser) => {
        login(mfaUser.email, mfaUser.password).then((res) => {
          expect(res.status).to.eq(403);
          expect(res.body.error).to.eq('MFA_REQUIRED');
        });
        cy.task<string>('generateTotp', mfaUser.secret).then((code) => {
          login(mfaUser.email, mfaUser.password, code).then((res) => {
            expect(res.status).to.eq(201);
            expect(res.body.access_token).to.be.a('string');
          });
        });
      });
    });

    it('rejects an invalid MFA code with 401', () => {
      cy.task<MfaUserSeed>('db:seedMfaUser').then((mfaUser) => {
        login(mfaUser.email, mfaUser.password, '000000').then((res) => {
          expect(res.status).to.eq(401);
        });
      });
    });

    it('rejects an anonymized account with 401 even with the correct password', () => {
      cy.task<{ email: string; password: string }>('db:createAnonymizedMobileUser').then(
        ({ email, password }) => {
          login(email, password).then((res) => {
            expect(res.status).to.eq(401);
            expect(res.body.error).to.eq('Invalid credentials');
          });
        },
      );
    });

    // The exact 5/15min threshold and its RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT
    // test-env override are unit-tested in lib/rate-limit/index.test.ts —
    // same split as the pre-existing auth:signin:credentials bucket, which
    // also isn't E2E-tested at its numeric threshold. .env.test widens this
    // bucket for the same reason RATE_LIMIT_AUTH_CREDENTIALS_LIMIT exists:
    // this spec alone makes 10+ legitimate POSTs against TEST_CREDENTIALS.email.
  });

  describe('POST /api/mobile/auth/refresh', () => {
    it('rotates the refresh token and issues a new access/refresh pair', () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const original = loginRes.body as TokenPair;
        cy.request({ method: 'POST', url: REFRESH_URL, body: { refresh_token: original.refresh_token } })
          .then((res) => {
            expect(res.status).to.eq(200);
            const rotated = res.body as TokenPair;
            expect(rotated.access_token).to.not.eq(original.access_token);
            expect(rotated.refresh_token).to.not.eq(original.refresh_token);
          });
      });
    });

    it('rejects a sequential reuse of an already-rotated refresh token, without revoking the (still-valid) rotated session', () => {
      // A stale token submitted well after rotation (e.g. a retried request
      // after a dropped response) is simply invalid — this is NOT the DP-3
      // race case, and must not nuke the now-legitimate rotated session.
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const original = loginRes.body as TokenPair;
        cy.request({ method: 'POST', url: REFRESH_URL, body: { refresh_token: original.refresh_token } })
          .then((firstRefreshRes) => {
            expect(firstRefreshRes.status).to.eq(200);
            const rotated = firstRefreshRes.body as TokenPair;

            cy.request({
              method: 'POST',
              url: REFRESH_URL,
              body: { refresh_token: original.refresh_token },
              failOnStatusCode: false,
            }).then((reuseRes) => {
              expect(reuseRes.status).to.eq(401);
            });

            cy.request({ method: 'POST', url: REFRESH_URL, body: { refresh_token: rotated.refresh_token } })
              .then((res) => {
                expect(res.status).to.eq(200);
              });
          });
      });
    });

    it('DP-3: a genuine concurrent double-refresh revokes the whole session — one wins, one loses, and the winner is retroactively invalidated', () => {
      // cy.request() is sequential by design; true HTTP-level concurrency
      // (both requests reading the same pre-rotation hash before either
      // commits) is only reachable via a Node-side Promise.all, hence the
      // dedicated task.
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const original = loginRes.body as TokenPair;
        cy.task<[{ status: number; body: TokenPair | { error: string } }, { status: number; body: TokenPair | { error: string } }]>(
          'raceRefresh',
          { baseUrl: Cypress.config('baseUrl'), refreshToken: original.refresh_token },
        ).then(([a, b]) => {
          const statuses = [a.status, b.status].sort();
          expect(statuses).to.deep.equal([200, 401]);
          const winner = a.status === 200 ? a : b;
          const winningPair = winner.body as TokenPair;

          // The whole session was revoked as a result of the detected race
          // — even the winning, freshly-rotated refresh token is now dead.
          cy.request({
            method: 'POST',
            url: REFRESH_URL,
            body: { refresh_token: winningPair.refresh_token },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.eq(401);
          });
        });
      });
    });

    it('rejects an unknown refresh token with 401', () => {
      cy.request({
        method: 'POST',
        url: REFRESH_URL,
        body: { refresh_token: 'a'.repeat(64) },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });
  });

  describe('DELETE /api/mobile/auth/token (logout)', () => {
    it('requires authentication (401 without a token)', () => {
      cy.request({ method: 'DELETE', url: TOKEN_URL, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });

    it('revokes the session so a subsequent refresh fails', () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const pair = loginRes.body as TokenPair;
        cy.request({ method: 'DELETE', url: TOKEN_URL, headers: bearer(pair.access_token) })
          .then((res) => {
            expect(res.status).to.eq(204);
          });
        cy.request({
          method: 'POST',
          url: REFRESH_URL,
          body: { refresh_token: pair.refresh_token },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(401);
        });
      });
    });
  });

  describe('GET /api/mobile/auth/sessions', () => {
    it('requires authentication (401 without a token)', () => {
      cy.request({ url: SESSIONS_URL, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });

    it("lists only the caller's own active sessions, marking the current one", () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const pair = loginRes.body as TokenPair;
        cy.request({ url: SESSIONS_URL, headers: bearer(pair.access_token) }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.sessions).to.have.length(1);
          expect(res.body.sessions[0].current).to.eq(true);
          expect(res.body.sessions[0]).to.not.have.property('refresh_token_hash');
        });
      });
    });
  });

  describe('DELETE /api/mobile/auth/sessions/:id', () => {
    it('requires authentication (401 without a token)', () => {
      cy.request({ method: 'DELETE', url: `${SESSIONS_URL}/whatever`, failOnStatusCode: false }).then(
        (res) => {
          expect(res.status).to.eq(401);
        },
      );
    });

    it("cannot revoke another user's session (404, ownership-checked in the query itself)", () => {
      cy.task<{ email: string; password: string }>('db:createSecondMobileUser').then((second) => {
        login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((firstLoginRes) => {
          const firstPair = firstLoginRes.body as TokenPair;
          cy.request({ url: SESSIONS_URL, headers: bearer(firstPair.access_token) }).then(
            (sessionsRes) => {
              const firstSessionId = sessionsRes.body.sessions[0].id;
              login(second.email, second.password).then((secondLoginRes) => {
                const secondPair = secondLoginRes.body as TokenPair;
                cy.request({
                  method: 'DELETE',
                  url: `${SESSIONS_URL}/${firstSessionId}`,
                  headers: bearer(secondPair.access_token),
                  failOnStatusCode: false,
                }).then((res) => {
                  expect(res.status).to.eq(404);
                });
                // Untouched: the original owner's refresh flow still works.
                cy.request({
                  method: 'POST',
                  url: REFRESH_URL,
                  body: { refresh_token: firstPair.refresh_token },
                }).then((res) => {
                  expect(res.status).to.eq(200);
                });
              });
            },
          );
        });
      });
    });

    it("revokes one's own device session by id", () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const pair = loginRes.body as TokenPair;
        cy.request({ url: SESSIONS_URL, headers: bearer(pair.access_token) }).then((sessionsRes) => {
          const sessionId = sessionsRes.body.sessions[0].id;
          cy.request({
            method: 'DELETE',
            url: `${SESSIONS_URL}/${sessionId}`,
            headers: bearer(pair.access_token),
          }).then((res) => {
            expect(res.status).to.eq(204);
          });
          cy.request({
            method: 'POST',
            url: REFRESH_URL,
            body: { refresh_token: pair.refresh_token },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.eq(401);
          });
        });
      });
    });
  });

  // ---------------------------------------------------------------------
  // cmd_357 condition 2 (most-scrutinized item) — the `type: "mobile_access"`
  // claim is the ONLY discriminator between a mobile access token and a
  // NextAuth web session JWT, both signed with the same AUTH_SECRET. Every
  // verification path must check it in both directions.
  // ---------------------------------------------------------------------
  describe('condition 2 — type-claim cross-check', () => {
    it('(a) rejects an AUTH_SECRET-signed HS256 token with no type claim (simulating a NextAuth-shaped JWT)', () => {
      cy.task<string>('signRawJwtWithAuthSecret', { sub: 'some-user-id', session_id: 'some-session-id' })
        .then((noTypeToken) => {
          cy.request({ url: SESSIONS_URL, headers: bearer(noTypeToken), failOnStatusCode: false }).then(
            (res) => {
              expect(res.status).to.eq(401);
            },
          );
        });
    });

    it('(a) rejects a token with the wrong type claim value', () => {
      cy.task<string>('signRawJwtWithAuthSecret', {
        sub: 'some-user-id',
        session_id: 'some-session-id',
        type: 'web_session',
      }).then((wrongTypeToken) => {
        cy.request({ url: SESSIONS_URL, headers: bearer(wrongTypeToken), failOnStatusCode: false }).then(
          (res) => {
            expect(res.status).to.eq(401);
          },
        );
      });
    });

    it('(b) rejects a valid mobile access token at the session-cookie-only /api/user-account/api-key endpoint', () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const pair = loginRes.body as TokenPair;
        cy.request({
          url: '/api/user-account/api-key',
          headers: bearer(pair.access_token),
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(401);
        });
      });
    });
  });

  // ---------------------------------------------------------------------
  // DP-1 (Option A, unified authenticate()) blast radius: existing REST
  // routes must accept a mobile access token AND must keep accepting
  // X-API-Key exactly as before — neither auth method may regress the other.
  // ---------------------------------------------------------------------
  describe('DP-1 — existing REST routes accept mobile tokens without breaking X-API-Key', () => {
    it('a mobile access token authenticates GET /api/role (previously API-key/session-only)', () => {
      login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((loginRes) => {
        const pair = loginRes.body as TokenPair;
        cy.request({ url: '/api/role', headers: bearer(pair.access_token) }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.rows).to.be.an('array');
        });
      });
    });

    it('X-API-Key auth still works unchanged on the same route (regression check)', () => {
      cy.request({ url: '/api/role', headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.rows).to.be.an('array');
      });
    });
  });
});
