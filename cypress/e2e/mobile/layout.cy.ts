import { TEST_CREDENTIALS } from '../../support/test-credentials';

// App-shell behaviour at the Tailwind `md` (768px) breakpoint. Above `md` the
// desktop sidebar panel (`hidden md:flex`) is rendered inline and the
// hamburger button (`md:hidden`) is hidden; below `md` they swap, and the
// sidebar opens as a full-screen drawer controlled by SidebarContext.
//
// Selectors prefer aria/structural hooks over Tailwind class strings so the
// tests survive cosmetic theme changes:
//   - hamburger:    button[aria-controls="sidebar-nav"]
//   - drawer root:  div.fixed.inset-0.z-40  (only rendered when isOpen)
//   - backdrop:     the [aria-hidden="true"] child inside the drawer root
//   - desktop wrap: the `.hidden.md\\:flex` wrapper around the sidebar nav
const MOBILE = { width: 375, height: 667 };       // iPhone SE
const DESKTOP = { width: 1280, height: 720 };

describe('Mobile-responsive shell', () => {
  // Category 1: normal-flow — grant full permissions so CRUD pages (e.g. /role) are accessible.
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  describe('Mobile viewport (iPhone SE — 375x667)', () => {
    beforeEach(() => {
      cy.viewport(MOBILE.width, MOBILE.height);
      cy.visit('/en/');
    });

    it('renders the hamburger and hides the desktop sidebar panel', () => {
      cy.get('button[aria-controls="sidebar-nav"]').should('be.visible');
      cy.get('button[aria-controls="sidebar-nav"]')
        .should('have.attr', 'aria-expanded', 'false');
      cy.get('.hidden.md\\:flex nav#sidebar-nav').should('not.be.visible');
      // Drawer is only mounted while open
      cy.get('.fixed.inset-0.z-40').should('not.exist');
    });

    it('opens the drawer when the hamburger is tapped', () => {
      cy.get('button[aria-controls="sidebar-nav"]').click();
      cy.get('button[aria-controls="sidebar-nav"]')
        .should('have.attr', 'aria-expanded', 'true');
      cy.get('.fixed.inset-0.z-40').should('be.visible');
      cy.get('.fixed.inset-0.z-40').find('nav#sidebar-nav').should('be.visible');
    });

    it('toggles the drawer closed when the hamburger is tapped again', () => {
      cy.get('button[aria-controls="sidebar-nav"]').click();
      cy.get('.fixed.inset-0.z-40').should('exist');
      cy.get('button[aria-controls="sidebar-nav"]').click();
      cy.get('.fixed.inset-0.z-40').should('not.exist');
      cy.get('button[aria-controls="sidebar-nav"]')
        .should('have.attr', 'aria-expanded', 'false');
    });

    it('closes the drawer when the backdrop is tapped', () => {
      cy.get('button[aria-controls="sidebar-nav"]').click();
      // Target the backdrop div directly (direct child of the drawer root) to avoid
      // matching aria-hidden="true" elements inside the sidebar nav (e.g. the <hr>)
      cy.get('.fixed.inset-0.z-40 > div[aria-hidden="true"]').click();
      cy.get('.fixed.inset-0.z-40').should('not.exist');
    });

    it('auto-closes the drawer after navigating to another route', () => {
      cy.get('button[aria-controls="sidebar-nav"]').click();
      // Click a nav link inside the drawer — useEffect on usePathname() fires close()
      cy.get('.fixed.inset-0.z-40 nav#sidebar-nav')
        .find('a')
        .contains('Role')
        .click();
      cy.url().should('include', '/role');
      cy.get('.fixed.inset-0.z-40').should('not.exist');
    });

    it('header hides Setting and Sign Out on mobile to prevent overflow', () => {
      // Setting link and Sign Out button must be invisible in the header at mobile width
      // (they move to the sidebar drawer instead)
      cy.get('header').within(() => {
        cy.get('a[href*="/setting/view/"]').should('not.be.visible');
        cy.contains('button', 'Sign Out').should('not.be.visible');
      });
    });

    it('mobile sidebar drawer exposes Setting and Sign Out (previously unreachable)', () => {
      // Open the mobile drawer
      cy.get('button[aria-controls="sidebar-nav"]').click();
      cy.get('.fixed.inset-0.z-40 nav#sidebar-nav').should('be.visible');

      // Setting link is accessible inside the drawer. With a long nav list the
      // account section sits below the drawer's overflow-y-auto fold; be.visible
      // does NOT auto-scroll and Cypress treats an element clipped by a scroll
      // ancestor as hidden, so scroll it into the panel's viewport first.
      // (scrollIntoView walks up to the overflow-y-auto panel — the nav itself
      // is not the scroll container, so scrolling the nav would no-op.)
      cy.get('.fixed.inset-0.z-40 nav#sidebar-nav')
        .find('a[href*="/setting/view/"]')
        .scrollIntoView()
        .should('be.visible');

      // Sign Out button is accessible inside the drawer
      cy.get('.fixed.inset-0.z-40 nav#sidebar-nav')
        .find('button')
        .contains('Sign Out')
        .scrollIntoView()
        .should('be.visible');
    });

    it('mobile drawer Setting link navigates to the setting page', () => {
      cy.get('button[aria-controls="sidebar-nav"]').click();
      cy.get('.fixed.inset-0.z-40 nav#sidebar-nav')
        .find('a[href*="/setting/view/"]')
        .scrollIntoView()
        .click();
      cy.url().should('include', '/setting/view/');
    });
  });

  describe('Desktop viewport (1280x720)', () => {
    beforeEach(() => {
      cy.viewport(DESKTOP.width, DESKTOP.height);
      cy.visit('/en/');
    });

    it('shows the inline sidebar and hides the hamburger', () => {
      cy.get('.hidden.md\\:flex nav#sidebar-nav').should('be.visible');
      cy.get('button[aria-controls="sidebar-nav"]').should('not.be.visible');
      // Mobile drawer root is never rendered on desktop
      cy.get('.fixed.inset-0.z-40').should('not.exist');
    });

    it('desktop header still shows Setting link and Sign Out (unaffected)', () => {
      // Setting link is visible in the header at desktop width
      cy.get('header').find('a[href*="/setting/view/"]').should('be.visible');
      // Sign Out button is visible in the header at desktop width
      cy.get('header').contains('button', 'Sign Out').should('be.visible');
    });

    it('desktop sidebar does not show mobile-only account section', () => {
      // The md:hidden account section is present in the DOM but must not be visible
      // at desktop width — Tailwind md:hidden sets display:none at ≥768px
      cy.get('.hidden.md\\:flex nav#sidebar-nav').within(() => {
        cy.get('a[href*="/setting/view/"]').should('not.be.visible');
        cy.contains('button', 'Sign Out').should('not.be.visible');
      });
    });
  });
});
