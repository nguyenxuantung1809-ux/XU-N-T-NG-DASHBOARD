# Market Data Visualizer

Desktop-first React app for pasting financial or market time-series data from Excel, validating it, and visualizing each dataset as a separate chart.

## Run

```bash
pnpm install
pnpm dev
```

In this Codex desktop environment, Node and pnpm may be provided by the bundled runtime rather than your PATH. The app is currently running at:

```text
http://127.0.0.1:5173/
```

## Build And Check

```bash
pnpm build
pnpm lint
```

## Main Features

- Data Input and Charts tabs.
- Dataset groups with collapse/expand, rename, delete, and dataset group assignment.
- Dataset management: add, rename, duplicate, delete, clear.
- Flexible columns with semantic roles: Date, Open, High, Low, Close, Value, Other.
- Spreadsheet-style cell editing and Excel TSV block paste.
- Add/delete columns and rows.
- Manual `dd/mm/yyyy` parsing, including `17/08/2026` as 17 August 2026.
- Validation for invalid dates, numeric fields, duplicate dates, missing values, and OHLC consistency.
- Sort by date, oldest-first or newest-first.
- One chart per dataset.
- Line charts for numeric columns.
- Candlestick charts when Open, High, Low, Close roles are present.
- Chart controls: type, display field, range selector, reset zoom, fullscreen, PNG download.
- Multi-dataset chart comparison with Overlay and Stacked layouts.
- Raw value or Normalize 100 scale for comparing different units.
- Synchronized time axis, zoom/pan, and crosshair across stacked price and RSI panels.
- Modular RSI indicator with configurable period.
- Drag and drop datasets inside or across groups while preserving rows and columns.
- Local persistence with IndexedDB through `idb-keyval`.
- CSV/XLSX import and CSV/JSON export.
- Master Excel download/upload with one sheet per dataset and upsert-by-date updates.
- Dataset Excel download/upload for updating one dataset without deleting history.
- Dark and light themes.

## Structure

```text
src/
  components/   Data grid and chart cards
  pages/        Data Input and Charts screens
  services/     IndexedDB workspace persistence
  types/        Dataset, column, chart, validation models
  utils/        Date parsing, numbers, paste parsing, dataset helpers, validation
```

## Stack

- React
- TypeScript
- Vite
- ECharts
- idb-keyval
- xlsx
- lucide-react
- Oxlint
