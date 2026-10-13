# Dashboard Guide

How to put an entity on the dashboard, how users build chart widgets, and how to call the aggregate endpoint.
The schema keys are reference material in [schema-yaml-configuration.md](schema-yaml-configuration.md)
("Dashboard membership"); this guide is the how-to.

A dashboard is a named page of **widgets**. Each widget is one chart that counts the records of one entity, grouped by
one field. The dashboard and its widgets are the built-in `dashboard` and `dashboard_widget` entities; the pages live
under `/dashboard`.

## For schema authors

### Opt an entity in

```yaml
resource:
  x-display:
    dashboard: true
```

Only entities with `x-display.dashboard: true` can be a widget's data source. The flag is independent of
`x-display.table` and `x-display.chart`. If no entity opts in, the widget editor shows a notice with a link to the schema
documentation and every existing widget reports that there is no data source.

### Which fields can be grouped or filtered

The generator writes a catalog of the fields of each opted-in entity to `lib/dashboard/catalog.ts`
(`build_dashboard_catalog` in `code_generator/generators.py`). The same list serves **Group by**, **Series field** and
**Filter field**. A field is in the catalog when it is one of:

| Kind (shown in the editor) | Schema fields |
|---|---|
| reference | a `many-to-one` foreign key (values are labelled with the target's `labelField`; a non-string `labelField` falls back to `name`) |
| choice | an integer or string field with an `enum` (native enums and legacy integer enums) |
| yes/no | a `boolean` |
| number | an `integer` or `number` without `enum` |
| date/time | a string with `format: date` or `format: date-time` |

The catalog always adds four fields to every opted-in entity, because the generated models carry them:
`creator_id` (Creator) and `updater_id` (Updater), both references to `user`, and `created_at` and `updated_at`
(date/time). `id` is never offered. An opted-in entity therefore always has at least these four fields, and is never
left out of the catalog for lack of a groupable field.

Free text strings (without `enum` or a date format) and other column types are not in the catalog and cannot be used as a
widget setting.

### What the widget editor offers

`components/dashboard/widgets.tsx` replaces the generated child grid of `dashboard.widgets` (it is mounted with
`x-custom-component` on that array; see [code-generation-custom-extensions.md](code-generation-custom-extensions.md)).
Per widget it shows:

- **Name**
- **Data source**: a list of the opted-in entities the signed-in user may `read`, with their translated labels. The stored
  value is the entity key.
- **Chart type**: Pie, Column, Bar or Line.
- **Group by**: a list of the data source's catalog fields, each labelled with its kind. A line chart offers date/time
  fields only.
- **Time bucket**: offered only when Group by is a date/time field (Day, Week, Month, Quarter, Year).
- **Time zone**: the zone in which date-time bucket boundaries fall. Default UTC.
- **Series field**: offered for every chart type except Pie; any catalog field other than Group by.
- **Stack mode**: offered for Bar and Column once a Series field is chosen (Grouped, Stacked, Normalized).
- **Filter field** and **Filter value**: free-text inputs (see "Filters" below).

The editor corrects a row when a change makes a setting inapplicable (`components/dashboard/widget-rules.ts`): changing
the data source clears Group by, Series, Time bucket and Stack mode; a line chart gets a default time bucket; a Pie
chart drops its series and stack mode; a Series equal to Group by is cleared; a Bar or Column with a series and no
time bucket defaults to Grouped. A stored field the data source no longer offers stays visible and flagged until the user
changes it. Widgets can be reordered and removed.

### Problem messages

When a widget cannot be drawn, the page shows a message that names the setting, says why and says how to fix it
(namespace `DashboardWidgetProblem` in `messages/en.json` and `messages/ja.json`). One function,
`findWidgetProblems` in `lib/dashboard/widget-problem.ts`, produces them for the aggregate call, the dashboard save and
the editor.

| Code | Cause | Setting named |
|---|---|---|
| `noDataSources` | no entity has `x-display.dashboard: true` | none |
| `dataSourceUnavailable` | the entity is not (or no longer) opted in | Data source |
| `noPermission` | the viewer may not `read` the entity | Data source |
| `unknownField` | Group by, Series or Filter field is not in the data source's catalog (for example it was removed) | that field |
| `bucketNeedsDatetime` | Time bucket on a field that is not date/time | Time bucket |
| `lineNeedsBucket` | line chart without a Time bucket | Time bucket |
| `stackNeedsSeries` | Stack mode without a Series field | Stack mode |
| `timezoneNeedsDatetime` | a non-UTC Time zone on a field that is not a date-time (a date-only field is not a date-time) | Time zone |
| `invalidFilterValue` | the Filter value does not fit the filtered field | Filter value |
| `seriesSameAsGroup` | Series is the same field as Group by | Series field |

Two other widget states are not problems with a setting: a filter that matches no rows shows "No data matches this
chart.", and an unexpected failure shows "The chart could not be loaded. Reload the page; if it keeps failing, contact an
administrator."

Saving a dashboard runs the same rules (`lib/dashboard/service_validation_custom.ts`) and rejects a widget that cannot be
drawn with an error on the `widgets` field that names the widget by position and name. A widget that was saved earlier
and is left unchanged is not judged again, so a dashboard whose data source was removed can still be opened and edited.
`lib/dashboard/service_validation_custom.ts` is a tracked file in the generator, so it reaches an app with the
generator's submodule pointer. Only an app that supplies its own `prj/lib/dashboard/service_validation_custom.ts`, which
`scripts/prj_sync.py` copies over the generator's file, must contain
`validateWidgets(DASHBOARDABLE_ENTITIES, data.widgets, stored)` itself.

### Permissions and row scope

A widget counts only the records its viewer could list on the entity's own page, through both the page (Server Action)
and the REST endpoint:

- the viewer needs `read` on the data source;
- every query is limited by the entity's row-level read scope: organization isolation, `x-self-only` (with its audited
  `admin_bypass`), `x-filter-values`, and Creator/Assignee-only read;
- the labels of a reference field come from the **target** entity, through the target's read permission and scope; a label
  the viewer cannot read is shown as `(unknown)`.

An entity without a recorded scope entry in `lib/dashboard/access-scope.ts` is never readable through the dashboard.

## For end users

### Add a widget

1. Open the dashboard and choose to create or edit one.
2. Choose **Add widget**.
3. Enter a **Name** and pick the **Data source**: the kind of record you want to count.
4. Pick a **Chart type** and **Group by**: the field whose values become the bars, slices or points.
5. Optionally pick a **Series field**, **Time bucket**, **Time zone** and **Filter**.
6. Save. Any setting that cannot work is reported on the widget and rejects the save.

Each widget counts records; the chart shows how many records have each value.

### Settings and valid combinations

| Setting | Meaning | Applies when |
|---|---|---|
| Data source | which records are counted | always; only entities you may read are listed |
| Chart type | Pie, Column, Bar or Line | always |
| Group by | the field whose values form the categories | always; a line chart needs a date/time field |
| Time bucket | groups date/time values into Day, Week (Monday start), Month, Quarter or Year | Group by is date/time; required for Line |
| Time zone | the zone in which a Day, Week, Month, Quarter or Year starts | Group by is a date-time field (a date-only field always keeps its stored calendar date) |
| Series field | splits each category into one series per value | Column, Bar and Line; not Pie |
| Stack mode | Grouped, Stacked or Normalized (shares of the total) | Column and Bar with a Series field |
| Filter field and value | counts only records whose field equals the value | optional |

Records with no value in the grouped field appear under `(unspecified)`.

A series is drawn for a Column or Bar only when a Stack mode is set or a Time bucket is used. The editor sets Grouped when
you choose a series on a Column or Bar that has neither.

### Examples

- **Orders per month, split by status**: data source Order, chart type Column, Group by Created At, Time bucket Month,
  Series field Status, Stack mode Stacked.
- **Items per category**: data source Item, chart type Pie, Group by Category.
- **Open tickets by priority**: data source Ticket, chart type Bar, Group by Priority, Filter field Status, Filter value
  `open`.

(The entity and field names are placeholders; use the ones your app offers.)

### Filters

A widget has one filter: a Filter field and a Filter value. Only records where the field equals the value are counted.
The value is entered as text and must fit the field:

- number: a plain number such as `12` or `-3.5`;
- yes/no: `true` or `false`;
- date/time: a date or date-time that JavaScript can read, such as `2026-01-31`;
- choice: one of the choice's values (for a legacy integer choice, its position);
- reference: the id of the referenced record.

A value that does not fit is reported as "not a valid Filter value". Several conditions, comparisons and "in"/"contains"
matching are available through the REST `conditions` list (below), not through the widget editor.

### Export

A widget that shows data has an export button that downloads the displayed counts as a UTF-8 CSV file (with a byte-order
mark, which Excel reads). Only CSV is produced.

### When a chart is not shown

Read the message on the widget; the table under "Problem messages" lists each one. Typical fixes: choose another data
source or field that still exists, set a Time bucket for a line chart, set a Series field or clear Stack mode, clear a
Time bucket on a field that is not a date, or ask an administrator for read access to the data source.

## For integrators: `POST /api/dashboard/aggregate`

The route exists when at least one entity opts in. It is generated to `app/api/dashboard/aggregate/route.ts`.

**Authentication.** `authenticate()` from `lib/api-auth.ts`: an API key, or a mobile access token in
`Authorization: Bearer ...`. The caller needs `read` permission on `entity_name`, and the entity's row-level read scope is
applied as described above.

**Request body (JSON).**

| Field | Required | Meaning |
|---|---|---|
| `entity_name` | yes | an opted-in entity |
| `group_by_field` | yes | a catalog field of that entity |
| `series_field` | no | a second catalog field; yields a multi-series result |
| `group_by_bucket` | no | `day`, `week`, `month`, `quarter` or `year`; omit or `null` for no bucketing. Any other value, including integers, returns 400 naming the allowed values |
| `timezone` | no | a `Timezone` enum literal such as `asia_tokyo`; default `utc`. An unknown value returns 400, as does a non-UTC zone on a field that is not a date-time |
| `filter` | no | `{ "field": "...", "value": "..." }`, an exact match |
| `conditions` | no | a list of `{ "field", "operator", "values": [...] }`, combined with AND; takes precedence over `filter` |

`conditions[].operator` is one of: `equals`, `in`, `contains`, `not` (choice or text); `eq`, `neq`, `gt`, `gte`, `lt`,
`lte`, `between` (number); `before`, `after`, `onOrBefore`, `onOrAfter` (date/time); `is` (yes/no). `between` uses the first
two values, `in` all of them, the rest the first. The field of every condition must be in the catalog.

**Response (200).** One of

```json
{ "kind": "single", "data": [{ "label": "open", "count": 12 }], "timezone": "asia_tokyo" }
{ "kind": "multi", "categories": ["2026-01", "2026-02"], "series": [{ "label": "open", "data": [3, 5] }], "timezone": "asia_tokyo" }
```

`timezone` is present only when the buckets were computed in a zone other than UTC. Bucket labels are `YYYY-MM-DD`
(day, and the Monday of a week), `YYYY-MM`, `YYYY Qn` and `YYYY`.

**Errors.** A request the data source cannot answer returns HTTP 400 with `{ "error", "code", "setting", "params" }`,
where `code` is one of the codes in "Problem messages" and `error` is an English sentence. A missing `entity_name` or
`group_by_field` returns 400 `entity_name and group_by_field are required`. Missing `read` permission returns 403.

**Limits.** The route has no row cap and no paging. A bucketed request reads the grouping field (and series field) of
every record the caller may read and groups them in the application; an unbucketed request groups in the database.
