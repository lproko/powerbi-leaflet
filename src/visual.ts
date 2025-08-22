import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import powerbiVisualsApi from "powerbi-visuals-api";
import IVisual = powerbiVisualsApi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbiVisualsApi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbiVisualsApi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbiVisualsApi.DataView;
import ISelectionManager = powerbiVisualsApi.extensibility.ISelectionManager;
import ISelectionId = powerbiVisualsApi.visuals.ISelectionId;
import markerIcon from "leaflet/dist/images/marker-icon.png";
import { disputedBorders } from "./disputed-borders";

interface ChoroplethFeature {
  type: string;
  properties: {
    admin_boundary?: string;
    admin_level?: number;
    choropleth_value?: number;
    name?: string;
    gaul_code?: number;
    gaul0_code?: number;
    gaul0_name?: string;
    iso3_code?: string;
    continent?: string;
    disp_en?: string;
    adminCode?: number | string;
    countryName?: string;
    isoCode?: string;
  };
  geometry: any;
}

interface PowerBIChoroplethData {
  adminCode: number | string;
  geometry: any;
  choroplethValue: number;
  countryName: string;
  isoCode: string;
  continent: string;
  tooltipData: Map<string, any>;
}

export class Visual implements IVisual {
  private target: HTMLElement;
  private map: L.Map;
  private selectionManager: ISelectionManager;
  private host: powerbiVisualsApi.extensibility.visual.IVisualHost;
  private markers: L.Marker[] = [];
  private selectionIds: ISelectionId[] = [];
  private choroplethLayer: L.GeoJSON;
  private disputedBordersLayer: L.GeoJSON;
  private colorScale: (value: number) => string;
  private choroplethSettings: {
    showChoropleth: boolean;
    colorScheme: string;
  };
  private tooltipDiv: HTMLElement;
  private emptyStateDiv: HTMLElement;
  private currentSelection: ISelectionId[] = [];
  private persistentSelection: ISelectionId[] = [];
  private powerBIChoroplethData: PowerBIChoroplethData[] = [];

  constructor(options: VisualConstructorOptions) {
    this.target = options.element;
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager();

    // Initialize choropleth settings
    this.choroplethSettings = {
      showChoropleth: true,
      colorScheme: "Viridis",
    };

    // Initialize color scale
    this.colorScale = this.createColorScale();

    const mapElement = document.createElement("div");
    mapElement.id = "map";
    mapElement.style.height = "100%";
    this.target.appendChild(mapElement);

    // Create custom tooltip div
    this.tooltipDiv = document.createElement("div");
    this.tooltipDiv.className = "custom-tooltip";
    this.tooltipDiv.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #22294B;
      border-radius: 4px;
      padding: 15px 10px 15px 10px;
      font-size: 12px;
      font-family: Arial, sans-serif;
      color: #2D2D2D;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 1000;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 0.2s ease;
      width: 170px;
      word-wrap: break-word;
      display: flex;
      flex-direction: column;
      gap: 0;
      line-height: 1.4;
      top: 10px;
      left: 10px;
    `;
    this.target.appendChild(this.tooltipDiv);

    // Create empty state div
    this.emptyStateDiv = document.createElement("div");
    this.emptyStateDiv.className = "empty-state";
    this.emptyStateDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 1px solid #22294B;
      border-radius: 4px;
      padding: 10px 16px;
      font-family: Arial, sans-serif;
      font-size: 10px;
      font-weight: 700;
      color: #2D2D2D;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 999;
      text-align: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
      max-width: 300px;
    `;
    this.emptyStateDiv.innerHTML = `No distribution information available`;
    this.target.appendChild(this.emptyStateDiv);

    this.map = L.map(mapElement, {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
    }).setView([20, 0], 10);

    // Add zoom control to top right
    L.control
      .zoom({
        position: "topright",
      })
      .addTo(this.map);

    // Add map click handler to clear selections when clicking on empty areas
    this.map.on("click", (event) => {
      if (
        event.originalEvent &&
        event.originalEvent.target === this.map.getContainer()
      ) {
        console.log("Map clicked - clearing selections");
        this.showOnlyCurrentContextMarkers();
      }
    });

    // Basemap removed - using only GeoJSON data as background

    // Initialize choropleth layer
    this.choroplethLayer = L.geoJSON(null, {
      style: (feature) => this.getChoroplethStyle(feature),
      onEachFeature: (feature, layer) =>
        this.onEachChoroplethFeature(feature, layer),
    });

    // Initialize disputed borders layer
    this.disputedBordersLayer = L.geoJSON(null, {
      style: (feature) => this.getDisputedBorderStyle(feature),
      onEachFeature: (feature, layer) =>
        this.onEachDisputedBorderFeature(feature, layer),
    });

    // Hide Leaflet attribution and any flags
    const style = document.createElement("style");
    style.textContent = `
      .leaflet-attribution-flag {
        display: none !important;
      }
      
      .tooltip-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid #22294B;
        font-family: Arial, sans-serif;
        font-size: 12px;
      }
      
      .tooltip-row:last-child {
        border-bottom: none;
      }
      
      .field-name {
        font-weight: normal;
        color: #2D2D2D;
        font-family: Arial, sans-serif;
        font-size: 12px;
      }
      
      .field-value {
        font-weight: bold;
        color: #2D2D2D;
        text-align: right;
        font-family: Arial, sans-serif;
        font-size: 12px;
      }
      
      /* Zoom control spacing and styling */
      .leaflet-control-zoom {
        border: none !important;
        box-shadow: none !important;
      }
      
      .leaflet-control-zoom a {
        margin-bottom: 6px !important;
        background-color: white !important;
        border: 1px solid #F2F2F2 !important;
        border-radius: 8px !important;
      }
      
      .leaflet-control-zoom a:last-child {
        margin-bottom: 0 !important;
      }
      
      .leaflet-control-zoom a:hover {
        background-color: #E8E9EA !important;
      }
      
      /* Clean map background styling */
      .leaflet-container {
        background: white !important;
      }
      
      .leaflet-pane {
        background: transparent !important;
      }
    `;
    document.head.appendChild(style);

    // Load disputed borders
    this.loadDisputedBorders();
  }

  private createColorScale(): (value: number) => string {
    const colorSchemes = {
      YlOrRd: [
        "#ffffb2",
        "#fed976",
        "#feb24c",
        "#fd8d3c",
        "#fc4e2a",
        "#e31a1c",
        "#b10026",
      ],
      Blues: [
        "#f7fbff",
        "#deebf7",
        "#c6dbef",
        "#9ecae1",
        "#6baed6",
        "#3182bd",
        "#08519c",
      ],
      Greens: [
        "#f7fcf5",
        "#e5f5e0",
        "#c7e9c0",
        "#a1d99b",
        "#74c476",
        "#41ab5d",
        "#238b45",
      ],
      Reds: [
        "#fff5f0",
        "#fee0d2",
        "#fcbba1",
        "#fc9272",
        "#fb6a4a",
        "#ef3b2c",
        "#cb181d",
      ],
      Viridis: [
        "#440154",
        "#482878",
        "#3e4989",
        "#31688e",
        "#26828e",
        "#1f9e89",
        "#35b779",
        "#6ece58",
        "#b5de2b",
        "#fde725",
      ],
    };

    const colors =
      colorSchemes[
        this.choroplethSettings.colorScheme as keyof typeof colorSchemes
      ] || colorSchemes.Viridis;

    return (value: number): string => {
      if (value === null || value === undefined || isNaN(value)) {
        return colors[0];
      }

      const clampedValue = Math.max(0, Math.min(1, value));
      const index = Math.min(
        Math.floor(clampedValue * (colors.length - 1)),
        colors.length - 1
      );

      return colors[index];
    };
  }

  private getChoroplethStyle(feature: any) {
    const choroplethValue = feature.properties?.choropleth_value;

    // Use #F2F2F2 for all choropleth features regardless of value
    return {
      fillColor: "#F2F2F2",
      weight: 0.2,
      opacity: 1,
      color: "black",
      fillOpacity: 0.8,
    };
  }

  private onEachChoroplethFeature(feature: any, layer: L.Layer) {
    if (feature.properties) {
      const name =
        feature.properties.name ||
        feature.properties.countryName ||
        "Unknown Region";
      const value = feature.properties.choropleth_value || "N/A";
      const countryCode =
        feature.properties.isoCode || feature.properties.iso3_code || "";
      const continent = feature.properties.continent || "";

      // Add click effects for choropleth features
      layer.on({
        click: (e) => {
          const layer = e.target;
          layer.setStyle({
            weight: 3,
            color: "#666",
            fillOpacity: 0.9,
          });
          layer.bringToFront();

          // Show tooltip on click
          const tooltipContent = this.buildChoroplethTooltipContent(feature);
          this.showTooltip(tooltipContent, e.latlng);

          // Reset style after 2 seconds
          setTimeout(() => {
            this.choroplethLayer.resetStyle(e.target);
          }, 2000);
        },
      });
    }
  }

  public update(options: VisualUpdateOptions) {
    try {
      const dataView: DataView = options.dataViews[0];

      // Reset data when no data
      if (
        !dataView ||
        !dataView.table ||
        !dataView.table.columns ||
        !dataView.table.rows
      ) {
        this.clearAllData();
        this.showEmptyState();
        return;
      }

      // Log helpful information about data import
      console.log("🌍 Power BI Leaflet Visual - Data Import Guide:");
      console.log(
        "   • For best results with complex geometries, use JSON import instead of CSV/Excel"
      );
      console.log("   • Power BI has a 32,766 character limit for text fields");
      console.log(
        "   • If you see truncation errors, consider using the choropleth-data.json file"
      );

      // Add comprehensive debugging for the update method
      console.log("🔍 UPDATE METHOD - Data structure received:", {
        hasDataView: !!dataView,
        hasTable: !!dataView.table,
        hasColumns: !!dataView.table.columns,
        hasRows: !!dataView.table.rows,
        totalRows: dataView.table.rows?.length || 0,
        totalColumns: dataView.table.columns?.length || 0,
        columnNames:
          dataView.table.columns?.map((col) => col.displayName) || [],
        columnRoles:
          dataView.table.columns?.map((col) => ({
            name: col.displayName,
            roles: col.roles,
          })) || [],
      });

      // Check if Power BI is filtering the data
      if (dataView.table.rows && dataView.table.rows.length > 0) {
        console.log("🔍 Data sample check - First row:", {
          rowIndex: 0,
          rowData: dataView.table.rows[0],
          rowKeys: Object.keys(dataView.table.rows[0] || {}),
          rowValues: Object.values(dataView.table.rows[0] || {}),
          rowLength: Object.keys(dataView.table.rows[0] || {}).length,
        });

        // Check if we have multiple rows with different data
        if (dataView.table.rows.length > 1) {
          console.log("🔍 Data sample check - Second row:", {
            rowIndex: 1,
            rowData: dataView.table.rows[1],
            rowKeys: Object.keys(dataView.table.rows[1] || {}),
            rowValues: Object.values(dataView.table.rows[1] || {}),
            rowLength: Object.keys(dataView.table.rows[1] || {}).length,
          });
        }

        // Check for any Power BI data transformations
        console.log("🔍 Power BI data transformation check:", {
          hasCategorical: !!dataView.categorical,
          hasSingle: !!dataView.single,
          hasTable: !!dataView.table,
          tableRowCount: dataView.table?.rows?.length || 0,
          tableColumnCount: dataView.table?.columns?.length || 0,
        });
      }

      // Update choropleth settings if available
      this.choroplethSettings.showChoropleth = true;
      this.choroplethSettings.colorScheme = "Viridis";
      this.colorScale = this.createColorScale();

      const values = dataView.table.rows;
      const columns = dataView.table.columns;

      // Debug: Log the initial data state
      console.log("🔍 Initial data state:", {
        valuesLength: values.length,
        columnsLength: columns.length,
        firstRowKeys: values.length > 0 ? Object.keys(values[0] || {}) : [],
        firstRowValues: values.length > 0 ? Object.values(values[0] || {}) : [],
      });

      // Clear existing data
      this.clearAllData();

      // Process choropleth data from Power BI table
      console.log("🔄 Step 1: Processing choropleth data...");
      this.processChoroplethDataFromPowerBI(dataView);

      // Process marker data
      console.log("🔄 Step 2: Processing marker data...");
      this.processMarkerData(dataView);

      // Validate that markers were created correctly
      console.log("🔍 Marker validation after processing:", {
        markersCreated: this.markers.length,
        expectedMarkers: values.length,
        markerPositions: this.markers.slice(0, 5).map((marker, idx) => {
          const latlng = marker.getLatLng();
          return {
            index: idx,
            position: [latlng.lat, latlng.lng],
            hasSelectionId: !!(marker as any).options.selectionId,
          };
        }),
      });

      // Create selection IDs
      console.log("🔄 Step 3: Creating selection IDs...");
      this.selectionIds = values.map((row, index) => {
        return this.host
          .createSelectionIdBuilder()
          .withTable(dataView.table, index)
          .createSelectionId();
      });

      // Debug: Log selection IDs creation
      console.log("🔍 Selection IDs created:", {
        totalRows: values.length,
        selectionIdsCreated: this.selectionIds.length,
        firstFewSelectionIds: this.selectionIds.slice(0, 3).map((id, idx) => ({
          rowIndex: idx,
          selectionId: id.toString ? id.toString() : String(id),
          hasGetKey: !!id.getKey,
          hasToString: !!id.toString,
        })),
      });

      // Update choropleth layer
      console.log("🔄 Step 4: Updating choropleth layer...");
      this.updateChoroplethLayer();

      // Perform empty state check
      console.log("🔄 Step 5: Performing empty state check...");
      this.performEmptyStateCheck();

      // Restore previous selection state if needed
      console.log("🔄 Step 6: Restoring selection state...");
      this.restoreSelectionState();

      // Final validation check
      console.log("🔍 Final validation check:", {
        totalRowsReceived: values.length,
        markersCreated: this.markers.length,
        selectionIdsCreated: this.selectionIds.length,
        choroplethFeaturesCreated: this.powerBIChoroplethData.length,
        mapHasMarkers: this.map.hasLayer
          ? this.markers.filter((marker) => this.map.hasLayer(marker)).length
          : "N/A",
      });

      console.log("✅ Update method completed successfully");
    } catch (error) {
      console.error("Error in visual update:", error);
      this.showEmptyState();
    }
  }

  private processChoroplethDataFromPowerBI(dataView: DataView) {
    this.powerBIChoroplethData = [];

    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      return;
    }

    const columns = dataView.table.columns;
    const values = dataView.table.rows;

    // Find column indices for choropleth data
    const geometryColIndex = columns.findIndex(
      (col) =>
        col.roles?.choroplethGeometry ||
        col.displayName === "geometryString" ||
        col.displayName === "data.geometryString"
    );
    const valueColIndex = columns.findIndex(
      (col) => col.roles?.choroplethValue
    );
    const adminCodeColIndex = columns.findIndex(
      (col) =>
        col.roles?.adminCode ||
        col.displayName === "adminCode" ||
        col.displayName === "data.adminCode"
    );
    const countryNameColIndex = columns.findIndex(
      (col) =>
        col.roles?.countryName ||
        col.displayName === "countryName" ||
        col.displayName === "data.countryName"
    );
    const isoCodeColIndex = columns.findIndex(
      (col) =>
        col.roles?.isoCode ||
        col.displayName === "isoCode" ||
        col.displayName === "data.isoCode"
    );
    const continentColIndex = columns.findIndex(
      (col) =>
        col.roles?.continent ||
        col.displayName === "continent" ||
        col.displayName === "data.continent"
    );
    const tooltipColIndices = columns
      .map((col, index) => (col.roles?.tooltip ? index : -1))
      .filter((index) => index !== -1);

    // Check if we have the split-rows structure
    const featureIndexColIndex = columns.findIndex(
      (col) =>
        col.displayName === "featureIndex" ||
        col.displayName === "featureindex" ||
        col.displayName === "FeatureIndex" ||
        col.displayName === "data.featureIndex" ||
        col.displayName === "data.FeatureIndex"
    );
    const geometryPartColIndex = columns.findIndex(
      (col) =>
        col.displayName === "geometryPart" ||
        col.displayName === "geometrypart" ||
        col.displayName === "GeometryPart" ||
        col.displayName === "data.geometryPart" ||
        col.displayName === "data.GeometryPart"
    );
    const totalPartsColIndex = columns.findIndex(
      (col) =>
        col.displayName === "totalParts" ||
        col.displayName === "totalparts" ||
        col.displayName === "TotalParts" ||
        col.displayName === "data.totalParts" ||
        col.displayName === "data.TotalParts"
    );

    // Check for actual split-rows structure (not just truncated data)
    let hasSplitRowsPattern = false;
    if (values.length > 0) {
      // Only consider it split-rows if we have explicit split-rows columns
      hasSplitRowsPattern =
        featureIndexColIndex >= 0 &&
        geometryPartColIndex >= 0 &&
        totalPartsColIndex >= 0;

      // Additional check: verify the data actually has multiple parts per feature
      if (hasSplitRowsPattern) {
        const featureGroups = new Map();
        values.forEach((row) => {
          const featureIndex = row[featureIndexColIndex];
          if (featureIndex !== null && featureIndex !== undefined) {
            if (!featureGroups.has(featureIndex)) {
              featureGroups.set(featureIndex, []);
            }
            featureGroups.get(featureIndex).push(row);
          }
        });

        // Check if any feature actually has multiple parts
        const hasMultipleParts = Array.from(featureGroups.values()).some(
          (rows) => rows.length > 1
        );
        hasSplitRowsPattern = hasMultipleParts;
      }

      // Alternative detection: look for Power BI flattened JSON structure
      if (!hasSplitRowsPattern) {
        // Check if we have Power BI flattened JSON columns
        const hasFlattenedStructure = columns.some(
          (col) =>
            col.displayName.startsWith("data.") &&
            (col.displayName.includes("featureIndex") ||
              col.displayName.includes("geometryPart") ||
              col.displayName.includes("totalParts"))
        );

        if (hasFlattenedStructure) {
          // This looks like a split-rows structure that Power BI has flattened
          hasSplitRowsPattern = true;
          console.log(
            "🔍 Detected Power BI flattened JSON structure - treating as split-rows"
          );
        }

        // Additional check: look for any columns that suggest split-rows structure
        const hasSplitRowsColumns = columns.some(
          (col) =>
            col.displayName.toLowerCase().includes("featureindex") ||
            col.displayName.toLowerCase().includes("geometrypart") ||
            col.displayName.toLowerCase().includes("totalparts") ||
            col.displayName.toLowerCase().includes("rowid")
        );

        if (hasSplitRowsColumns) {
          hasSplitRowsPattern = true;
          console.log("🔍 Detected split-rows columns by pattern matching");
        }

        // Check if we have many rows but few unique countries (pattern-based detection)
        if (values.length > 100) {
          const countryNames = values
            .map((row) => row[countryNameColIndex])
            .filter((name) => name);
          const uniqueCountries = new Set(countryNames);
          const hasManyRowsFewCountries =
            values.length > uniqueCountries.size * 2;

          if (hasManyRowsFewCountries) {
            hasSplitRowsPattern = true;
            console.log(
              "🔍 Detected split-rows by data pattern: many rows, few unique countries"
            );
          }
        }
      }
    }

    let isSplitRowsStructure = hasSplitRowsPattern;

    // Final fallback: if we have many rows and this looks like it should be split-rows
    if (!isSplitRowsStructure && values.length > 100) {
      // Check if this looks like split-rows data by examining the actual data
      const sampleRows = values.slice(0, 10);
      const hasRepeatedCountries = sampleRows.some((row, index) => {
        if (index === 0) return false;
        return (
          row[countryNameColIndex] ===
          sampleRows[index - 1][countryNameColIndex]
        );
      });

      if (hasRepeatedCountries) {
        console.log(
          "🔍 Fallback detection: Data pattern suggests split-rows structure"
        );
        console.log(
          "💡 Power BI may not be showing all columns - treating as split-rows anyway"
        );
        isSplitRowsStructure = true;
      }
    }

    console.log("Choropleth column indices:", {
      geometry: geometryColIndex,
      value: valueColIndex,
      adminCode: adminCodeColIndex,
      countryName: countryNameColIndex,
      isoCode: isoCodeColIndex,
      continent: continentColIndex,
      tooltip: tooltipColIndices,
      featureIndex: featureIndexColIndex,
      geometryPart: geometryPartColIndex,
      totalParts: totalPartsColIndex,
      isSplitRowsStructure: isSplitRowsStructure,
    });

    // Debug: Show all available column names and what we're looking for
    console.log(
      "🔍 All available columns:",
      columns.map((col) => ({
        displayName: col.displayName,
        name: col.displayName,
        roles: col.roles,
        isGeometry:
          col.displayName === "geometryString" ||
          col.displayName === "data.geometryString",
        isFeatureIndex:
          col.displayName === "featureIndex" ||
          col.displayName === "data.featureIndex",
        isGeometryPart:
          col.displayName === "geometryPart" ||
          col.displayName === "data.geometryPart",
        isTotalParts:
          col.displayName === "totalParts" ||
          col.displayName === "data.totalParts",
      }))
    );

    // Additional debugging: Show the actual data structure
    if (values.length > 0) {
      console.log("🔍 First row data structure:", {
        row0: values[0],
        row0Keys: Object.keys(values[0] || {}),
        row0Values: Object.values(values[0] || {}),
        totalRows: values.length,
      });

      // Check if we're missing expected split-rows columns
      const expectedColumns = [
        "featureIndex",
        "geometryPart",
        "totalParts",
        "rowId",
      ];
      const missingColumns = expectedColumns.filter(
        (col) =>
          !columns.some((c) =>
            c.displayName.toLowerCase().includes(col.toLowerCase())
          )
      );

      if (missingColumns.length > 0) {
        console.log("⚠️  Missing expected split-rows columns:", missingColumns);
        console.log(
          "💡 This suggests Power BI may not be importing all columns from your JSON file"
        );
        console.log(
          "💡 Try refreshing the data source or check Power BI's JSON import settings"
        );
      }
    }

    if (isSplitRowsStructure) {
      // Handle actual split-rows structure
      this.processSplitRowsData(values, columns, {
        geometryColIndex,
        valueColIndex,
        adminCodeColIndex,
        countryNameColIndex,
        isoCodeColIndex,
        continentColIndex,
        tooltipColIndices,
        featureIndexColIndex,
        geometryPartColIndex,
        totalPartsColIndex,
      });
    } else {
      // Handle traditional single-row structure (including truncated JSON)
      this.processTraditionalData(values, columns, {
        geometryColIndex,
        valueColIndex,
        adminCodeColIndex,
        countryNameColIndex,
        isoCodeColIndex,
        continentColIndex,
        tooltipColIndices,
      });
    }

    console.log(
      `Processed ${this.powerBIChoroplethData.length} choropleth features from Power BI data`
    );
  }

  private processSplitRowsData(values: any[], columns: any[], indices: any) {
    // Group rows by featureIndex or country name if featureIndex not available
    const featureGroups = new Map();

    values.forEach((row, rowIndex) => {
      let groupKey;

      if (indices.featureIndexColIndex >= 0) {
        // Use featureIndex if available
        groupKey = row[indices.featureIndexColIndex];
      } else {
        // Fallback: use country name as grouping key
        groupKey = row[indices.countryNameColIndex] || `row_${rowIndex}`;
      }

      if (groupKey === null || groupKey === undefined) return;

      if (!featureGroups.has(groupKey)) {
        featureGroups.set(groupKey, []);
      }
      featureGroups.get(groupKey).push(row);
    });

    console.log(
      `🔍 Grouped ${values.length} rows into ${featureGroups.size} feature groups`
    );

    // Check if this is actually a flattened structure (1 row per feature)
    const isFlattenedStructure = featureGroups.size === values.length;
    if (isFlattenedStructure) {
      console.log(
        "🔍 Detected flattened structure: 1 row per feature, no concatenation needed"
      );

      // Process each row as a complete feature (no concatenation)
      values.forEach((row, rowIndex) => {
        try {
          const geometryString = String(row[indices.geometryColIndex]);

          // Debug: Show the actual geometry string content
          if (rowIndex < 5) {
            // Only show first 5 rows to avoid console spam
            console.log(`🔍 Row ${rowIndex} geometry string:`, {
              length: geometryString.length,
              start: geometryString.substring(0, 50),
              end: geometryString.substring(geometryString.length - 50),
              fullString: geometryString,
            });
          }

          // Check for potential truncation issues
          if (geometryString.length >= 32766) {
            console.log(
              `⚠️  Row ${rowIndex}: Geometry string is very long (${geometryString.length} chars) - may have truncation issues`
            );
          }

          // Parse the geometry directly (no concatenation needed)
          let geometryData;

          // First, check if the string is already valid GeoJSON
          if (geometryString.trim().startsWith('{"type"')) {
            try {
              geometryData = JSON.parse(geometryString);
              console.log(
                `✅ Row ${rowIndex}: Geometry string is already valid GeoJSON`
              );
            } catch (parseError) {
              console.log(
                `⚠️  Row ${rowIndex}: Valid GeoJSON structure but parsing failed:`,
                parseError.message
              );
              return; // Skip this feature
            }
          } else {
            // Try to fix common malformed string issues
            let fixedString = geometryString;
            let fixAttempted = false;

            // Fix 1: Add missing opening brace if string starts with ",[["
            if (geometryString.startsWith(",[[")) {
              fixedString =
                '{"type":"MultiPolygon","coordinates":' +
                geometryString.substring(1);
              fixAttempted = true;
              console.log(
                `🔧 Attempting to fix malformed string by adding missing GeoJSON structure`
              );
            }

            // Fix 2: Add missing opening brace if string starts with "[["
            if (geometryString.startsWith("[[")) {
              fixedString =
                '{"type":"MultiPolygon","coordinates":' + geometryString;
              fixAttempted = true;
              console.log(
                `🔧 Attempting to fix malformed string by adding missing GeoJSON structure`
              );
            }

            // Fix 3: If string starts with just coordinates, wrap it properly
            if (
              geometryString.startsWith("[[[") &&
              !geometryString.startsWith('{"')
            ) {
              fixedString =
                '{"type":"MultiPolygon","coordinates":' + geometryString + "}";
              fixAttempted = true;
              console.log(
                `🔧 Attempting to fix malformed string by wrapping in complete GeoJSON structure`
              );
            }

            // Try to parse the fixed string
            if (fixAttempted) {
              try {
                geometryData = JSON.parse(fixedString);
                console.log(
                  `✅ Successfully fixed and parsed geometry string for row ${rowIndex}`
                );
              } catch (fixError) {
                console.log(
                  `❌ Could not fix malformed geometry string for row ${rowIndex}:`,
                  fixError.message
                );
                return; // Skip this feature
              }
            } else {
              return; // Skip this feature
            }
          }

          if (geometryData && geometryData.type) {
            const choroplethData: PowerBIChoroplethData = {
              adminCode:
                indices.adminCodeColIndex >= 0
                  ? String(row[indices.adminCodeColIndex])
                  : null,
              geometry: geometryData,
              choroplethValue:
                indices.valueColIndex >= 0
                  ? parseFloat(String(row[indices.valueColIndex])) || 0
                  : 0,
              countryName:
                indices.countryNameColIndex >= 0
                  ? String(row[indices.countryNameColIndex])
                  : "Unknown",
              isoCode:
                indices.isoCodeColIndex >= 0
                  ? String(row[indices.isoCodeColIndex])
                  : "",
              continent:
                indices.continentColIndex >= 0
                  ? String(row[indices.continentColIndex])
                  : "",
              tooltipData: new Map(),
            };

            // Process tooltip data
            indices.tooltipColIndices.forEach((tooltipIndex) => {
              if (
                row[tooltipIndex] !== null &&
                row[tooltipIndex] !== undefined
              ) {
                const columnName = columns[tooltipIndex].displayName;
                choroplethData.tooltipData.set(columnName, row[tooltipIndex]);
              }
            });

            this.powerBIChoroplethData.push(choroplethData);

            console.log(
              `✅ Processed flattened feature ${rowIndex} (${choroplethData.countryName})`
            );
          }
        } catch (error) {
          console.error(
            `Error processing flattened feature ${rowIndex}:`,
            error
          );
        }
      });

      return; // Exit early for flattened structure
    }

    // Original split-rows logic for actual multi-part features
    console.log("🔍 Processing actual split-rows structure with concatenation");

    // Process each feature group
    featureGroups.forEach((rows, groupKey) => {
      try {
        // Sort rows by geometryPart if available, otherwise by row order
        if (indices.geometryPartColIndex >= 0) {
          rows.sort(
            (a, b) =>
              a[indices.geometryPartColIndex] - b[indices.geometryPartColIndex]
          );
        }

        // Reconstruct the full geometry string
        let fullGeometryString = "";
        rows.forEach((row) => {
          const geometryString = String(row[indices.geometryColIndex]);
          fullGeometryString += geometryString;
        });

        // Check for potential truncation issues
        if (fullGeometryString.length >= 32766) {
          console.log(
            `⚠️  Feature ${groupKey}: Combined geometry string is very long (${fullGeometryString.length} chars) - may have truncation issues`
          );
        }

        // Parse the reconstructed geometry
        let geometryData;
        try {
          geometryData = JSON.parse(fullGeometryString);
        } catch (parseError) {
          // Check if this is a truncation error
          if (
            parseError.message.includes("position 32766") ||
            parseError.message.includes(
              "Expected ',' or ']' after array element"
            )
          ) {
            console.log(
              `❌ Feature ${groupKey}: JSON truncated by Power BI at position 32766. This is a Power BI limitation. Consider using the JSON import method instead of CSV/Excel.`
            );
          } else {
            console.log(
              `⚠️  Feature ${groupKey}: Could not parse reconstructed geometry string: ${parseError.message}`
            );
          }
          return; // Skip this feature
        }

        if (geometryData && geometryData.type) {
          // Use the first row for metadata
          const firstRow = rows[0];

          const choroplethData: PowerBIChoroplethData = {
            adminCode:
              indices.adminCodeColIndex >= 0
                ? String(firstRow[indices.adminCodeColIndex])
                : null,
            geometry: geometryData,
            choroplethValue:
              indices.valueColIndex >= 0
                ? parseFloat(String(firstRow[indices.valueColIndex])) || 0
                : 0,
            countryName:
              indices.countryNameColIndex >= 0
                ? String(firstRow[indices.countryNameColIndex])
                : "Unknown",
            isoCode:
              indices.isoCodeColIndex >= 0
                ? String(firstRow[indices.isoCodeColIndex])
                : "",
            continent:
              indices.continentColIndex >= 0
                ? String(firstRow[indices.continentColIndex])
                : "",
            tooltipData: new Map(),
          };

          // Process tooltip data from the first row
          indices.tooltipColIndices.forEach((tooltipIndex) => {
            if (
              firstRow[tooltipIndex] !== null &&
              firstRow[tooltipIndex] !== undefined
            ) {
              const columnName = columns[tooltipIndex].displayName;
              choroplethData.tooltipData.set(
                columnName,
                firstRow[tooltipIndex]
              );
            }
          });

          this.powerBIChoroplethData.push(choroplethData);

          console.log(
            `✅ Reconstructed geometry for ${groupKey} (${choroplethData.countryName}) from ${rows.length} parts`
          );
        }
      } catch (error) {
        console.error(
          `Error processing split-rows feature ${groupKey}:`,
          error
        );
      }
    });
  }

  private processTraditionalData(values: any[], columns: any[], indices: any) {
    for (let i = 0; i < values.length; i++) {
      const row = values[i];

      // Check if this row has choropleth geometry data
      if (indices.geometryColIndex >= 0 && row[indices.geometryColIndex]) {
        try {
          // Get geometry data directly (no concatenation needed with JSON approach)
          let geometryData;

          // Handle both string and object inputs
          if (typeof row[indices.geometryColIndex] === "object") {
            geometryData = row[indices.geometryColIndex];
          } else {
            const geometryString = String(row[indices.geometryColIndex]);

            // Check if Power BI converted the geometry to "[Record]" text
            if (
              geometryString === "[Record]" ||
              geometryString === "[Object]"
            ) {
              console.log(
                `⚠️  Row ${i}: Power BI converted geometry to "${geometryString}" - skipping this row`
              );
              continue; // Skip this row as we can't parse it
            }

            // Check for truncated JSON (common Power BI issue)
            if (geometryString.length >= 32766) {
              console.log(
                `⚠️  Row ${i}: Geometry string is very long (${geometryString.length} chars) - may be truncated by Power BI`
              );
            }

            try {
              geometryData = JSON.parse(geometryString);
            } catch (parseError) {
              // Check if this is a truncation error
              if (
                parseError.message.includes("position 32766") ||
                parseError.message.includes(
                  "Expected ',' or ']' after array element"
                )
              ) {
                console.log(
                  `❌ Row ${i}: JSON truncated by Power BI at position 32766. This is a Power BI limitation. Consider using the JSON import method instead of CSV/Excel.`
                );
              } else {
                console.log(
                  `⚠️  Row ${i}: Could not parse geometry string: ${geometryString.substring(
                    0,
                    100
                  )}... Error: ${parseError.message}`
                );
              }
              continue; // Skip this row
            }
          }

          // Log country info for debugging
          const countryName =
            indices.countryNameColIndex >= 0
              ? String(row[indices.countryNameColIndex])
              : "Unknown";
          const adminCode =
            indices.adminCodeColIndex >= 0
              ? String(row[indices.adminCodeColIndex])
              : "Unknown";
          console.log(
            `Row ${i}: ${countryName} (${adminCode}) - Geometry type: ${
              geometryData?.type || "Unknown"
            }`
          );

          if (geometryData && geometryData.type) {
            const choroplethData: PowerBIChoroplethData = {
              adminCode:
                indices.adminCodeColIndex >= 0
                  ? String(row[indices.adminCodeColIndex])
                  : null,
              geometry: geometryData,
              choroplethValue:
                indices.valueColIndex >= 0
                  ? parseFloat(String(row[indices.valueColIndex])) || 0
                  : 0,
              countryName: countryName,
              isoCode:
                indices.isoCodeColIndex >= 0
                  ? String(row[indices.isoCodeColIndex])
                  : "",
              continent:
                indices.continentColIndex >= 0
                  ? String(row[indices.continentColIndex])
                  : "",
              tooltipData: new Map(),
            };

            // Process tooltip data
            indices.tooltipColIndices.forEach((tooltipIndex) => {
              if (
                row[tooltipIndex] !== null &&
                row[tooltipIndex] !== undefined
              ) {
                const columnName = columns[tooltipIndex].displayName;
                choroplethData.tooltipData.set(columnName, row[tooltipIndex]);
              }
            });

            this.powerBIChoroplethData.push(choroplethData);
          }
        } catch (error) {
          console.error(`Error parsing geometry data for row ${i}:`, error);
        }
      }
    }
  }

  private processMarkerData(dataView: DataView) {
    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      return;
    }

    const columns = dataView.table.columns;
    const values = dataView.table.rows;

    // Find column indices for marker data
    const latColIndex = columns.findIndex((col) => col.roles?.latitude);
    const lngColIndex = columns.findIndex((col) => col.roles?.longitude);

    // Fallback: If roles are not found, try to detect by column names
    let fallbackLatColIndex = -1;
    let fallbackLngColIndex = -1;

    if (latColIndex === -1 || lngColIndex === -1) {
      console.log(
        "⚠️  Latitude/Longitude roles not found, attempting fallback detection by column names..."
      );

      fallbackLatColIndex = columns.findIndex(
        (col) =>
          col.displayName.toLowerCase().includes("lat") ||
          col.displayName.toLowerCase().includes("latitude") ||
          col.displayName.toLowerCase().includes("y") ||
          col.displayName === "Latitude" ||
          col.displayName === "latitude"
      );

      fallbackLngColIndex = columns.findIndex(
        (col) =>
          col.displayName.toLowerCase().includes("lng") ||
          col.displayName.toLowerCase().includes("longitude") ||
          col.displayName.toLowerCase().includes("x") ||
          col.displayName === "Longitude" ||
          col.displayName === "longitude"
      );

      console.log("🔍 Fallback column detection:", {
        fallbackLatColIndex: fallbackLatColIndex,
        fallbackLngColIndex: fallbackLngColIndex,
        fallbackLatName:
          fallbackLatColIndex >= 0
            ? columns[fallbackLatColIndex].displayName
            : "NOT FOUND",
        fallbackLngName:
          fallbackLngColIndex >= 0
            ? columns[fallbackLngColIndex].displayName
            : "NOT FOUND",
      });
    }

    // Use fallback indices if primary roles are not found
    const finalLatColIndex =
      latColIndex >= 0 ? latColIndex : fallbackLatColIndex;
    const finalLngColIndex =
      lngColIndex >= 0 ? lngColIndex : fallbackLngColIndex;

    const tooltipColIndices = columns
      .map((col, index) => (col.roles?.tooltip ? index : -1))
      .filter((index) => index !== -1);

    // Add comprehensive debugging
    console.log("🔍 Marker processing debug info:", {
      totalRows: values.length,
      latColIndex: latColIndex,
      lngColIndex: lngColIndex,
      fallbackLatColIndex: fallbackLatColIndex,
      fallbackLngColIndex: fallbackLngColIndex,
      finalLatColIndex: finalLatColIndex,
      finalLngColIndex: finalLngColIndex,
      latColName:
        finalLatColIndex >= 0
          ? columns[finalLatColIndex].displayName
          : "NOT FOUND",
      lngColName:
        finalLngColIndex >= 0
          ? columns[finalLngColIndex].displayName
          : "NOT FOUND",
      tooltipColIndices: tooltipColIndices,
      allColumns: columns.map((col, idx) => ({
        index: idx,
        name: col.displayName,
        roles: col.roles,
        hasLatitude: col.roles?.latitude ? "YES" : "NO",
        hasLongitude: col.roles?.longitude ? "YES" : "NO",
      })),
    });

    // Debug: Show first few rows of data
    if (values.length > 0) {
      console.log(
        "🔍 First 3 rows of marker data:",
        values.slice(0, 3).map((row, idx) => ({
          rowIndex: idx,
          latValue: finalLatColIndex >= 0 ? row[finalLatColIndex] : "N/A",
          lngValue: finalLngColIndex >= 0 ? row[finalLngColIndex] : "N/A",
          latType: finalLatColIndex >= 0 ? typeof row[finalLatColIndex] : "N/A",
          lngType: finalLngColIndex >= 0 ? typeof row[finalLngColIndex] : "N/A",
          latNull:
            finalLatColIndex >= 0 ? row[finalLatColIndex] === null : "N/A",
          lngNull:
            finalLngColIndex >= 0 ? row[finalLngColIndex] === null : "N/A",
        }))
      );
    }

    let processedCount = 0;
    let skippedCount = 0;
    let invalidCoordCount = 0;
    let loopIterations = 0;

    for (let i = 0; i < values.length; i++) {
      loopIterations++;
      const row = values[i];

      // Debug: Log each row being processed
      if (i < 5) {
        // Only log first 5 rows to avoid spam
        console.log(`🔍 Processing row ${i}:`, {
          latValue: finalLatColIndex >= 0 ? row[finalLatColIndex] : "N/A",
          lngValue: finalLngColIndex >= 0 ? row[finalLngColIndex] : "N/A",
          latNull:
            finalLatColIndex >= 0 ? row[finalLatColIndex] === null : "N/A",
          lngNull:
            finalLngColIndex >= 0 ? row[finalLngColIndex] === null : "N/A",
        });
      }

      // Check if this row has marker coordinates (and is not a choropleth feature)
      if (
        finalLatColIndex >= 0 &&
        finalLngColIndex >= 0 &&
        row[finalLatColIndex] !== null &&
        row[finalLngColIndex] !== null
      ) {
        const lat = parseFloat(row[finalLatColIndex].toString());
        const lng = parseFloat(row[finalLngColIndex].toString());

        if (
          !isNaN(lat) &&
          !isNaN(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        ) {
          // Create custom marker
          const customMarkerIcon = L.divIcon({
            className: "custom-marker",
            html: `
              <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.5 0C5.596 0 0 5.596 0 12.5c0 9.375 12.5 28.5 12.5 28.5s12.5-19.125 12.5-28.5C25 5.596 19.404 0 12.5 0z" fill="#22294d"/>
                <circle cx="12.5" cy="12.5" r="6" fill="white"/>
              </svg>
            `,
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            tooltipAnchor: [16, -28],
          });

          // Build tooltip content
          let tooltipContent = "";
          if (tooltipColIndices.length > 0) {
            const tooltipParts = [];
            for (const tooltipIndex of tooltipColIndices) {
              if (
                row[tooltipIndex] !== null &&
                row[tooltipIndex] !== undefined
              ) {
                const fieldName = columns[tooltipIndex].displayName;
                const fieldValue = row[tooltipIndex].toString();
                tooltipParts.push(
                  `<div class="tooltip-row"><span class="field-name">${fieldName}</span><span class="field-value">${fieldValue}</span></div>`
                );
              }
            }
            tooltipContent = tooltipParts.join("");
          } else {
            tooltipContent = `<div class="tooltip-row"><span class="field-name">Latitude</span><span class="field-value">${lat}</span></div><div class="tooltip-row"><span class="field-name">Longitude</span><span class="field-value">${lng}</span></div>`;
          }

          const marker = L.marker([lat, lng], {
            icon: customMarkerIcon,
          }).addTo(this.map);

          (marker as any).options.selectionId = this.selectionIds[i];
          this.markers.push(marker);

          marker.on("click", (event) => {
            console.log(`Marker clicked: index ${i}`);
            this.showTooltip(tooltipContent, event.latlng);

            const currentDataContext = this.getCurrentDataContext();

            this.selectionManager
              .select(this.selectionIds[i])
              .then((ids: ISelectionId[]) => {
                console.log("Selection result:", ids);
                this.currentSelection = ids;
                this.persistentSelection = [...ids];

                if (ids.length === 0) {
                  this.handleMarkerDeselection(i);
                } else {
                  this.updateMarkersVisibility(ids);
                }
              })
              .catch((error) => {
                console.error("Error in marker selection:", error);
                this.updateMarkersVisibility(this.selectionIds);
              });

            L.DomEvent.stopPropagation(event);
          });

          processedCount++;

          // Debug: Log successful marker creation
          if (i < 5) {
            console.log(`✅ Created marker ${i} at [${lat}, ${lng}]`);
          }
        } else {
          invalidCoordCount++;
          if (i < 5) {
            console.log(
              `❌ Row ${i}: Invalid coordinates - lat: ${lat}, lng: ${lng}`
            );
          }
        }
      } else {
        skippedCount++;
        if (i < 5) {
          console.log(
            `⏭️  Row ${i}: Skipped - finalLatColIndex: ${finalLatColIndex}, finalLngColIndex: ${finalLngColIndex}, latValue: ${
              finalLatColIndex >= 0 ? row[finalLatColIndex] : "N/A"
            }, lngValue: ${
              finalLngColIndex >= 0 ? row[finalLngColIndex] : "N/A"
            }`
          );
        }
      }
    }

    console.log(`📊 Marker processing summary:`, {
      totalRows: values.length,
      loopIterations: loopIterations,
      processed: processedCount,
      skipped: skippedCount,
      invalidCoordinates: invalidCoordCount,
      createdMarkers: this.markers.length,
    });
  }

  private updateChoroplethLayer() {
    if (!this.choroplethLayer) {
      return;
    }

    // Clear existing choropleth layer
    this.choroplethLayer.clearLayers();

    if (this.powerBIChoroplethData.length === 0) {
      return;
    }

    // Create GeoJSON features from Power BI data
    const features = this.powerBIChoroplethData.map((data) => {
      return {
        type: "Feature",
        properties: {
          adminCode: data.adminCode,
          choropleth_value: data.choroplethValue,
          name: data.countryName,
          isoCode: data.isoCode,
          continent: data.continent,
          tooltipData: data.tooltipData,
        },
        geometry: data.geometry,
      };
    });

    const geoJsonData = {
      type: "FeatureCollection",
      features: features,
    };

    // Add data to choropleth layer
    this.choroplethLayer.addData(geoJsonData);

    // Add to map if not already added
    if (!this.map.hasLayer(this.choroplethLayer)) {
      this.choroplethLayer.addTo(this.map);
    }

    // Fit map bounds to show all choropleth features
    if (features.length > 0 && this.choroplethLayer.getBounds) {
      try {
        const bounds = this.choroplethLayer.getBounds();
        if (bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: [20, 20] });
        }
      } catch (error) {
        console.log("Could not fit bounds, using default view");
      }
    }

    console.log(`Updated choropleth layer with ${features.length} features`);
  }

  private clearAllData() {
    console.log("🧹 clearAllData called - clearing all visual data");

    // Clear markers
    this.markers.forEach((marker) => {
      this.map.removeLayer(marker);
    });
    this.markers = [];

    // Clear choropleth layer
    if (this.choroplethLayer) {
      this.choroplethLayer.clearLayers();
    }

    // Clear selection state
    this.currentSelection = [];
    this.persistentSelection = [];
    this.selectionIds = [];

    // Clear choropleth data
    this.powerBIChoroplethData = [];

    console.log("🧹 clearAllData completed - all data cleared");
  }

  private updateMarkersVisibility(selectedIds: ISelectionId[]) {
    let visibleMarkers = 0;
    let hiddenMarkers = 0;

    this.markers.forEach((marker, index) => {
      const markerSelectionId = (marker as any).options.selectionId;
      const isSelected = selectedIds.some((id) => {
        if (id.getKey && markerSelectionId.getKey) {
          return id.getKey() === markerSelectionId.getKey();
        }
        if (id.toString && markerSelectionId.toString) {
          return id.toString() === markerSelectionId.toString();
        }
        return id === markerSelectionId;
      });

      if (selectedIds.length > 0 && !isSelected) {
        if (this.map.hasLayer(marker)) {
          this.map.removeLayer(marker);
          hiddenMarkers++;
        }
      } else {
        if (!this.map.hasLayer(marker)) {
          marker.addTo(this.map);
          visibleMarkers++;
        } else {
          visibleMarkers++;
        }
      }
    });

    console.log("Markers visibility update complete:", {
      visibleMarkers,
      hiddenMarkers,
    });
    this.performEmptyStateCheck();
  }

  private showTooltip(content: string, latlng: L.LatLng) {
    if (this.tooltipDiv) {
      const tooltipWithCloseButton = `
        <div style="position: relative;">
          <button 
            onclick="this.parentElement.parentElement.style.opacity='0'" 
            style="
              position: absolute;
              top: -10px;
              right: -3px;
              background: transparent;
              color: #CBCBCB;
              border: none;
              border-radius: 50%;
              width: 16px;
              height: 16px;
              font-size: 14px;
              font-weight: bold;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 1001;
              transition: color 0.2s ease;
            "
            onmouseover="this.style.color='#22294B'"
            onmouseout="this.style.color='#CBCBCB'"
            title="Close tooltip"
          >×</button>
          ${content}
        </div>
      `;

      this.tooltipDiv.innerHTML = tooltipWithCloseButton;
      this.tooltipDiv.style.opacity = "1";
      this.tooltipDiv.style.left = "10px";
      this.tooltipDiv.style.top = "10px";
    }
  }

  private buildChoroplethTooltipContent(feature: any): string {
    const tooltipParts = [];

    // Add basic country info
    const name =
      feature.properties?.name ||
      feature.properties?.countryName ||
      "Unknown Region";
    tooltipParts.push(
      `<div class="tooltip-row"><span class="field-name">Country</span><span class="field-value">${name}</span></div>`
    );

    // Add choropleth value if available
    if (
      feature.properties?.choropleth_value !== null &&
      feature.properties?.choropleth_value !== undefined
    ) {
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Value</span><span class="field-value">${feature.properties.choropleth_value}</span></div>`
      );
    }

    // Add tooltip data if available
    if (feature.properties?.tooltipData) {
      const tooltipData = feature.properties.tooltipData;
      if (tooltipData instanceof Map) {
        tooltipData.forEach((value, key) => {
          if (value !== null && value !== undefined && value !== "NA") {
            tooltipParts.push(
              `<div class="tooltip-row"><span class="field-name">${key}</span><span class="field-value">${value}</span></div>`
            );
          }
        });
      }
    }

    return tooltipParts.join("");
  }

  private showEmptyState() {
    if (this.emptyStateDiv) {
      this.ensureEmptyStateDivPosition();
      this.emptyStateDiv.style.opacity = "1";
      this.emptyStateDiv.style.pointerEvents = "auto";
      this.emptyStateDiv.style.display = "block";
      console.log("Empty state shown - no distribution data available");
    }
  }

  private hideEmptyState() {
    if (this.emptyStateDiv) {
      this.emptyStateDiv.style.opacity = "0";
      this.emptyStateDiv.style.pointerEvents = "none";
      console.log("Empty state hidden - distribution data available");
    }
  }

  private performEmptyStateCheck(): void {
    setTimeout(() => {
      try {
        this.ensureEmptyStateDivPosition();
        const hasAnyData = this.hasAnyDistributionData();

        if (hasAnyData) {
          this.hideEmptyState();
        } else {
          this.showEmptyState();
        }
      } catch (error) {
        console.error("Error in empty state check:", error);
        this.showEmptyState();
      }
    }, 100);
  }

  private hasAnyDistributionData(): boolean {
    try {
      const totalMarkers = this.markers.length;
      const visibleMarkers = this.markers.filter((marker) =>
        this.map.hasLayer(marker)
      ).length;
      const hasChoroplethData = this.powerBIChoroplethData.length > 0;
      const hasOriginalData = this.selectionIds.length > 0;

      const result =
        totalMarkers > 0 ||
        visibleMarkers > 0 ||
        hasChoroplethData ||
        hasOriginalData;

      console.log("Distribution data check:", {
        totalMarkers,
        visibleMarkers,
        hasChoroplethData,
        hasOriginalData,
        hasAnyData: result,
      });

      return result;
    } catch (error) {
      console.error("Error in hasAnyDistributionData:", error);
      return false;
    }
  }

  private ensureEmptyStateDivPosition(): void {
    if (this.emptyStateDiv && this.target) {
      if (this.emptyStateDiv.parentElement !== this.target) {
        this.target.appendChild(this.emptyStateDiv);
      }
      this.emptyStateDiv.style.zIndex = "9999";
      this.emptyStateDiv.style.position = "absolute";
      this.emptyStateDiv.style.top = "50%";
      this.emptyStateDiv.style.left = "50%";
      this.emptyStateDiv.style.transform = "translate(-50%, -50%)";
    }
  }

  private getCurrentDataContext(): ISelectionId[] {
    try {
      return this.selectionIds.filter((id, index) => {
        return this.markers[index] && this.map.hasLayer(this.markers[index]);
      });
    } catch (error) {
      console.error("Error getting current data context:", error);
      return [];
    }
  }

  private handleMarkerDeselection(clickedMarkerIndex: number): void {
    try {
      console.log(`Handling deselection for marker ${clickedMarkerIndex}`);
      this.updateMarkersVisibility(this.selectionIds);
    } catch (error) {
      console.error("Error handling marker deselection:", error);
    }
  }

  private showOnlyCurrentContextMarkers(): void {
    try {
      console.log("Showing only markers in current filtered context");
      this.updateMarkersVisibility(this.selectionIds);
    } catch (error) {
      console.error("Error showing current context markers:", error);
    }
  }

  private restoreSelectionState(): void {
    try {
      if (this.persistentSelection.length > 0) {
        console.log(
          "Restoring persistent selection state:",
          this.persistentSelection
        );
        this.currentSelection = [...this.persistentSelection];
        this.updateMarkersVisibility(this.persistentSelection);
      }
    } catch (error) {
      console.error("Error restoring selection state:", error);
    }
  }

  public clearSelection(): void {
    try {
      console.log("Clearing all selections");
      this.selectionManager
        .clear()
        .then(() => {
          this.currentSelection = [];
          this.persistentSelection = [];
          this.showOnlyCurrentContextMarkers();
        })
        .catch((error) => {
          console.error("Error clearing selection:", error);
          this.currentSelection = [];
          this.persistentSelection = [];
          this.showOnlyCurrentContextMarkers();
        });
    } catch (error) {
      console.error("Error in clearSelection:", error);
    }
  }

  public destroy(): void {
    try {
      if (this.map) {
        this.map.remove();
      }
      this.markers = [];
      this.selectionIds = [];
      this.powerBIChoroplethData = [];
      this.currentSelection = [];
      this.persistentSelection = [];
      console.log("Visual destroyed and cleaned up");
    } catch (error) {
      console.error("Error during visual destruction:", error);
    }
  }

  public onResize(): void {
    try {
      if (this.map) {
        this.map.invalidateSize();
      }
      this.ensureEmptyStateDivPosition();
      this.performEmptyStateCheck();
      console.log("Visual resized and updated");
    } catch (error) {
      console.error("Error during visual resize:", error);
    }
  }

  private getDisputedBorderStyle(feature: any) {
    const lineStyle = feature.properties?.line_style || "dashed";
    return {
      color: "#CBCBCB",
      weight: 3,
      opacity: 1,
      fillOpacity: 0,
      dashArray: lineStyle === "dotted" ? "1, 3" : "10, 5",
      lineCap: "round",
      lineJoin: "round",
    };
  }

  private onEachDisputedBorderFeature(feature: any, layer: L.Layer) {
    // No click events for disputed borders - they are visual indicators only
  }

  private loadDisputedBorders() {
    try {
      const bordersData = disputedBorders;

      if (this.disputedBordersLayer) {
        this.disputedBordersLayer.clearLayers();
      }

      this.disputedBordersLayer.addData(bordersData);

      if (!this.map.hasLayer(this.disputedBordersLayer)) {
        this.disputedBordersLayer.addTo(this.map);
      }

      console.log("Disputed borders loaded successfully");
    } catch (error) {
      console.error("Error loading disputed borders:", error);
    }
  }
}
