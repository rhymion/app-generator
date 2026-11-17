// Hand-written -- not part of the generated entity test set.
// Leak canary crawl. The gate script runs the app behind code_generator/leak_canary.py's recording proxy
// after seeding a unique marker into every secret field. This spec only makes requests: it reads every
// GET route of the generated OpenAPI document (lists, then a few details of each, the export routes
// included) as the actor named below. The proxy reads every response; the gate fails afterwards when a
// marker appeared where it must not (this spec does not look at the bodies itself).
import { TEST_API_KEY } from '../../support/test-credentials';

const ACTOR = 'admin'; // a key of code_generator/leak_canary.yaml `actors`
const DETAIL_LIMIT = 3;
const SKIP_PREFIXES = ['/api/auth', '/api/test-utils', '/api/openapi.json'];

const headers = () => ({ 'X-API-Key': TEST_API_KEY, 'X-Leak-Canary-Actor': ACTOR });
const get = (url: string) => cy.request({ url, headers: headers(), failOnStatusCode: false, followRedirect: false });

describe('API: leak canary crawl', () => {
  let paths: string[] = [];

  before(() => {
    // Positive control: the proxy answers this with a known marker and records the detection apart; the gate
    // fails when it is missing, so a pass cannot come from a detector that sees nothing.
    cy.request({ url: '/__leak_canary_control', headers: headers() });
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task<string[]>('leakCanary:seed').then((seeded) => {
      expect(seeded.length, 'seeded canaries').to.be.greaterThan(5);
    });
    cy.request({ url: '/api/openapi.json', headers: headers() }).then((res) => {
      paths = Object.entries(res.body.paths as Record<string, Record<string, unknown>>)
        .filter(([path, ops]) => 'get' in ops && !SKIP_PREFIXES.some((p) => path.startsWith(p)))
        .map(([path]) => path);
      expect(paths.length, 'GET routes in the OpenAPI document').to.be.greaterThan(10);
    });
  });

  it('requests every GET route, and a few records of each list', () => {
    const plain = () => paths.filter((p) => !p.includes('{'));
    cy.wrap(null).then(() => {
      for (const path of plain()) {
        get(path).then((res) => {
          const items = Array.isArray(res.body) ? res.body : (res.body?.items ?? res.body?.data ?? []);
          if (!Array.isArray(items)) return;
          const detailPaths = paths.filter((p) => p.startsWith(`${path}/{`) && p.split('/').length === path.split('/').length + 1);
          for (const detail of detailPaths) {
            for (const item of items.slice(0, DETAIL_LIMIT)) {
              if (item?.id) get(detail.replace(/\{[^}]+\}/, String(item.id)));
            }
          }
        });
      }
    });
  });
});
