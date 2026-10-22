import { defineInlineCreateFlows } from './inline_create_flows';

// x-create-inline (Issue #846): the same flows at phone width (iPhone SE, below the md breakpoint).
describe('Create the referenced record in place (phone width)', () => {
  defineInlineCreateFlows({ width: 375, height: 667 });
});
