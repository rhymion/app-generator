# Reservation Pattern

## Purpose

The reservation pattern covers workflows where the user requests capacity but
does not select the exact inventory row or physical item. The generated app must
choose the allocation target from:

1. user criteria, such as date range, room type, product, quantity, location, or
   lot constraints;
2. internal policy, such as first-expiring-first-out, lowest cost, room priority,
   or deterministic ID order.

The allocation, inventory decrement or status change, and reservation record
creation must happen in one database transaction.

This pattern is intended for:

- hotel room reservation: guest chooses room type and stay period; the app
  allocates an available room;
- purchase order: buyer chooses product and quantity; the app allocates stock
  and decreases available inventory.

It is not the same as a normal many-to-one field where the user chooses the
target record directly.

## Current Gap

### Booking

Current schema:

- `code_generator/json_schema.yaml:937` defines `booking`.
- `code_generator/json_schema.yaml:967` defines `resource_id`.
- `code_generator/json_schema.yaml:970` marks it as a many-to-one relationship
  to `resource`.
- `code_generator/json_schema.yaml:981` defines `booking_detail`.
- `code_generator/json_schema.yaml:994` requires the resolved `resource`.

Current Prisma model:

- `prisma/schema.prisma:384` defines `model booking`.
- `prisma/schema.prisma:387` stores `resource_id`.
- `prisma/schema.prisma:388` relates it directly to `resource`.
- `prisma/schema.prisma:389` and `390` store `start_time` and `end_time`.

Current validation:

- `lib/booking/service_validation.ts:7` checks overlap for a supplied
  `resourceId`.
- `lib/booking/service_validation.ts:53` receives `resource_id`, `start_time`,
  and `end_time`.
- `lib/booking/service_validation.ts:63` checks overlap against the supplied
  `resource_id`.

Gap:

The current booking model is a direct resource booking. The user or form data
supplies `resource_id`. The app only validates that this exact resource does not
overlap. It does not search an inventory pool, rank candidates, lock candidates,
or allocate a resource automatically from user criteria such as room type and
date range.

### Purchase order

Current schema:

- `code_generator/json_schema.yaml:1197` defines `inventory` with `quantity`
  and `reserved_quantity`.
- `code_generator/json_schema.yaml:1263` defines `purchase_order`.
- `code_generator/json_schema.yaml:1291` defines `purchase_per_item`.
- `code_generator/json_schema.yaml:1309` relates each purchase item to a
  `product`.
- `code_generator/json_schema.yaml:1316` stores requested line quantity.
- `code_generator/json_schema.yaml:1344` puts `items` under
  `purchase_order_detail`.

Current Prisma model:

- `prisma/schema.prisma:455` defines `model inventory`.
- `prisma/schema.prisma:459` stores `quantity`.
- `prisma/schema.prisma:460` stores `reserved_quantity`.
- `prisma/schema.prisma:474` defines `model purchase_order`.
- `prisma/schema.prisma:479` stores nested purchase items.
- `prisma/schema.prisma:490` defines `model purchase_per_item`.
- `prisma/schema.prisma:494` relates each item to `product`.
- `prisma/schema.prisma:496` stores requested quantity.

Gap:

Purchase order lines are product and quantity records. They are not connected to
`inventory`, and normal generated CRUD does not decrement `inventory.quantity`,
increment `inventory.reserved_quantity`, create allocation rows, or fail the
same transaction when stock is insufficient.

### Existing generator transaction surface

The generated service template already wraps creates and updates in Prisma
transactions:

- `code_generator/templates/service.ts.jinja2:4` starts a transaction for create.
- `code_generator/templates/service.ts.jinja2:5` calls `validateOnAdd`.
- `code_generator/templates/service.ts.jinja2:11` creates the parent row.
- `code_generator/templates/service.ts.jinja2:62` starts a transaction for update.
- `code_generator/templates/service.ts.jinja2:63` checks stale snapshots.
- `code_generator/templates/service.ts.jinja2:66` calls `validateOnUpdate`.

This is the right insertion point, but the current service template has no
reservation-specific allocation phase.

## Schema Extension Shape

Use an entity-level extension on the command entity:

```yaml
x-reservation:
  mode: count | item
  pool:
    entity: inventory
    quantityField: quantity
    reservedField: reserved_quantity
  request:
    quantityField: quantity
    criteria:
      product_id: product_id
  policy:
    orderBy:
      - expiration_date: asc_nulls_last
      - lot_number: asc
      - id: asc
  result:
    allocatedRelation: allocations
```

Why entity-level:

- reservation behavior belongs to the workflow command, such as
  `room_reservation` or `purchase_order`;
- it can read fields from that entity and its child lines;
- existing schemas remain unchanged when `x-reservation` is absent;
- the generator can route only the affected service template into allocation
  code.

Do not add reservation metadata to ordinary many-to-one fields. A field-level
extension cannot express multi-line purchase orders, split allocations, or
transaction policy cleanly.

## Conceptual Model

| Concept | Meaning |
|---|---|
| Request entity | The parent entity being created, such as `room_reservation` or `purchase_order`. |
| Request line | Optional child rows carrying product and quantity, such as `purchase_order_item`. |
| Pool entity | The available inventory source, such as `room_inventory`, `room`, or `inventory`. |
| User criteria | Filters derived from user input. |
| Internal policy | Deterministic allocation ordering chosen by the app/schema author. |
| Allocation record | Optional audit row linking request lines to inventory rows/items. |
| Count mode | Allocation decrements or reserves a quantity column. |
| Item mode | Allocation changes status on specific item rows. |

## YAML Syntax Proposal

### Top-level defaults

Optional app-level defaults may be added later:

```yaml
x-reservation-defaults:
  transaction:
    strategy: conditional_update
    isolation: read_committed
  failure:
    insufficientInventory: throw
```

Use this only for defaults. The actual reservation declaration should stay on
the request entity.

### Count mode

Count mode is for interchangeable capacity within an inventory row: product
stock, room type daily availability, seats, credits.

```yaml
x-reservation:
  mode: count
  transaction:
    strategy: conditional_update
  lines: items
  pool:
    entity: inventory
    quantityField: quantity
    reservedField: reserved_quantity
  request:
    quantityField: quantity
    criteria:
      product_id: product_id
      location: preferred_location
  policy:
    orderBy:
      - expiration_date: asc_nulls_last
      - lot_number: asc
      - id: asc
  result:
    allocationEntity: inventory_allocation
    parentField: purchase_order_id
    lineField: purchase_order_item_id
    poolField: inventory_id
    quantityField: quantity
```

### Mode x lines assumption matrix

The `lines` field changes only the allocation granularity. It does not change
the semantics of `criteria`, `policy`, or `transaction`.

| mode | lines | behavior |
|------|-------|----------|
| item | omitted | Canonical case. The request entity itself is the allocation unit. Implicit `quantity=1`. The resolved target is written to `result.allocatedField` on the request entity, for example `room_reservation.room_id`. |
| item | specified | Phase 2 only. The validator must reject this combination with a clear error such as `reserved for Phase 2`. |
| count | omitted | The request entity's own `quantityField` is the request quantity. The allocation record may omit `lineField` and store only `parentField`. |
| count | specified | Phase 1 case, such as `purchase_order + items`. `result.lineField` is required. |

### Item mode

Item mode is for specific rows whose status changes: hotel rooms, rental units,
serial-numbered inventory.

```yaml
x-reservation:
  mode: item
  transaction:
    strategy: row_lock
  pool:
    entity: room
    statusField: status
    availableStatus: available
    reservedStatus: reserved
  request:
    criteria:
      room_type_id: room_type_id
      dateRange:
        start: check_in
        end: check_out
  policy:
    orderBy:
      - floor: asc
      - room_no: asc
      - id: asc
  result:
    allocatedField: room_id
```

## Hotel Room Reservation Example

The user selects a room type and date range. The user does not select `room_id`.
The app allocates a room with no overlapping reservation.

```yaml
room_type:
  type: object
  required: [id, name, capacity]
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    name: { type: string, minLength: 1 }
    capacity: { type: integer, minimum: 1 }

room:
  type: object
  required: [id, room_no, room_type_id, status]
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    room_no: { type: string, minLength: 1 }
    room_type_id:
      type: string
      x-relationship:
        type: many-to-one
        target: room_type
        labelField: name
    floor: { type: integer }
    status:
      type: integer
      enum: [available, maintenance, reserved]

room_reservation:
  type: object
  required: [id, guest_name, room_type_id, check_in, check_out]
  x-reservation:
    mode: item
    transaction:
      strategy: row_lock
    pool:
      entity: room
      statusField: status
      availableStatus: available
      reservedStatus: reserved
    request:
      criteria:
        room_type_id: room_type_id
        dateRange:
          start: check_in
          end: check_out
    policy:
      orderBy:
        - floor: asc
        - room_no: asc
        - id: asc
    result:
      allocatedField: room_id
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    guest_name: { type: string, minLength: 1 }
    room_type_id:
      type: string
      x-relationship:
        type: many-to-one
        target: room_type
        labelField: name
    room_id:
      type: ["string", "null"]
      x-relationship:
        type: many-to-one
        target: room
        labelField: room_no
    check_in: { type: string, format: date }
    check_out: { type: string, format: date }
```

Generated behavior:

1. Build user criteria from `room_type_id`, `check_in`, and `check_out`.
2. Find candidate rooms with matching `room_type_id` and available status.
3. Exclude rooms with overlapping reservations.
4. Lock or claim the selected room in deterministic policy order.
5. Create `room_reservation` with generated `room_id`.
6. Roll back the transaction if no candidate can be claimed.

## Purchase Order Example

The user selects products and quantities. The user does not select inventory
lots. The app allocates stock according to FEFO/FIFO policy.

```yaml
inventory:
  type: object
  required: [id, product_id, quantity, reserved_quantity]
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    product_id:
      type: string
      x-relationship:
        type: many-to-one
        target: product
        labelField: name
    quantity: { type: integer, minimum: 0 }
    reserved_quantity: { type: integer, minimum: 0 }
    location: { type: ["string", "null"] }
    lot_number: { type: ["string", "null"] }
    expiration_date: { type: ["string", "null"], format: date }

purchase_order:
  type: object
  required: [id, order_no, customer_id]
  x-reservation:
    mode: count
    transaction:
      strategy: conditional_update
    lines: items
    pool:
      entity: inventory
      quantityField: quantity
      reservedField: reserved_quantity
    request:
      quantityField: quantity
      criteria:
        product_id: product_id
    policy:
      orderBy:
        - expiration_date: asc_nulls_last
        - lot_number: asc
        - id: asc
    result:
      allocationEntity: inventory_allocation
      parentField: purchase_order_id
      lineField: purchase_order_item_id
      poolField: inventory_id
      quantityField: quantity
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    order_no: { type: string, minLength: 1 }
    customer_id:
      type: string
      x-relationship:
        type: many-to-one
        target: user
        labelField: name

purchase_order_item:
  type: object
  required: [id, purchase_order_id, product_id, quantity]
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    purchase_order_id:
      type: string
      x-relationship:
        type: many-to-one
        target: purchase_order
        labelField: order_no
    product_id:
      type: string
      x-relationship:
        type: many-to-one
        target: product
        labelField: name
    quantity: { type: integer, minimum: 1 }

inventory_allocation:
  type: object
  required: [id, purchase_order_id, purchase_order_item_id, inventory_id, quantity]
  properties:
    id: { type: string, pattern: "^c[a-z0-9]{24,}$" }
    purchase_order_id:
      type: string
      x-relationship:
        type: many-to-one
        target: purchase_order
        labelField: order_no
    purchase_order_item_id:
      type: string
      x-relationship:
        type: many-to-one
        target: purchase_order_item
        labelField: id
    inventory_id:
      type: string
      x-relationship:
        type: many-to-one
        target: inventory
        labelField: lot_number
    quantity: { type: integer, minimum: 1 }
```

Generated behavior:

1. Create purchase order and child lines inside a transaction.
2. For each line, select inventory rows matching user criteria.
3. Apply internal order policy.
4. Claim quantities using conditional updates.
5. Create allocation rows for auditability.
6. If any line cannot be fully allocated, throw before commit so the order,
   line rows, inventory changes, and allocation rows are all rolled back.

## Generated Service Responsibilities

For create operations, generated reservation service code should run this order:

1. Parse normal form input and child line input.
2. Run ordinary `validateOnAdd`.
3. Start or continue the existing Prisma transaction.
4. Create the parent and child rows if the allocation result needs their IDs, or
   allocate first when only request fields are needed.
5. Resolve reservation criteria from YAML field mappings.
6. Apply internal policy order.
7. Claim inventory or item rows.
8. Write allocation output fields or allocation rows.
9. Run `afterCreate`.
10. Return the parent ID.

For update operations, the first implementation should be conservative:

- allow updates to non-reservation fields normally;
- reject edits to reservation criteria after allocation unless a later
  `reallocation` policy is explicitly added;
- support cancellation/release as a separate command pattern, not as a normal
  update side effect.

## YAML vs. Generated Convention Boundary

YAML should declare:

- which entity is a reservation command;
- count mode or item mode;
- pool entity;
- quantity/status fields;
- user criteria field mappings;
- internal order policy;
- allocation result fields or allocation entity;
- transaction strategy.

Generated code should own:

- Prisma transaction shape;
- failure error class/message keys;
- partial allocation loop mechanics;
- query construction from criteria mappings;
- stable deterministic tie-breaker requirement;
- use of wrapper components for any generated UI additions;
- tests for insufficient inventory and concurrent claims.

Custom code should own:

- non-standard pricing;
- external inventory services;
- overbooking rules;
- multi-warehouse balancing beyond declarative orderBy;
- release, cancellation, and backorder workflows until they become their own
  generator patterns.

## Transaction Strategy Comparison

### Option A: SELECT FOR UPDATE row locking

PostgreSQL row locks can lock candidate rows before deciding the allocation.
Prisma does not expose `SELECT FOR UPDATE` as a high-level API, so this requires
`$queryRaw` inside the transaction or a narrowly reviewed helper.

Pros:

- strong and easy to reason about for item rows;
- can lock the exact candidate before writing;
- good for room allocation and serialized claim order.

Cons:

- raw SQL is required;
- must be carefully parameterized;
- harder to keep database-agnostic;
- lock wait behavior needs timeout handling.

Best fit:

- item mode, especially hotel rooms or serialized assets.

### Option B: conditional UPDATE

Use a guarded update such as:

```ts
await tx.inventory.updateMany({
  where: {
    id: inventoryId,
    quantity: { gte: claimQuantity },
  },
  data: {
    quantity: { decrement: claimQuantity },
    reserved_quantity: { increment: claimQuantity },
  },
});
```

The claim succeeds only when the affected row count is 1. Otherwise the service
tries the next candidate or fails the transaction.

Pros:

- works with Prisma's high-level `updateMany`;
- avoids raw SQL for count mode;
- naturally prevents negative inventory;
- retry behavior is simple.

Cons:

- candidate selection and update are two steps;
- under contention, several retries may be needed;
- needs careful partial allocation rollback, handled by the transaction.

Best fit:

- count mode, especially purchase order stock allocation.

### Option C: optimistic lock version field

Add a `version` integer to the pool row. Read row plus version, then update only
where the version still matches.

Pros:

- explicit conflict detection;
- useful when many fields can be edited concurrently;
- common application pattern.

Cons:

- requires schema changes to all pool entities;
- still needs quantity guards;
- more complex than conditional update for simple stock decrement;
- less direct for item-mode row claiming.

Best fit:

- future enhancement when pool rows have rich concurrent editing beyond
  inventory decrement.

### Recommendation

Use two default strategies:

| Mode | Recommended strategy | Reason |
|---|---|---|
| count | conditional_update | High-level Prisma support, prevents negative stock, good fit for quantity claims. |
| item | row_lock | The app must select one exact row from a candidate set; row locking gives the clearest correctness model. |

Expose `transaction.strategy` in YAML but validate allowed combinations:

- `count` allows `conditional_update` and `optimistic_version`;
- `item` allows `row_lock` and, later, `conditional_status_update`;
- default is `conditional_update` for count and `row_lock` for item.

## Insufficient Inventory Failure

All insufficient inventory failures must happen inside the transaction.

Rules:

1. If a line cannot be fully allocated, throw `InsufficientInventoryError`.
2. The transaction rolls back parent create, child line create, allocation rows,
   and inventory changes.
3. The server action maps the error to a validation message.
4. API routes return a 409 conflict or 422 validation response, depending on the
   existing route error policy.
5. No partial order is committed by default.

Optional future policies:

- `allowPartial: true` for backorders;
- `backorderEntity`;
- `expiresAt` for temporary holds;
- release-on-timeout job.

These should not be part of the first implementation.

## Inventory Model Comparison

### Count column decrement

Example:

- `inventory.quantity`
- `inventory.reserved_quantity`

Pros:

- compact schema;
- fast for high-volume products;
- good for interchangeable stock;
- conditional update is enough for correctness.

Cons:

- cannot identify an exact physical item;
- split allocations need allocation rows for auditability;
- lot/expiration/location must be represented on inventory rows.

Use for:

- purchase order;
- room type daily capacity when individual room identity is irrelevant;
- generic product stock.

### Individual item row plus status

Example:

- one `room` row per room;
- one serialized inventory row per unit;
- `status` changes from `available` to `reserved`.

Pros:

- exact item is known after allocation;
- natural for hotels, rentals, serial-numbered goods;
- audit and operational workflows can point to the item.

Cons:

- more rows;
- requires stronger locking or guarded status updates;
- harder to allocate partial quantities.

Use for:

- hotel room reservation;
- equipment rental;
- serialized assets.

### Recommendation

Support both models, selected by `x-reservation.mode`.

- Hotel room reservation should use item mode.
- Purchase order should use count mode.
- Do not force one model across all use cases. The two domains have different
  operational needs.

## Backward Compatibility

The pattern must be opt-in.

Rules:

1. Schemas without `x-reservation` generate identical CRUD output.
2. Existing `booking` remains a direct resource booking until its schema is
   changed.
3. Existing `purchase_order` remains non-reserving until `x-reservation` is
   added.
4. Normal many-to-one, one-to-many, and many-to-many behavior stays unchanged.
5. Generated UI should hide allocation result fields from create forms when they
   are app-assigned, unless the schema explicitly marks them visible.
6. Existing custom extension points remain valid:
   `service_validation.ts`, `service_after_create.ts`, custom components, and
   generated wrapper components.

## Component Architecture Alignment

Reservation changes are primarily service-layer changes. If generated UI needs
new fields or summaries, generated templates must keep the approved component
architecture:

- import from `@/components/ui`;
- do not add new direct MUI imports in generated templates;
- do not add raw HTML layout tags in generated templates;
- add any new UI affordance as static `components/ui/**` wrappers, not generated
  files.

Possible UI additions:

- read-only allocated item summary on view/edit screens;
- insufficient inventory validation message;
- optional availability preview before submit.

These should be wrapper-driven and should not be part of the first service-only
implementation unless needed for acceptance.

## Proposed First Implementation Scope

Phase 1:

- add schema parser support for `x-reservation`;
- add validation tests proving absent extension is backward compatible;
- generate count-mode purchase order allocation with conditional updates;
- create allocation rows;
- add insufficient inventory tests;
- do not support reallocation on update.

Phase 2:

- add item-mode room allocation;
- implement row-lock helper or guarded status update;
- add overlap-aware room allocation tests;
- add read-only allocated item display.

Phase 3:

- cancellation and release pattern;
- optional partial allocation/backorder;
- availability preview UI;
- operational dashboards.

## Open Decisions

1. Adopt entity-level `x-reservation` as the schema syntax, with optional
   top-level defaults only.
2. Support both `count` and `item` inventory models.
3. Use conditional update as the default for count mode.
4. Use row locking or a guarded status update as the default for item mode.
5. Treat cancellation/release/backorder as later patterns, not first-scope CRUD
   updates.

## Decision Log

### x-receiving: Top-Level Singleton (Option A) — Lord's Ruling 2026-06-27

x-receiving stays top-level singleton (Option A, Lord's decision 2026-06-27).
No concrete multi-series receiving requirement exists; YAGNI applies.

**Asymmetry justification**: The asymmetry with x-reservation is intentional
and justified:

- x-reservation: entity-level because it models a single entity's behavior
  (count|item mode coexist)
- x-receiving: top-level because it spans PO/ASN/Receipt + inventory — no
  single owning entity

**Anti-pattern warning**: Do NOT mechanically symmetrize x-receiving to
entity-level — it is an anti-pattern. Item-mode entities (e.g. rooms, fixed
assets) do NOT need a corresponding x-receiving.

**Future path**: If multi-series receiving becomes a real requirement, the
correct extension is a top-level named map
(Option B: `x-receiving: {raw_materials: {...}, finished_goods: {...}}`),
NOT entity-level.

**Inventory pool consistency**: Count-mode reservations and receiving operate on
the same inventory pool (receiving = quantity increase; reservation =
reserved_quantity hold). Always reference the same pool entity consistently.
