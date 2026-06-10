"""
bridge_prisma.py — Prisma schema emission helpers for FK-on-parent bridge models.

Bridge model pattern (FK-on-parent direction):
  - bridge model (`<child>able`) has only `id` and back-relations (no parent FK cols)
  - each parent entity carries `<child>able_id String @unique`
  - child entity carries `<child>able_id String` (required FK to bridge)
  - onDelete: Cascade is on child → bridge so deleting bridge row cascades to child

These helpers are used by generate.py when a Prisma schema emission pass is added.
Tests can call them directly to verify emitted model structure.
"""

from helpers.naming import to_pascal_case


def emit_bridge_model(bridge_name: str, child_name: str, parent_names: list[str]) -> str:
    """Generate Prisma model definition for a bridge model (id + back-relations only).

    Example output for channelable:
        model channelable {
          id        String      @id @default(cuid())
          work      work?       @relation("WorkChannelable")
          character character?  @relation("CharacterChannelable")
          scene     scene?      @relation("SceneChannelable")
          channels  channel[]
        }
    """
    lines = [f'model {bridge_name} {{']
    lines.append(f'  id        String      @id @default(cuid())')
    bridge_pascal = to_pascal_case(bridge_name)
    for parent_name in parent_names:
        parent_pascal = to_pascal_case(parent_name)
        rel_label = f'{parent_pascal}{bridge_pascal}'
        lines.append(f'  {parent_name:<10}{parent_name}?{"":<4}@relation("{rel_label}")')
    child_plural = f'{child_name}s'
    lines.append(f'  {child_plural:<10}{child_name}[]')
    lines.append('}')
    return '\n'.join(lines)


def emit_parent_bridge_fk(bridge_name: str, parent_name: str) -> tuple[str, str]:
    """Return Prisma FK field lines to add to a parent entity.

    Returns (scalar_line, relation_line).

    Example for channelable + work:
        '  channelable_id String       @unique'
        '  channelable    channelable? @relation("WorkChannelable", fields: [channelable_id], references: [id])'
    """
    bridge_pascal = to_pascal_case(bridge_name)
    parent_pascal = to_pascal_case(parent_name)
    fk_col = f'{bridge_name}_id'
    rel_label = f'{parent_pascal}{bridge_pascal}'
    scalar = f'  {fk_col:<15}String       @unique'
    relation = (
        f'  {bridge_name:<15}{bridge_name}? '
        f'@relation("{rel_label}", fields: [{fk_col}], references: [id])'
    )
    return scalar, relation


def emit_child_bridge_fk(bridge_name: str) -> tuple[str, str]:
    """Return Prisma FK field lines to add to the child entity.

    Returns (scalar_line, relation_line).

    Example for channelable + channel:
        '  channelable_id String'
        '  channelable    channelable @relation(fields: [channelable_id], references: [id], onDelete: Cascade)'
    """
    fk_col = f'{bridge_name}_id'
    scalar = f'  {fk_col:<15}String'
    relation = (
        f'  {bridge_name:<15}{bridge_name} '
        f'@relation(fields: [{fk_col}], references: [id], onDelete: Cascade)'
    )
    return scalar, relation
