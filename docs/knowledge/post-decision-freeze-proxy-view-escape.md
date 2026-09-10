# Post-decision row freeze and the Proxy View escape

Implementing an entity-level row freeze (`derive_post_decision_freeze_values()`,
`docs/knowledge/appendix/approval-flow.md` section 16.18) surfaced a design question worth recording
independently of any one entity: what happens when a legitimate, business-level state transition
falls *outside* the approval mechanism entirely, on an entity whose row is otherwise frozen once
it reaches a decided (approved / terminally-rejected) state?

## The scenario

Some approvable entities carry an intermediate business state that a different role moves the
record through manually, after approval and unrelated to the approval workflow itself -- for
example, an assessor manually moving a claim-like record from under_assessment to
investigation. If that entity is a single, unsplit edit:true entity, and its own row is now
frozen by section 16.18 once it reaches a decided state, this manual transition would be blocked the same
way an ordinary user edit would be.

## Product ruling

The confirmed default posture is: use a dedicated Proxy View (a separate generated entity backed
by the same underlying Prisma model, per the "entity-scoped, not Prisma-model-scoped" lockdown
design already established in section 16.15) to carry this class of transition, so its edit path is
structurally outside the frozen entity's own guard. This is not mandatory -- remaining at the
frozen entity and simply accepting that the intermediate transition becomes unavailable once the
row is frozen is also an acceptable outcome when the underlying work can continue without that
transition (e.g. staying at under_assessment does not block the assessor's actual work).

## Decision framework

When an entity is edit:true and carries a business-level transition outside the approval
mechanism, and that entity's row can become frozen by section 16.18:

1. Split out a Proxy View for the transition, exactly as the existing Proxy View pattern
   already supports (a separate view entity sharing the underlying model, not itself declaring the
   approvable bridge relationship -- so section 16.15/16.18's guard, keyed per view rather than per
   model, does not apply to it). Structurally safe by construction; requires a new desk-style split
   design specific to the target entity.
2. Do nothing and accept that the frozen state makes the manual transition unreachable once the
   row is frozen. Acceptable when the transition is a convenience rather than a hard operational
   requirement.

Which of the two applies is an entity-by-entity, transition-by-transition judgment call -- the
freeze mechanism itself does not force option 1. Choosing option 1 for a specific entity is a
schema-changing design task in its own right (a new split, mirroring the existing header/desk
split pattern already used elsewhere in this generator), scoped and approved separately per
target consumer repo; it is not part of this generator change.

## Scope of this note

This file records the decision framework only. It does not itself apply option 1 or option 2 to
any specific entity in any specific consumer schema -- that remains a per-entity, per-consumer-repo
decision made separately, on explicit request, when and if it becomes relevant to a real entity.
