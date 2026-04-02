# Project Rules

## CI Gate — Required before finishing any task

Always run these steps before considering a task complete:

1. Stop application if it is already started
2. `pytest code\_generator/tests`
3. `npm run docker:test:up`
4. `npm run demo:generate`
5. `npm run test`

If any of these steps fails, try to fix the issues. Ask the user for instruction if the error is caused by problems outside the project (ex. network, hardware usage, etc.) or the provided instruction is not enough for direction for fix.  
It is fine to skip code generation by running `npm run db:reset:test` and `npm run db:generate` instead of `npm run demo:generate` when the fix is found for the web application but additional instruction is needed for the code generator. Report the inconsistency between the code generator and the web application code in this case.
E2E tests are excluded in the process above, because Cypress in VS Code via Claude often fails due to environment differences.

## Sanity Check — Required after every code change

Before stopping, review what you changed and ask yourself:

* Does this match the original requirement?
* Are there missing edge cases?
* Could this break anything else?
Report the result of this check explicitly.

