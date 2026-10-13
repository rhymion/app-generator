// Save-time check of a dashboard's widgets, with the same rules the widgets are drawn by (widget-problem.ts), so a
// misconfigured widget is rejected in the editor instead of failing when the dashboard is viewed. Free of generated
// imports: the catalog is passed in.
import { AppError, type MessageArgs } from '@/lib/_errors';
import {
  findWidgetProblems,
  describeProblem,
  type CatalogEntity,
  type WidgetInput,
  type WidgetProblem,
} from './widget-problem';

type LabelledCatalog = Array<CatalogEntity & { label?: string; groupable_fields: Array<CatalogEntity['groupable_fields'][number] & { label?: string }> }>;

// The message key renders in the form's language; names in it are the schema's display labels.
function messageArgs(catalog: LabelledCatalog, problem: WidgetProblem, widgetEntity: string, where: string): MessageArgs {
  const { entity = '', field = '', kind = '', value = '', mode = '' } = problem.params;
  const entityDef = catalog.find((e) => e.name === (entity || widgetEntity));
  const fieldLabel = entityDef?.groupable_fields.find((f) => f.name === field)?.label ?? field;
  return { where, entity: entity ? (entityDef?.label ?? entity) : '', field: fieldLabel, kind, value, mode };
}

type StoredWidget = WidgetInput & { id?: string };

const SETTINGS: Array<keyof WidgetInput> = [
  'entity_name', 'group_by_field', 'chart_type', 'stack_mode', 'series_field', 'group_by_bucket',
  'timezone', 'filter_field', 'filter_value',
];

const unchanged = (widget: StoredWidget, stored: StoredWidget | undefined) =>
  !!stored && SETTINGS.every((key) => (widget[key] ?? null) === (stored[key] ?? null));

/**
 * Throws a field-level validation error for the first widget that cannot be drawn.
 *
 * A widget saved earlier and left untouched is not re-judged (`stored` holds the dashboard's current widgets): a
 * dashboard whose data source was later removed stays editable, and only the widgets the user changes or adds are
 * held to the rules. With no data source in the schema there is nothing to judge against, so nothing is rejected.
 */
export function validateWidgets(catalog: LabelledCatalog, widgets: unknown, stored: StoredWidget[] = []): void {
  if (!Array.isArray(widgets) || catalog.length === 0) return;
  widgets.forEach((raw, index) => {
    const widget = (raw ?? {}) as StoredWidget & { name?: string | null };
    if (widget.id && unchanged(widget, stored.find((s) => s.id === widget.id))) return;
    const [problem] = findWidgetProblems(catalog, widget);
    if (!problem) return;
    // Language-neutral reference to the widget: its position and name.
    const where = `#${index + 1}${widget.name ? ` "${widget.name}"` : ''}: `;
    throw new AppError(
      'VALIDATION',
      `widgets[${index}]: ${describeProblem(problem)}`,
      'widgets',
      'invalid',
      `DashboardWidgetProblem.${problem.code}`,
      messageArgs(catalog, problem, widget.entity_name ?? '', where),
    );
  });
}
