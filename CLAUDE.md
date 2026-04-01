# Project Rules

## CI Gate — Required before finishing any task
Always run these steps before considering a task complete:

1. Stop application if it is already started
1. `pytest code_generator/tests`
1. `npm run docker:test:up`
1. `npm run demo:generate`
1. `npm run test`
1. `npm run dev:test`
1. `npx cypress run --browser chromium --spec cypress/e2e/api`

If any of these steps fails, try to fix the issues. Ask the user for instruction if the error is caused by problems outside the project (ex. network, hardware usage, etc.) or the provided instruction is not enough for direction for fix.  
It is fine to skip code generation by running `npm run db:reset:test` and `npm run db:generate` instead of `npm run demo:generate` when the fix is found for the web application but additional instruction is needed for the code generator. Report the inconsistency between the code generator and the web application code in this case.
E2E tests for web pages are excluded in the process above, because it will take too much time. But running tests for newly created or updated pages is recommended.

## Sanity Check — Required after every code change
Before stopping, review what you changed and ask yourself:
- Does this match the original requirement?
- Are there missing edge cases?
- Could this break anything else?
Report the result of this check explicitly.
