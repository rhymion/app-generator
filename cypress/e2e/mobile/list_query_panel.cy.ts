import { describeListQueryPanel } from '../../support/list_query_panel_spec';

// A phone-sized viewport (iPhone SE): the role list is drawn as cards, with the same panel above them.
describeListQueryPanel('mobile viewport', { width: 375, height: 667 }, 'cards');
