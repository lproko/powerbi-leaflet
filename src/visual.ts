import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import powerbiVisualsApi from "powerbi-visuals-api";
import IVisual = powerbiVisualsApi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbiVisualsApi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbiVisualsApi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbiVisualsApi.DataView;
import ISelectionManager = powerbiVisualsApi.extensibility.ISelectionManager;
import ISelectionId = powerbiVisualsApi.visuals.ISelectionId;
import markerIcon from "leaflet/dist/images/marker-icon.png";
import { disputedBorders } from "./disputed-borders";
import customGeoJSON from "./custom.geo.json";

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
  choroplethTooltipData: Map<string, any>; // Power BI choropleth tooltip data
}

export class Visual implements IVisual {
  private target: HTMLElement;
  private map: L.Map;
  private selectionManager: ISelectionManager;
  private host: powerbiVisualsApi.extensibility.visual.IVisualHost;
  private markers: L.Marker[] = [];
  private selectionIds: ISelectionId[] = [];
  private markerClusterGroup: L.MarkerClusterGroup;
  private baseMapLayer: L.GeoJSON;
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
  private currentDataView: DataView;

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
      maxZoom: 20,
      minZoom: 1,
    }).setView([20, 0], 2);

    // Add zoom control to top right
    L.control
      .zoom({
        position: "topright",
      })
      .addTo(this.map);

    // Add double-click to reset view
    this.map.on("dblclick", () => {
      this.resetToDefaultView();
    });

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

    // Initialize base map layer from custom.geo.json
    this.baseMapLayer = L.geoJSON(null, {
      style: () => this.getBaseMapStyle(),
      onEachFeature: (feature, layer) =>
        this.onEachBaseMapFeature(feature, layer),
    });

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

    // Initialize marker cluster group
    this.markerClusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 80,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: true,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 18,
      removeOutsideVisibleBounds: true,
      animate: true,
      animateAddingMarkers: true,
      spiderfyShapePositions: function (count: number, centerPoint: L.Point) {
        const positions = [];
        const angleStep = (2 * Math.PI) / count;
        const angle = ((count % 2) * angleStep) / 2;
        for (let i = 0; i < count; i++) {
          const angle2 = angle + i * angleStep;
          const x = Math.cos(angle2) * 20;
          const y = Math.sin(angle2) * 20;
          positions.push(new L.Point(centerPoint.x + x, centerPoint.y + y));
        }
        return positions;
      },
    });

    // Add cluster event handlers
    this.markerClusterGroup.on("clusterclick", (e) => {
      console.log(
        "Cluster clicked:",
        e.layer.getAllChildMarkers().length,
        "markers"
      );
      // You can add custom cluster click behavior here
    });

    this.markerClusterGroup.on("animationend", () => {
      console.log("Cluster animation completed");
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
      
      /* Marker cluster styling */
      .marker-cluster-small {
        background-color: rgba(34, 41, 77, 0.6);
        border: 2px solid #22294d;
      }
      
      .marker-cluster-small div {
        background-color: rgba(34, 41, 77, 0.8);
        color: white;
        font-weight: bold;
        font-size: 11px;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .marker-cluster-medium {
        background-color: rgba(34, 41, 77, 0.7);
        border: 2px solid #22294d;
      }
      
      .marker-cluster-medium div {
        background-color: rgba(34, 41, 77, 0.9);
        color: white;
        font-weight: bold;
        font-size: 12px;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .marker-cluster-large {
        background-color: rgba(34, 41, 77, 0.8);
        border: 2px solid #22294d;
      }
      
      .marker-cluster-large div {
        background-color: rgba(34, 41, 77, 1);
        color: white;
        font-weight: bold;
        font-size: 13px;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .marker-cluster-small:hover,
      .marker-cluster-medium:hover,
      .marker-cluster-large:hover {
        background-color: rgba(69, 94, 111, 0.8);
        border-color: #455E6F;
      }
    `;
    document.head.appendChild(style);

    // Load base map and disputed borders
    this.loadBaseMap();
    this.loadDisputedBorders();

    // Setup custom zoom controls
    this.setupZoomControls();
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

  private getBaseMapStyle() {
    return {
      fillColor: "#F2F2F2",
      weight: 0.5,
      opacity: 1,
      color: "#666666",
      fillOpacity: 0.3,
    };
  }

  private onEachBaseMapFeature(feature: any, layer: L.Layer) {
    if (feature.properties) {
      const name = feature.properties.name || "Unknown Region";

      // Base map features are completely non-interactive - no hover effects, no click functionality
      // This ensures only Power BI choropleth features are interactive
    }
  }

  // Performance monitoring helper
  private logPerformance(operation: string, startTime: number) {
    const duration = performance.now() - startTime;
    console.log(`⚡ ${operation} completed in ${duration.toFixed(2)}ms`);
    return duration;
  }

  // Method to reset map to desired zoom level
  private resetToDefaultView() {
    if (this.map) {
      this.map.setView([20, 0], 2);
      console.log("🗺️ Map reset to default view: zoom level 2");
    }
  }

  // Override zoom controls to respect our desired zoom level
  private setupZoomControls() {
    if (this.map) {
      // Get the zoom control element
      const zoomControl = this.map.zoomControl;
      if (zoomControl) {
        // Override zoom in to prevent going too far
        const zoomInButton = zoomControl
          .getContainer()
          ?.querySelector(".leaflet-control-zoom-in");
        if (zoomInButton) {
          zoomInButton.addEventListener("click", (e) => {
            const currentZoom = this.map.getZoom();
            if (currentZoom >= 2) {
              // If we're at or above zoom level 2, reset to 2
              setTimeout(() => {
                this.map.setZoom(2);
              }, 100);
            }
          });
        }
      }
    }
  }

  // Simple helper function to load map data
  private loadMapData() {
    const startTime = performance.now();

    try {
      const geoData = customGeoJSON;

      // Add to base map layer
      this.baseMapLayer.addData(geoData);
      this.map.addLayer(this.baseMapLayer);

      // Process for choropleth
      this.processCustomGeoJSONToChoropleth(geoData);

      // Don't fit bounds - keep our desired zoom level 2
      // This prevents the jarring zoom-in-then-zoom-out effect
      console.log("🗺️ Keeping map at zoom level 2 - no bounds fitting");

      this.logPerformance("Map data loading", startTime);
      console.log(`✅ Map loaded: ${geoData.features?.length || 0} features`);
    } catch (error) {
      console.error("❌ Map loading error:", error);
      this.map.setView([20, 0], 2);
    }
  }

  private loadBaseMap() {
    console.log("🗺️ Loading map data from custom.geo.json...");
    this.loadMapData();
  }

  private processCustomGeoJSONToChoropleth(geoData: any) {
    const processingStartTime = performance.now();

    if (!geoData.features || !Array.isArray(geoData.features)) {
      console.warn("No features found in custom.geo.json");
      this.powerBIChoroplethData = [];
      return;
    }

    console.log(
      `🔄 Processing ${geoData.features.length} features for choropleth...`
    );

    // Pre-allocate array for better performance
    this.powerBIChoroplethData = new Array(geoData.features.length);
    let processedCount = 0;

    // Use for loop instead of forEach for better performance
    for (let index = 0; index < geoData.features.length; index++) {
      const feature = geoData.features[index];

      try {
        if (feature.geometry && feature.properties) {
          const properties = feature.properties;

          // Optimized property access with fallbacks
          const choroplethData: PowerBIChoroplethData = {
            adminCode:
              feature.properties?.adminCode ||
              feature.properties?.gaul_code ||
              feature.properties?.gaul0_code ||
              index,

            geometry: feature.geometry,
            choroplethValue:
              feature.properties?.value ||
              feature.properties?.choropleth_value ||
              0, // No artificial value - let it use neutral styling
            countryName:
              feature.properties?.name ||
              feature.properties?.countryName ||
              feature.properties?.gaul0_name ||
              `Feature ${index}`,
            isoCode:
              feature.properties?.iso3_code ||
              feature.properties?.isoCode ||
              "",
            continent: feature.properties?.continent || "",
            tooltipData: new Map(),
            choroplethTooltipData: new Map(),
          };

          // Only add non-empty properties to tooltip data for performance
          for (const [key, value] of Object.entries(properties)) {
            if (value != null && value !== "") {
              choroplethData.tooltipData.set(key, value);
            }
          }

          this.powerBIChoroplethData[index] = choroplethData;
          processedCount++;

          // Log first few features for debugging
          if (index < 3) {
            console.log(
              `✅ Processed feature ${index}: ${choroplethData.countryName}`
            );
          }
        }
      } catch (error) {
        console.error(`Error processing feature ${index}:`, error);
        // Keep the array slot empty for this index
      }
    }

    // Remove any undefined entries and log results
    this.powerBIChoroplethData = this.powerBIChoroplethData.filter(Boolean);
    this.logPerformance("Choropleth processing", processingStartTime);
    console.log(
      `✅ Choropleth processing complete: ${this.powerBIChoroplethData.length} features processed`
    );

    // Additional debugging to see what was actually created
    if (this.powerBIChoroplethData.length > 0) {
      console.log("🔍 First few choropleth features created:");
      this.powerBIChoroplethData.slice(0, 3).forEach((feature, index) => {
        console.log(
          `  ${index}: ${feature.countryName} - AdminCode: ${feature.adminCode} - Geometry type: ${feature.geometry?.type}`
        );
      });
    } else {
      console.log(
        "❌ No choropleth features were created - this is the problem!"
      );
    }
  }

  private getChoroplethStyle(feature: any) {
    const choroplethValue = feature.properties?.choropleth_value;
    const adminCode = feature.properties?.adminCode;

    // Check if this is a Power BI feature (has choropleth_value) or base map feature
    if (choroplethValue !== null && choroplethValue !== undefined) {
      // This is a Power BI feature - make it #455E6F
      console.log(
        `🎨 Applying #455E6F color to Power BI feature with adminCode: ${adminCode}`
      );
      return {
        fillColor: "#455E6F", // #455E6F color for Power BI features
        weight: 1,
        opacity: 1,
        color: "#455E6F", // Same #455E6F for border
        fillOpacity: 0.8,
      };
    } else {
      // This is a base map feature - keep neutral color
      console.log(
        `🎨 Applying neutral color to base map feature with adminCode: ${adminCode}`
      );
      return {
        fillColor: "#F2F2F2", // Light gray for base map
        weight: 0.5,
        opacity: 1,
        color: "#666666",
        fillOpacity: 0.3,
      };
    }
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

      // Only add click functionality to Power BI features (those with choropleth_value)
      if (
        feature.properties.choropleth_value !== null &&
        feature.properties.choropleth_value !== undefined
      ) {
        // This is a Power BI feature - make it interactive
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
          mouseover: (e) => {
            // Change cursor to pointer when hovering over Power BI choropleth
            const layer = e.target;
            layer.getElement().style.cursor = "pointer";
          },
          mouseout: (e) => {
            // Reset cursor when leaving Power BI choropleth
            const layer = e.target;
            layer.getElement().style.cursor = "";
          },
        });
        console.log(
          `✅ Added click and hover functionality to Power BI choropleth: ${name}`
        );
      } else {
        // This is a base map feature - no click functionality
        console.log(`ℹ️ Base map choropleth (no click): ${name}`);
      }
    }
  }

  public update(options: VisualUpdateOptions) {
    console.log("🔄 Visual update started");
    const startTime = performance.now();

    if (!options || !options.dataViews || options.dataViews.length === 0) {
      console.log("⚠️  No data views provided, clearing visual");
      this.clearAllData();
      return;
    }

    // Store the current data view for marker visibility checks
    this.currentDataView = options.dataViews[0];

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
      console.log("   • Choropleth data loaded from Power BI geometryString");
      console.log(
        "   • Simple display: Power BI geometry strings shown in red"
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
          rowData: dataView.table.rows[0],
          rowKeys: Object.keys(dataView.table.rows[0] || {}),
          rowValues: Object.values(dataView.table.rows[0] || {}),
          rowLength: Object.keys(dataView.table.rows[0] || {}).length,
        });

        if (dataView.table.rows.length > 1) {
          console.log("🔍 Data sample check - Second row:", {
            rowData: dataView.table.rows[1],
            rowKeys: Object.keys(dataView.table.rows[1] || {}),
            rowValues: Object.values(dataView.table.rows[1] || {}),
            rowLength: Object.keys(dataView.table.rows[1] || {}).length,
          });
        }
      }

      // Check for categorical data (markers)
      console.log("🔍 Categorical data check:", {
        hasCategorical: !!dataView.categorical,
        hasSingle: !!dataView.single,
        hasTable: !!dataView.table,
        tableRowCount: dataView.table?.rows?.length || 0,
        tableColumnCount: dataView.table?.columns?.length || 0,
      });

      // Process data based on what's available
      if (
        dataView.table &&
        dataView.table.rows &&
        dataView.table.rows.length > 0
      ) {
        const values = dataView.table.rows;
        const columns = dataView.table.columns;

        // Create selection IDs for markers FIRST
        this.createSelectionIds(dataView);

        // Process marker data from Power BI (lat/long) AFTER selection IDs are created
        this.processMarkerData(dataView);

        // Process choropleth data from Power BI (geometryString with embedded properties)
        this.processChoroplethDataFromPowerBI(dataView);

        console.log("✅ Data processing complete:", {
          choroplethFeaturesCreated: this.powerBIChoroplethData.length,
          markersCreated: this.markers.length,
          adminCodeMatchingEnabled: false,
        });
      } else {
        console.log("⚠️ No table data available");
        this.clearAllData();
        this.showEmptyState();
        return;
      }

      // Update the visual
      this.updateChoroplethLayer();

      // Update markers visibility based on current Power BI filtering
      this.updateMarkersVisibility(this.currentSelection);

      // Perform empty state check after all data processing is complete
      this.performEmptyStateCheck();

      const updateDuration = performance.now() - startTime;
      console.log(
        `✅ Visual update completed in ${updateDuration.toFixed(
          2
        )}ms - Power BI relationship filtering active`
      );
    } catch (error) {
      console.error("❌ Error during visual update:", error);
    }
  }

  private processChoroplethDataFromPowerBI(dataView: DataView) {
    console.log("🔍 Processing choropleth data from Power BI...");
    this.powerBIChoroplethData = [];

    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      console.log("❌ No table data available for choropleth processing");
      return;
    }

    const columns = dataView.table.columns;
    const values = dataView.table.rows;

    console.log(
      `🔍 Processing ${values.length} rows with ${columns.length} columns`
    );

    // Find column index for choropleth geometry
    const geometryColIndex = columns.findIndex(
      (col) =>
        col.roles?.choroplethGeometry ||
        col.displayName === "geometryString" ||
        col.displayName === "data.geometryString"
    );

    // Find all tooltip column indices (same as marker tooltip)
    const tooltipColIndices = columns
      .map((col, index) => (col.roles?.tooltip ? index : -1))
      .filter((index) => index !== -1);

    if (geometryColIndex === -1) {
      console.log("❌ No choropleth geometry column found");
      return;
    }

    console.log(
      `✅ Found choropleth geometry column at index ${geometryColIndex}`
    );

    if (tooltipColIndices.length > 0) {
      console.log(
        `✅ Found ${
          tooltipColIndices.length
        } tooltip columns: ${tooltipColIndices
          .map((i) => columns[i].displayName)
          .join(", ")}`
      );
    } else {
      console.log("⚠️ No tooltip columns found");
    }

    // Process each row - simple approach
    values.forEach((row, rowIndex) => {
      try {
        const geometryString = String(row[geometryColIndex]);

        if (
          !geometryString ||
          geometryString === "null" ||
          geometryString === "undefined"
        ) {
          return; // Skip empty rows
        }

        console.log(
          `🔍 Processing row ${rowIndex}: geometry length ${geometryString.length}`
        );

        // Parse the geometry string
        let geometryData;
        try {
          geometryData = JSON.parse(geometryString);
        } catch (parseError) {
          console.log(
            `⚠️ Row ${rowIndex}: Could not parse geometry string: ${parseError.message}`
          );
          return;
        }

        if (geometryData && geometryData.type) {
          // Create choropleth tooltip data map with all tooltip fields (same as marker tooltip)
          const tooltipDataMap = new Map<string, any>();

          // Add all tooltip fields from Power BI
          tooltipColIndices.forEach((colIndex) => {
            const value = row[colIndex];
            const columnName = columns[colIndex].displayName;

            if (
              value !== null &&
              value !== undefined &&
              value !== "" &&
              value !== "NA"
            ) {
              tooltipDataMap.set(columnName, value);
              console.log(
                `✅ Added tooltip field for row ${rowIndex}: ${columnName} = ${value}`
              );
            }
          });

          const choroplethData: PowerBIChoroplethData = {
            adminCode: rowIndex, // Simple index-based admin code
            geometry: geometryData,
            choroplethValue: 1, // Simple value for red coloring
            countryName: `Feature ${rowIndex}`,
            isoCode: "",
            continent: "",
            tooltipData: new Map(),
            choroplethTooltipData: tooltipDataMap, // Populate with all tooltip fields
          };

          this.powerBIChoroplethData.push(choroplethData);
          console.log(
            `✅ Created choropleth feature ${rowIndex} with type: ${geometryData.type} and ${tooltipDataMap.size} tooltip fields`
          );
        }
      } catch (error) {
        console.error(`Error processing row ${rowIndex}:`, error);
      }
    });

    console.log(
      `✅ Created ${this.powerBIChoroplethData.length} choropleth features from Power BI data`
    );
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

    // Debug: Show all columns and their roles
    console.log("🔍 All available columns for marker debugging:");
    columns.forEach((col, index) => {
      console.log(
        `  ${index}: "${col.displayName}" - roles: ${JSON.stringify(col.roles)}`
      );
    });

    if (finalLatColIndex >= 0 && finalLngColIndex >= 0) {
      console.log("✅ Found latitude/longitude columns for markers");
      console.log(
        `🔍 Latitude column index: ${finalLatColIndex}, name: ${columns[finalLatColIndex]?.displayName}`
      );
      console.log(
        `🔍 Longitude column index: ${finalLngColIndex}, name: ${columns[finalLngColIndex]?.displayName}`
      );

      // Debug: Show actual values in the first few rows
      console.log("🔍 First 3 rows of lat/lng data:");
      for (let i = 0; i < Math.min(3, values.length); i++) {
        const lat = values[i][finalLatColIndex];
        const lng = values[i][finalLngColIndex];
        console.log(
          `  Row ${i}: lat=${lat} (${typeof lat}), lng=${lng} (${typeof lng})`
        );
      }

      // Check if we have valid coordinate data
      const validCoordinateRows = values.filter((row) => {
        const lat = parseFloat(String(row[finalLatColIndex]));
        const lng = parseFloat(String(row[finalLngColIndex]));
        return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
      });

      console.log(
        `🔍 Found ${validCoordinateRows.length} rows with valid coordinates out of ${values.length} total rows`
      );

      // Debug: Show what the data structure should look like
      console.log("🔍 EXPECTED DATA STRUCTURE for markers + choropleth:");
      console.log("  • Each row should have: lat, lng, geometryString");
      console.log("  • lat/lng should be numbers (e.g., 40.7128, -74.0060)");
      console.log("  • geometryString should contain valid GeoJSON");
      console.log(
        "  • Current issue: lat/lng are 'NA' strings instead of numbers"
      );

      if (validCoordinateRows.length === 0) {
        console.log(
          "⚠️ No valid coordinate data found - skipping marker creation"
        );
        console.log(
          "💡 SOLUTION: Ensure your data source has actual coordinate values, not 'NA'"
        );
        return;
      }

      // Clear existing markers
      this.markers.forEach((marker) => {
        this.markerClusterGroup.removeLayer(marker);
      });
      this.markers = [];

      // Clear the cluster group
      this.markerClusterGroup.clearLayers();

      // Create markers only for rows with valid coordinates
      validCoordinateRows.forEach((row, index) => {
        const lat = parseFloat(String(row[finalLatColIndex]));
        const lng = parseFloat(String(row[finalLngColIndex]));

        // Create custom marker with original blue styling
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

        const marker = L.marker([lat, lng], {
          icon: customMarkerIcon,
        });

        // Add selection ID to marker (use original row index if possible)
        const originalRowIndex = values.indexOf(row);
        if (this.selectionIds && this.selectionIds[originalRowIndex]) {
          (marker as any).options.selectionId =
            this.selectionIds[originalRowIndex];
        }

        // Add click handler for selection
        marker.on("click", (event) => {
          console.log(`Marker clicked: index ${index}`);

          // Build tooltip content from Power BI tooltip fields
          const tooltipContent = this.buildMarkerTooltipContent(row, columns);
          this.showTooltip(tooltipContent, event.latlng);

          // Handle selection if selection ID exists
          if (this.selectionIds && this.selectionIds[originalRowIndex]) {
            this.selectionManager
              .select(this.selectionIds[originalRowIndex])
              .then((ids: ISelectionId[]) => {
                console.log("Selection result:", ids);
                this.currentSelection = ids;
                this.persistentSelection = [...ids];

                if (ids.length === 0) {
                  this.handleMarkerDeselection(originalRowIndex);
                } else {
                  this.updateMarkersVisibility(ids);
                }
              })
              .catch((error) => {
                console.error("Error in marker selection:", error);
                // Fallback: show all markers if selection fails
                if (this.selectionIds && this.selectionIds.length > 0) {
                  console.log(
                    "Falling back to show all markers due to selection error"
                  );
                  this.updateMarkersVisibility(this.selectionIds);
                } else {
                  console.warn("No selection IDs available for fallback");
                  // Show all markers without selection
                  this.markers.forEach((marker) => {
                    if (!this.markerClusterGroup.hasLayer(marker)) {
                      this.markerClusterGroup.addLayer(marker);
                    }
                  });
                }
              });
          } else {
            console.warn("No selection ID found for marker", index);
          }

          L.DomEvent.stopPropagation(event);
        });

        // Add marker to cluster group instead of map
        this.markerClusterGroup.addLayer(marker);
        this.markers.push(marker);

        console.log(`✅ Created marker ${index + 1} at [${lat}, ${lng}]`);
      });

      // Add cluster group to map if not already added
      if (!this.map.hasLayer(this.markerClusterGroup)) {
        this.markerClusterGroup.addTo(this.map);
      }

      console.log(
        `✅ Created ${this.markers.length} markers from ${validCoordinateRows.length} valid coordinate rows`
      );
    } else {
      console.log("⚠️  No valid latitude/longitude columns found for markers");
    }
  }

  private createSelectionIds(dataView: DataView) {
    if (!dataView.table || !dataView.table.rows) {
      return;
    }

    const values = dataView.table.rows;

    // Clear existing selection IDs
    this.selectionIds = [];

    // Create selection IDs for each row
    this.selectionIds = values.map((row, index) => {
      return this.host
        .createSelectionIdBuilder()
        .withTable(dataView.table, index)
        .createSelectionId();
    });

    console.log(
      `✅ Created ${this.selectionIds.length} selection IDs for markers`
    );
  }

  private updateChoroplethLayer() {
    if (!this.choroplethLayer) {
      console.log("❌ No choropleth layer available");
      return;
    }

    // Clear existing choropleth layer
    this.choroplethLayer.clearLayers();

    if (this.powerBIChoroplethData.length === 0) {
      console.log("⚠️ No choropleth data to display");
      return;
    }

    console.log(
      `🔍 Creating ${this.powerBIChoroplethData.length} choropleth features`
    );

    // Create GeoJSON features from Power BI data
    const features = this.powerBIChoroplethData.map((data) => {
      const feature = {
        type: "Feature" as const,
        properties: {
          adminCode: data.adminCode,
          choropleth_value: data.choroplethValue,
          name: data.countryName,
          isoCode: data.isoCode,
          continent: data.continent,
          tooltipData: data.tooltipData,
          choroplethTooltipData: data.choroplethTooltipData, // Add Power BI choropleth tooltip data
        },
        geometry: data.geometry,
      };

      // Debug: Log what we're setting for each feature
      console.log(`🔍 Creating feature for ${data.countryName}:`, {
        adminCode: data.adminCode,
        properties: feature.properties,
      });

      return feature;
    });

    const geoJsonData = {
      type: "FeatureCollection" as const,
      features: features,
    };

    console.log(`🔍 Adding ${features.length} features to choropleth layer`);

    // Add data to choropleth layer
    this.choroplethLayer.addData(geoJsonData);

    // Add to map if not already added
    if (!this.map.hasLayer(this.choroplethLayer)) {
      console.log("🔍 Adding choropleth layer to map");
      this.choroplethLayer.addTo(this.map);
    } else {
      console.log("🔍 Choropleth layer already on map");
    }

    // Don't fit bounds - keep our desired zoom level 2
    // This prevents the jarring zoom-in-then-zoom-out effect
    console.log(
      "🗺️ Keeping map at zoom level 2 - no bounds fitting for choropleth"
    );

    console.log(`✅ Updated choropleth layer with ${features.length} features`);
  }

  private clearAllData() {
    console.log("🧹 clearAllData called - clearing all visual data");

    // Clear markers
    this.markers.forEach((marker) => {
      this.markerClusterGroup.removeLayer(marker);
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

      // Skip markers without selection IDs
      if (!markerSelectionId) {
        console.warn(
          `Marker ${index} has no selection ID, skipping visibility update`
        );
        return;
      }

      // Check if this marker should be visible based on Power BI filtering
      // A marker should be visible if:
      // 1. It's in the current filtered data view, OR
      // 2. It's explicitly selected by the user
      const isInFilteredData = this.isMarkerInFilteredData(markerSelectionId);
      const isExplicitlySelected = selectedIds.some((id) => {
        if (!id) return false;

        if (id.getKey && markerSelectionId.getKey) {
          return id.getKey() === markerSelectionId.getKey();
        }
        if (id.toString && markerSelectionId.toString) {
          return id.toString() === markerSelectionId.toString();
        }
        return id === markerSelectionId;
      });

      const shouldBeVisible = isInFilteredData || isExplicitlySelected;

      console.log(
        `🔍 Marker ${index}: isInFilteredData=${isInFilteredData}, isExplicitlySelected=${isExplicitlySelected}, shouldBeVisible=${shouldBeVisible}`
      );

      if (shouldBeVisible) {
        // Show marker
        if (!this.markerClusterGroup.hasLayer(marker)) {
          this.markerClusterGroup.addLayer(marker);
          visibleMarkers++;
        } else {
          visibleMarkers++;
        }
      } else {
        // Hide marker
        if (this.markerClusterGroup.hasLayer(marker)) {
          this.markerClusterGroup.removeLayer(marker);
          hiddenMarkers++;
        }
      }
    });

    console.log(
      `📊 Marker visibility updated: ${visibleMarkers} visible, ${hiddenMarkers} hidden`
    );

    // Check empty state after marker visibility update
    this.performEmptyStateCheck();
  }

  private isMarkerInFilteredData(markerSelectionId: ISelectionId): boolean {
    // In Power BI, when filters are applied, the dataView.table.rows might not change
    // Instead, we should check if this marker's selection ID is in the current Power BI selection
    // If there's no current selection, all markers should be visible (no filter applied)

    // Check if there's a current selection
    if (!this.currentSelection || this.currentSelection.length === 0) {
      console.log(
        "🔍 isMarkerInFilteredData: No current selection - all markers should be visible"
      );
      return true; // No filter applied, show all markers
    }

    // Check if this marker's selection ID matches any of the currently selected items
    const isSelected = this.currentSelection.some((selectedId) => {
      if (!selectedId || !markerSelectionId) return false;

      if (selectedId.getKey && markerSelectionId.getKey) {
        return selectedId.getKey() === markerSelectionId.getKey();
      }
      if (selectedId.toString && markerSelectionId.toString) {
        return selectedId.toString() === markerSelectionId.toString();
      }
      return selectedId === markerSelectionId;
    });

    console.log(
      `🔍 isMarkerInFilteredData: Marker ${
        isSelected ? "IS" : "is NOT"
      } in current selection`
    );
    return isSelected;
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

    // PRIORITY 1: Add all Power BI tooltip fields (same as marker tooltip)
    if (feature.properties?.choroplethTooltipData) {
      const choroplethTooltipData = feature.properties.choroplethTooltipData;
      if (
        choroplethTooltipData instanceof Map &&
        choroplethTooltipData.size > 0
      ) {
        console.log(
          `🔍 Building tooltip for ${name} with Power BI tooltip data:`,
          choroplethTooltipData
        );

        // Display all tooltip fields from Power BI (same as marker tooltip)
        choroplethTooltipData.forEach((value, key) => {
          if (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            value !== "NA"
          ) {
            // Show the actual column name from Power BI (not hardcoded "Choropleth Tooltip")
            tooltipParts.push(
              `<div class="tooltip-row"><span class="field-name">${key}</span><span class="field-value">${value}</span></div>`
            );
          }
        });

        // If we have Power BI tooltip data, return it immediately
        return tooltipParts.join("");
      }
    }

    // PRIORITY 2: Add choropleth value if available
    if (
      feature.properties?.choropleth_value !== null &&
      feature.properties?.choropleth_value !== undefined
    ) {
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Value</span><span class="field-value">${feature.properties.choropleth_value}</span></div>`
      );
    }

    // PRIORITY 3: Add legacy tooltip data from custom.geo.json (fallback only)
    if (feature.properties?.tooltipData) {
      const tooltipData = feature.properties.tooltipData;
      if (tooltipData instanceof Map && tooltipData.size > 0) {
        console.log(
          `🔍 Building tooltip for ${name} with legacy tooltip data:`,
          tooltipData
        );
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

  private buildMarkerTooltipContent(row: any[], columns: any[]): string {
    const tooltipParts = [];

    // Find tooltip column indices
    const tooltipColIndices = columns
      .map((col, index) => (col.roles?.tooltip ? index : -1))
      .filter((index) => index !== -1);

    // Add tooltip data from Power BI tooltip fields
    if (tooltipColIndices.length > 0) {
      tooltipColIndices.forEach((colIndex) => {
        const value = row[colIndex];
        const columnName = columns[colIndex].displayName;

        if (
          value !== null &&
          value !== undefined &&
          value !== "" &&
          value !== "NA"
        ) {
          tooltipParts.push(
            `<div class="tooltip-row"><span class="field-name">${columnName}</span><span class="field-value">${value}</span></div>`
          );
        }
      });
    }

    // If no tooltip data found, show coordinates as fallback
    if (tooltipParts.length === 0) {
      const latColIndex = columns.findIndex((col) => col.roles?.latitude);
      const lngColIndex = columns.findIndex((col) => col.roles?.longitude);

      if (latColIndex >= 0 && lngColIndex >= 0) {
        const lat = row[latColIndex];
        const lng = row[lngColIndex];
        tooltipParts.push(
          `<div class="tooltip-row"><span class="field-name">Latitude</span><span class="field-value">${lat}</span></div>`
        );
        tooltipParts.push(
          `<div class="tooltip-row"><span class="field-name">Longitude</span><span class="field-value">${lng}</span></div>`
        );
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
        this.markerClusterGroup.hasLayer(marker)
      ).length;
      const hasOriginalData = this.selectionIds.length > 0;
      const hasChoroplethData = this.powerBIChoroplethData.length > 0;

      // Check if there's actually visible data on the map
      const hasVisibleData = visibleMarkers > 0 || hasChoroplethData;

      // Also check if there's data available but just filtered out
      const hasDataAvailable = totalMarkers > 0 || hasChoroplethData;

      const result =
        hasVisibleData || (hasDataAvailable && !this.currentSelection?.length);

      console.log("Distribution data check:", {
        totalMarkers,
        visibleMarkers,
        hasChoroplethData,
        hasOriginalData,
        hasVisibleData,
        hasDataAvailable,
        currentSelectionLength: this.currentSelection?.length || 0,
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
        return (
          this.markers[index] &&
          this.markerClusterGroup.hasLayer(this.markers[index])
        );
      });
    } catch (error) {
      console.error("Error getting current data context:", error);
      return [];
    }
  }

  private handleMarkerDeselection(clickedMarkerIndex: number): void {
    try {
      console.log(`Handling deselection for marker ${clickedMarkerIndex}`);

      // Safety check for selection IDs
      if (this.selectionIds && this.selectionIds.length > 0) {
        this.updateMarkersVisibility(this.selectionIds);
      } else {
        console.warn("No selection IDs available for deselection handling");
        // Show all markers without selection
        this.markers.forEach((marker) => {
          if (!this.markerClusterGroup.hasLayer(marker)) {
            this.markerClusterGroup.addLayer(marker);
          }
        });
      }
    } catch (error) {
      console.error("Error handling marker deselection:", error);
      // Fallback: show all markers
      this.markers.forEach((marker) => {
        if (!this.markerClusterGroup.hasLayer(marker)) {
          this.markerClusterGroup.addLayer(marker);
        }
      });
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
      lineCap: "round" as const,
      lineJoin: "round" as const,
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

      this.disputedBordersLayer.addData(bordersData as any);

      if (!this.map.hasLayer(this.disputedBordersLayer)) {
        this.disputedBordersLayer.addTo(this.map);
      }

      console.log("Disputed borders loaded successfully");
    } catch (error) {
      console.error("Error loading disputed borders:", error);
    }
  }
}
