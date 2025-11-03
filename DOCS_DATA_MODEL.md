## Power BI Leaflet Visual – Data Model and Update Flow

### Overview

This visual’s data/update pipeline has three layers:

- Input: Power BI passes `VisualUpdateOptions` containing `DataView` and object settings.
- Processing: We parse settings, build selection IDs, transform table rows into markers, and compute choropleth inputs.
- Rendering/interaction: We render markers (clustered), manage selections/filters, and keep DOM styles in sync with the selection state.

This document describes the functions that orchestrate the data model and update process in `src/visual.ts`.

### Entry point: update(options: VisualUpdateOptions)

Purpose: Main lifecycle method Power BI calls on data, filter, or size changes.

Responsibilities:

- Validates `options.dataViews`; clears all data if none.
- Updates visual’s settings via `updateSettingsFromPowerBI`.
- Applies base map URL changes via `handleBaseMapUrlChange`.
- Captures the `currentDataView` for downstream checks.
- Chooses data processing path:
  - Uses `processTableData(dataView)` when table data is present.
- Calls `updateMarkersVisibility(this.currentSelection)` to sync visuals with current selection/filter state.
- Calls `performEmptyStateCheck()` to manage empty-state UX.

Typical call sequence:

- update → updateSettingsFromPowerBI → handleBaseMapUrlChange → processTableData → updateMarkersVisibility → performEmptyStateCheck

### Settings and base map

updateSettingsFromPowerBI(options)

- Reads `mapSettings` object from `dataView.metadata.objects`.
- Updates internal settings model and triggers:
  - `handleBaseMapUrlChange()` if base map URL changed.
  - `handleDisputedBordersUrlChange()` if disputed borders URL changed.

handleBaseMapUrlChange()

- Debounces base map URL changes by comparing to `lastBaseMapUrl`.
- Clears the base layer and calls `loadBaseMap()`.

loadBaseMap()

- If base map URL provided: hides empty-state, calls `loadMapDataFromUrl(url)` and, when ready, ensures marker cluster is added to the map (if markers exist).
- If missing: removes marker cluster from map and shows setup message.

loadMapDataFromUrl(url: string)

- Fetches GeoJSON, validates structure, and loads into `baseMapLayer`.
- Caches `geoJsonFeatures` for GAUL lookups.
- Triggers `handleDisputedBordersUrlChange()` and `forceChoroplethUpdate()` when data becomes available.
- Manages loader UX and error messaging.

handleDisputedBordersUrlChange()

- Loads or clears the disputed borders layer based on settings; runs only after base map loaded.

### Data model: building selection context and markers

processTableData(dataView: DataView)

- Clears admin-code cache.
- Creates selection IDs for all rows with `createSelectionIds`.
- Transforms table rows into markers with `processMarkerData`.
- Calls `forceChoroplethUpdate()` to update polygons once input data + GeoJSON are ready.

createSelectionIds(dataView: DataView)

- Builds `this.selectionIds` by using `host.createSelectionIdBuilder().withTable(...)`.
- One selection ID per table row, preserving a stable identity for selection/filter operations.

processMarkerData(dataView: DataView)

- Determines RefID filtering string (if provided as a measure).
- For each row:
  - Extracts lat/lng/admin/obsId/country via `getLatLngAdminForRow`.
  - Creates a Leaflet marker and stores:
    - `options.selectionId` on the marker
    - `locationInfo` with parsed fields
    - `refId` if present
  - Applies initial opacity based on RefID measure filtering.
  - Attaches click handler to show tooltip and to select/deselect via SelectionManager with robust deselect logic for clusters.
- Adds markers to `markerClusterGroup` and ensures the cluster group is added to the map if base map URL exists.

getLatLngAdminForRow(row, columns)

- Resolves lat/lng/admin from explicit roles (`latitude`, `longitude`, `adminCode`) when present.
- Fallback: parses a combined `location` role using `parseLocationField`.
- Also returns `obsId`, `country`, `refId` when found inline in `location`.

parseLocationField(value)

- Robust parser for location strings:
  - JSON format support with common key aliases.
  - CSV-style formats with multiple schemas (e.g., refId,lat,lng,admin,obsId,country).
  - Labeled patterns like “lat:.., lon:.., admin:..”.
  - Numeric fallback for coordinates.
  - Admin-only fallback.
- Produces a normalized object: `latitude`, `longitude`, `adminCode`, `obsId`, `country`, `refId` (where available).

### Selection and cross-filtering

applyClusterFilteringWithInfo(markers, markerInfo)

- When a cluster is clicked, this function applies Power BI filtering to include all markers within that cluster:
  - Builds the selection ID list from the cluster’s markers.
  - If all are already selected, clears selection (toggle off).
  - Otherwise:
    - Clears SelectionManager
    - Updates `currentSelection` and `persistentSelection`
    - Calls `selectionManager.select(firstId)` then chains `select(id, true)` for remaining IDs to accumulate multi-selects.
    - Calls `updateMarkersVisibility` before and after selection chain to guarantee UI sync.

handleClusterClick(e)

- At max zoom: retrieves child markers, collects info for tooltips, stores the cluster’s marker set for later deselection logic, and calls `applyClusterFilteringWithInfo`.
- Triggers spiderfy (and does not block it) so DOM for markers can materialize.
- Schedules post-animation checks to re-apply opacity to selected markers.

clearSelectionAndCluster()

- Resets `currentSelection`, `persistentSelection`, and clears last selected cluster tracking.
- Calls `updateMarkersVisibility([])` to reflect cleared state.

shouldDeselectCluster(marker)

- Returns true if the clicked marker belongs to the last selected cluster and all markers in that cluster are currently selected.

clearSelection()

- Clears SelectionManager and resets internal selection state.
- Calls `showOnlyCurrentContextMarkers()` to reflect current Power BI filters without manual selections.

### Visibility and styling

updateMarkersVisibility(selectedIds: ISelectionId[])

- Core renderer for the marker layer given current Power BI filtered rows + manual selections.
- For each marker:
  - Determines if it’s in Power BI filtered rows (`isMarkerInFilteredData`) and/or explicitly selected (key-based match).
  - Visible if:
    - No manual selections: must be in filtered data; or
    - With manual selections: visible if in filtered data or selected
  - Applies per-marker opacity:
    - Selected: forced to 1 via `setMarkerOpacityTo1`
    - Non-selected (with selection active): dimmed (0.15 or 0.5 depending on RefID filtering state)
    - No selection: 1 if RefID passes, else 0.3
  - If marker DOM element not yet available (still clustered), stores state and attaches a one-time listener to set opacity once added.
- Calls `updateClusterOpacity(selectedIds)` afterward.
- Calls `performEmptyStateCheck()`.

setMarkerOpacityTo1(element, markerIndex)

- Sets inline `opacity: 1 !important` and monitors the element for up to 10 seconds to re-apply if animations override it.

applyOpacityToSelectedMarkers(retryCount = 0)

- Retry helper called after spiderfy or animations to ensure selected markers get opacity 1 when their DOM elements finally exist.

updateClusterOpacity(selectedIds: ISelectionId[])

- Sets cluster icon opacity to 1 if it contains any selected markers; otherwise 0.5.
- Performs checks twice (with small timeouts) to account for animation and DOM timing.

isMarkerInFilteredData(markerSelectionId)

- Determines if a marker is part of the current filtered data by matching its selection ID against selection IDs of rows present in `currentDataView.table.rows`.

### Choropleth update flow

getAdminCodesFromData()

- Extracts and caches the list of admin codes (GAUL) from the current data view for choropleth.

updateChoroplethLayer()

- Clears existing choropleth, matches `geoJsonFeatures` by GAUL, renders only the matching polygons, and adds to the map if any exist. Manages loader visibility.

forceChoroplethUpdate()

- Ensures `updateChoroplethLayer()` runs only when all prerequisites are ready: base map loaded, features cached, and data rows available.

### Empty state and UX helpers

performEmptyStateCheck()

- Decides which message to show:
  - If no base map URL: show setup or “almost ready” messages depending on data
  - If base map URL present but no visible markers: show “No distribution information available”
  - Otherwise hides the empty state

showOnlyCurrentContextMarkers()

- Resets markers to reflect current Power BI-filtered context (no manual selections).

### Typical lifecycle scenarios

Initial load:

- update → updateSettingsFromPowerBI → handleBaseMapUrlChange → loadBaseMap → loadMapDataFromUrl → forceChoroplethUpdate
- processTableData → createSelectionIds → processMarkerData → updateMarkersVisibility → performEmptyStateCheck

User clicks a cluster at max zoom:

- handleClusterClick → collectClusterMarkerInfo → applyClusterFilteringWithInfo → updateMarkersVisibility → updateClusterOpacity
- Spiderfy runs → applyOpacityToSelectedMarkers to ensure selected markers are fully opaque

User clears selection:

- clearSelection → currentSelection cleared → showOnlyCurrentContextMarkers → updateMarkersVisibility → updateClusterOpacity

### Key data contracts

Selection IDs

- Generated once per row and stored on markers. Comparisons use key-based matching via `getSelectionIdKey` for consistency.

Location parsing

- Flexible to handle multiple real-world data encodings; centralized in `parseLocationField` and `getLatLngAdminForRow`.

Visibility logic

- Honors Power BI’s filter context and user’s manual selection simultaneously.

Styling

- Enforced via inline styles with `!important` and monitored to resist animation overrides.
