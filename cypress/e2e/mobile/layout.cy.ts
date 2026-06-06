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
      cy.get('.fixed.inset-0.z-40 [aria-hidden="true"]').click();
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
  });
});
