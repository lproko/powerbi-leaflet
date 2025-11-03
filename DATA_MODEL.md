## Power BI Data Model – Pests Solution

### Purpose
This document describes the data model used to integrate multi‑pest datasets (Host, Master, Observation) into a single Power BI model, including relationships, maintenance steps, and how the Masters_Contents table is built for the Contents visual.

### Source Inputs (per pest)
- **Files provided per pest**:
  - **Host**: host entities and attributes
  - **Master**: reference/master records (central entity) – includes `RefID`
  - **Observation**: measurements/observations tied to master and/or host
- **Schema**: The structure of each file is standardized and was agreed with the client.

### Mandatory Manual Column (per file)
- After importing each file into Power BI, add a column named, for example, `Pest` identifying the pest the file belongs to.
- Add this column in Power Query for every individual file (Host, Master, Observation) per pest.

### Consolidation (merging files across pests)
- For each entity type, append/merge all pest‑specific files into a single consolidated table:
  - `Hosts` = append of all Host files across pests
  - `Masters` = append of all Master files across pests
  - `Observations` = append of all Observation files across pests
- Ensure the appended queries preserve the manually added `Pest` column.

### Relationships
- All initial files (per pest) and the consolidated entity tables use `RefID` as the core key.
- Relationships in the model:
  - `Hosts[RefID]` → `Masters[RefID]` (many‑to‑one, to `Masters`)
  - `Observations[RefID]` → `Masters[RefID]` (many‑to‑one, to `Masters`)
  - `Masters[Pest]` → `PestTable[Pest]` (many‑to‑one, to `PestTable`)

### PestTable (single‑column lookup)
- A dedicated lookup table `PestTable` with a single column `Pest` listing all active pests.
- Maintenance is manual: update this table whenever adding or removing a pest to keep relationships and slicers in sync.

### Masters_Contents (for Contents visual)
- `Masters_Contents` represents “contents” derived from the `Masters` data.
- Creation process:
  1. For each pest’s Master table (or starting from consolidated `Masters`), unpivot the selected columns you want to expose in the Contents visual (e.g., content fields/attributes).
  2. Normalize the result to a tidy structure (e.g., `RefID`, `Pest`, `ContentName`, `ContentValue`).
  3. Append the unpivoted outputs across pests (if built per pest) into a single `Masters_Contents` table.
- Maintenance: when new content columns are introduced in Master, update the unpivot step(s) so they are included.

### Recommended Power Query Steps (high‑level)
1. Import each pest’s Host/Master/Observation files.
2. Add `Pest` column in each query (Host/Master/Observation) reflecting the pest name.
3. Standardize column names and data types (per agreed schema).
4. Create consolidated queries via Append for `Hosts`, `Masters`, `Observations`.
5. Build `Masters_Contents` via unpivot of selected Master columns; append across pests if created separately.
6. Create/maintain `PestTable` with unique list of pests (manual updates as pests change).

### Model Notes & Governance
- `RefID` is the relationship backbone; ensure uniqueness in `Masters` and consistent population in `Hosts` and `Observations`.
- The manually maintained `PestTable` must always reflect the set of pests present in the data; update it before refreshes that introduce/removes pests.
- When adding new content attributes to Master, update unpivot logic so `Masters_Contents` remains complete.
- Keep data types consistent across appended queries (especially for `RefID`, date/time, numeric measures).

### Change Checklist
- Adding a new pest:
  - Import new pest’s Host/Master/Observation files
  - Add `Pest` column to each
  - Append to `Hosts`, `Masters`, `Observations`
  - Update `PestTable` to include the new pest
  - If there are new Master content columns, update `Masters_Contents` unpivot
- Removing a pest:
  - Remove from source queries/append steps
  - Update `PestTable` to remove the pest
  - Review `Masters_Contents` unpivot coverage if columns are affected


