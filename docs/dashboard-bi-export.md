# Dashboard BI Export Guide

This document explains how to export dashboard widget data for use in external BI tools such as Power BI, Excel, and Tableau.

## In-App CSV Export

Every dashboard widget shows a **download button** (⬇) in the top-right corner of its card when data is available.

Clicking it downloads a `.csv` file containing the **same filtered and grouped data** currently displayed in the chart:

- **Single-series widgets** (no stack_mode / group_by_bucket without series_field): two columns — `label`, `count`.
- **Multi-series widgets** (stack_mode set, or line chart with series_field): first column is `category`, remaining columns are named after each series value.

The file uses **UTF-8 with BOM** so Excel opens it correctly without an import wizard.

## REST Aggregate Endpoint

The generator emits a REST endpoint at `POST /api/dashboard/aggregate` that returns the same filtered and grouped JSON used by the in-app charts.

### Authentication

All requests require an API key. Pass it in one of two ways:

```
X-API-Key: <your-api-key>
Authorization: Bearer <your-api-key>
```

API keys are managed in the app's Settings → Account page.

### Request Body

```json
{
  "entity_name": "booking",
  "group_by_field": "status",
  "filter": null,
  "conditions": [
    { "field": "status", "operator": "equals", "values": ["approved"] }
  ],
  "series_field": "resource_id",
  "group_by_bucket": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_name` | string | yes | Name of the dashboardable entity (e.g. `booking`) |
| `group_by_field` | string | yes | Field to group by |
| `filter` | `{ field, value }` or null | no | Legacy single-field filter (back-compat) |
| `conditions` | array | no | Typed multi-condition filter; takes precedence over `filter` |
| `series_field` | string | no | Second dimension for multi-series output |
| `group_by_bucket` | `day\|week\|month\|quarter\|year` or null | no | Timestamp bucketing; `group_by_field` must be a datetime field |

### Response

**Single-series** (no `series_field` and no `group_by_bucket` with `series_field`):

```json
{
  "kind": "single",
  "data": [
    { "label": "approved", "count": 42 },
    { "label": "pending", "count": 17 }
  ]
}
```

**Multi-series** (with `series_field` or `group_by_bucket` + `series_field`):

```json
{
  "kind": "multi",
  "categories": ["2024 Q1", "2024 Q2"],
  "series": [
    { "label": "Room A", "data": [12, 18] },
    { "label": "Room B", "data": [7, 9] }
  ]
}
```

### Authorization

The endpoint enforces the same permission model as the rest of the API. The API key must have **read** permission on the requested `entity_name`. Requests without a valid key return `401`; insufficient permissions return `403`.

---

## Power BI Integration — Get Data → Web

You can connect Power BI to the REST endpoint to create live-refreshing reports.

### Steps

1. Open Power BI Desktop → **Get Data** → **Web**.
2. Choose **Advanced** and enter the endpoint URL:
   ```
   https://<your-app-domain>/api/dashboard/aggregate
   ```
3. Add an **HTTP request header**:
   - Header: `X-API-Key`
   - Value: `<your-api-key>`
4. Set **HTTP method** to `POST`.
5. Set the **Request body** content type to `application/json` and paste your request body (see above).
6. Click **OK**. Power BI fetches the JSON and shows a preview.
7. Expand the `data` (single-series) or `series` (multi-series) list to build your table.
8. Click **Close & Apply** to load the data into the model.

### Refresh

Set up a **scheduled refresh** in the Power BI Service after publishing. The endpoint returns current data on every call, so refreshing daily or hourly is sufficient for most dashboards.

### Excel — Get Data → From Web

The same URL and headers work in Excel's **Data → Get Data → From Web (Advanced)** dialog. Select **JSON** as the format when prompted.

### Tableau

In Tableau, use **Web Data Connector** or **JSON file** connector pointed at the endpoint URL with the API key header. Alternatively, export a CSV from the in-app button and load it via **Text File** connector.
