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
import customGeoJSON from "./custom.geo.json";
import { VisualFormattingSettingsModel } from "./settings";
import notListedPositiveSvg from "../assets/not_listed_positive.svg";
import notListedNegativeSvg from "../assets/not_listed_negative.svg";
import notListedNotAvailableSvg from "../assets/not_listed_not available.svg";
import positiveSvg from "../assets/positive.svg";
import negativeSvg from "../assets/negative.svg";
import notAvailableSvg from "../assets/notavailable.svg";

export class Visual implements IVisual {
  private target: HTMLElement;
  private map: L.Map;
  private selectionManager: ISelectionManager;
  private host: powerbiVisualsApi.extensibility.visual.IVisualHost;
  private markers: L.Marker[] = [];
  private selectionIds: ISelectionId[] = [];
  private markerClusterGroup: L.MarkerClusterGroup;
  private baseMapLayer: L.GeoJSON;
  private disputedBordersLayer: L.GeoJSON;
  private tooltipDiv: HTMLElement;
  private emptyStateDiv: HTMLElement;
  private loaderDiv: HTMLElement;
  private currentSelection: ISelectionId[] = [];
  private persistentSelection: ISelectionId[] = [];
  private currentDataView: DataView;
  private settings: VisualFormattingSettingsModel;
  private geoJsonFeatures: any[] = []; // Store GeoJSON features for gaul_code lookup
  private isLoading: boolean = false;
  private loadingOperations: Set<string> = new Set();
  private mapLoaded: boolean = false; // Track if map is fully loaded
  private debugLocationLogCount: number = 0; // Limit noisy debug logs
  private debugLocationValueLogCount: number = 0; // Limit raw value logs
  private lastSelectedClusterMarkers: Set<L.Marker> = new Set(); // Track markers from last selected cluster
  private lastSelectedClusterSelectionIds: ISelectionId[] = []; // Track selection IDs from last selected cluster

  constructor(options: VisualConstructorOptions) {
    this.target = options.element;
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager();

    // Initialize settings
    this.settings = new VisualFormattingSettingsModel();

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
      overflow: hidden;
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

    // Create loader div
    this.loaderDiv = document.createElement("div");
    this.loaderDiv.className = "loader";
    this.loaderDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: none;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 14px;
      color: #333;
      text-align: center;
    `;
    this.loaderDiv.innerHTML = `
      <div style="margin-bottom: 10px;">
        <div style="
          width: 24px;
          height: 24px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        "></div>
      </div>
      Loading map data...
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;
    this.target.appendChild(this.loaderDiv);

    this.map = L.map(mapElement, {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      maxZoom: 5,
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
        this.showOnlyCurrentContextMarkers();
      }
    });

    // Initialize base map layer from custom.geo.json
    this.baseMapLayer = L.geoJSON(null, {
      style: () => this.getBaseMapStyle(),
      onEachFeature: (feature, layer) =>
        this.onEachBaseMapFeature(feature, layer),
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
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: true,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 18,
      removeOutsideVisibleBounds: true,
      animate: true,
      animateAddingMarkers: true,
      iconCreateFunction: (cluster: any) => {
        return this.createClusterIcon(cluster);
      },
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
      this.handleClusterClick(e);
    });

    this.markerClusterGroup.on("animationend", () => {
      // Re-apply cluster opacity after clustering animations
      this.updateClusterOpacity(this.currentSelection || []);

      // Also check if marker elements are now available and apply opacity (after spiderfy)
      if (this.currentSelection.length > 0) {
        setTimeout(() => {
          this.applyOpacityToSelectedMarkers();
        }, 200);
      }
    });

    // Hide Leaflet attribution and any flags
    const style = document.createElement("style");
    style.textContent = `
      .leaflet-attribution-flag {
        display: none !important;
      }
      
      .tooltip-title {
        font-weight: bold;
        color: #2D2D2D;
        font-family: Arial, sans-serif;
        font-size: 14px;
        margin-bottom: 8px;
        line-height: 1.4;
      }
      
      .tooltip-paragraph {
        color: #2D2D2D;
        font-family: Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        word-wrap: break-word;
      }
      
      .tooltip-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        font-family: Arial, sans-serif;
        font-size: 12px;
        border-bottom: 1px solid #e0e0e0;
      }
      
      .tooltip-row:last-child {
        border-bottom: none;
      }
      
      .field-name {
        font-weight: normal;
        color: #2D2D2D;
        font-family: Arial, sans-serif;
        font-size: 12px;
        margin-right: 10px;
      }
      
      .field-value {
        font-weight: bold;
        color: #2D2D2D;
        text-align: right;
        font-family: Arial, sans-serif;
        font-size: 12px;
        word-wrap: break-word;
        max-width: 60%;
      }
      
      /* Scrollbar styling for tooltip */
      .custom-tooltip div::-webkit-scrollbar {
        width: 6px;
      }
      
      .custom-tooltip div::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 3px;
      }
      
      .custom-tooltip div::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 3px;
      }
      
      .custom-tooltip div::-webkit-scrollbar-thumb:hover {
        background: #555;
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
      
      /* Marker cluster styling - remove default yellow styling, use inline styles from iconCreateFunction */
      .marker-cluster-small,
      .marker-cluster-medium,
      .marker-cluster-large {
        background: transparent !important;
        border: none !important;
      }
      
      .marker-cluster-small div,
      .marker-cluster-medium div,
      .marker-cluster-large div {
        /* Styles are applied via inline styles in createClusterIcon */
      }
      
      .marker-cluster-small:hover,
      .marker-cluster-medium:hover,
      .marker-cluster-large:hover {
        background: transparent !important;
        border: none !important;
      }
    `;
    document.head.appendChild(style);

    // Disputed borders will be loaded from URL if provided in settings

    // Setup custom zoom controls
    this.setupZoomControls();
  }

  // Helper: build tooltip content with optional dividers every 3 lines when > 3 rows
  private buildTooltipWithOddDividers(rows: string[]): string {
    const parts: string[] = [];
    // Only show dividers if we have more than 3 rows
    const shouldInsertDividers = rows.length > 3;
    for (let i = 0; i < rows.length; i++) {
      parts.push(rows[i]);
      // Insert divider after every 3rd row (1-based: after rows 3, 6, 9, ...) but not after the last row
      // i % 3 === 2 means after indices 2, 5, 8, etc. (after the 3rd, 6th, 9th rows)
      if (shouldInsertDividers && i % 3 === 2 && i < rows.length - 1) {
        parts.push('<div class="tooltip-divider"></div>');
      }
    }
    return parts.join("");
  }

  // Helper: get column index by data role
  private getColumnIndexByRole(columns: any[], roleName: string): number {
    return columns.findIndex(
      (col) => col.roles && (col.roles as any)[roleName]
    );
  }

  // Helper: check if marker's Ref ID exists in the Ref ID measure string
  private isMarkerRefIdInMeasure(
    markerRefId: any,
    refIdMeasureString: string
  ): boolean {
    if (!markerRefId || !refIdMeasureString) {
      return true; // If no measure string, show all markers
    }

    // Convert marker Ref ID to string and trim
    const markerRefIdStr = String(markerRefId).trim();

    // Split the measure string by comma and check if marker Ref ID exists
    const refIdList = refIdMeasureString
      .split(",")
      .map((id) => String(id).trim());

    return refIdList.includes(markerRefIdStr);
  }

  // Get marker icon SVG based on REGULATORYSTATUSVALUE and PEMOVALUE
  private getMarkerIcon(regulatoryStatus: string, pemoValue: string): string {
    const regulatoryStatusUpper = regulatoryStatus.toUpperCase();
    const pemoValueUpper = pemoValue.toUpperCase();

    // Check if REGULATORYSTATUSVALUE is "Not listed"
    if (regulatoryStatusUpper === "NOT LISTED") {
      if (pemoValueUpper === "POSITIVE") {
        return notListedPositiveSvg;
      } else if (pemoValueUpper === "NEGATIVE") {
        return notListedNegativeSvg;
      } else if (pemoValueUpper === "NOT AVAILABLE") {
        return notListedNotAvailableSvg;
      }
    } else {
      // For any other REGULATORYSTATUSVALUE
      if (pemoValueUpper === "POSITIVE") {
        return positiveSvg;
      } else if (pemoValueUpper === "NEGATIVE") {
        return negativeSvg;
      } else if (pemoValueUpper === "NOT AVAILABLE") {
        return notAvailableSvg;
      }
    }

    // Default fallback to positive icon if no match
    return positiveSvg;
  }

  // Get cluster colors based on REGULATORYSTATUSVALUE and PEMOVALUE
  private getClusterColors(
    regulatoryStatus: string,
    pemoValue: string
  ): {
    backgroundColor: string;
    centerColor: string;
  } {
    const regulatoryStatusUpper = regulatoryStatus.toUpperCase();
    const pemoValueUpper = pemoValue.toUpperCase();

    let backgroundColor = "#fff"; // Default white
    let centerColor = "#768D48"; // Default positive green

    // Check if REGULATORYSTATUSVALUE is "Not listed"
    if (regulatoryStatusUpper === "NOT LISTED") {
      backgroundColor = "#3C3D3C"; // Dark gray background

      // Determine center color based on PEMOVALUE
      if (pemoValueUpper === "POSITIVE") {
        centerColor = "#768D48"; // Green
      } else if (pemoValueUpper === "NEGATIVE") {
        centerColor = "#E4B655"; // Yellow/gold
      } else if (pemoValueUpper === "NOT AVAILABLE") {
        centerColor = "#3C3D3C"; // Dark gray (same as background)
      }
    } else {
      // For any other REGULATORYSTATUSVALUE
      backgroundColor = "#fff"; // White background

      // Determine center color based on PEMOVALUE
      if (pemoValueUpper === "POSITIVE") {
        centerColor = "#768D48"; // Green
      } else if (pemoValueUpper === "NEGATIVE") {
        centerColor = "#E4B655"; // Yellow/gold
      } else if (pemoValueUpper === "NOT AVAILABLE") {
        centerColor = "#fff"; // White (same as background)
      }
    }

    return { backgroundColor, centerColor };
  }

  // Create cluster icon with custom colors
  private createClusterIcon(cluster: any): L.DivIcon {
    const count = cluster.getChildCount();
    const markers = cluster.getAllChildMarkers();

    // Get regulatory status and pemo value from first marker (or determine from all markers)
    let regulatoryStatus = "";
    let pemoValue = "";

    if (markers.length > 0) {
      const firstMarker = markers[0] as any;
      regulatoryStatus = firstMarker.regulatoryStatus || "";
      pemoValue = firstMarker.pemoValue || "";
    }

    // Get cluster colors based on the values
    const colors = this.getClusterColors(regulatoryStatus, pemoValue);

    // Determine cluster size class
    let size = "small";
    let sizePx = 30;
    if (count > 100) {
      size = "large";
      sizePx = 50;
    } else if (count > 10) {
      size = "medium";
      sizePx = 40;
    }

    // Create custom cluster icon with dynamic colors - only two circles
    const className = `marker-cluster marker-cluster-${size}`;
    const html = `
      <div style="
        background-color: ${colors.backgroundColor} !important;
        border: none !important;
        border-radius: 50%;
        width: ${sizePx + 20}px;
        height: ${sizePx + 20}px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 1;
        box-shadow: none;
        padding: 0;
        margin: 0;
      ">
        <div style="
          background-color: ${colors.centerColor} !important;
          border: none !important;
          border-radius: 50%;
          width: ${sizePx}px;
          height: ${sizePx}px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${
            colors.centerColor === "#fff" || colors.centerColor === "#3C3D3C"
              ? "#000"
              : "#fff"
          };
          font-weight: bold;
          font-size: ${
            size === "large" ? "13px" : size === "medium" ? "12px" : "11px"
          };
          box-shadow: none;
          padding: 0;
          margin: 0;
        ">
          ${count}
        </div>
      </div>
    `;

    return L.divIcon({
      html: html,
      className: className,
      iconSize: L.point(sizePx + 20, sizePx + 20),
    });
  }

  // Helper: extract latitude and longitude for a row from separate fields
  private getLatLngForRow(
    row: any[],
    columns: any[]
  ): {
    latitude?: number;
    longitude?: number;
  } {
    const latIdx = this.getColumnIndexByRole(columns, "latitude");
    const lngIdx = this.getColumnIndexByRole(columns, "longitude");

    const result: any = {};

    if (latIdx >= 0 && row[latIdx] !== undefined && row[latIdx] !== null) {
      const lat = parseFloat(String(row[latIdx]));
      if (!isNaN(lat)) result.latitude = lat;
    }
    if (lngIdx >= 0 && row[lngIdx] !== undefined && row[lngIdx] !== null) {
      const lng = parseFloat(String(row[lngIdx]));
      if (!isNaN(lng)) result.longitude = lng;
    }

    return result;
  }

  private getBaseMapStyle() {
    return {
      fillColor: "#F2F2F2",
      weight: 0.5,
      opacity: 1,
      color: "#666666",
      fillOpacity: 1,
    };
  }

  private onEachBaseMapFeature(feature: any, layer: L.Layer) {
    if (feature.properties) {
      const name = feature.properties.name || "Unknown Region";

      // Base map features are completely non-interactive - no hover effects, no click functionality
    }
  }

  // Method to reset map to desired zoom level
  private resetToDefaultView() {
    if (this.map) {
      this.map.setView([20, 0], 2);
    }
  }

  // Handle cluster click event
  private handleClusterClick(e: any) {
    const cluster = e.layer;
    const currentZoom = this.map.getZoom();
    const maxZoom = this.map.getMaxZoom();

    // Check if zooming to bounds would exceed max zoom
    if (currentZoom >= maxZoom) {
      // Get all child markers from the cluster
      const childMarkers = cluster.getAllChildMarkers();

      if (childMarkers.length > 0) {
        // Collect marker information first
        const clusterMarkerInfo = this.collectClusterMarkerInfo(childMarkers);

        // Build tooltip using the collected tooltip data
        const tooltipContent =
          this.buildClusterTooltipFromMarkerInfo(clusterMarkerInfo);
        if (tooltipContent) {
          this.showTooltip(tooltipContent, e.latlng);
        }

        // Store this cluster's markers for deselection logic
        this.lastSelectedClusterMarkers = new Set(childMarkers);
        // Extract selection IDs from cluster marker info
        this.lastSelectedClusterSelectionIds = clusterMarkerInfo
          .map((info) => info.selectionId)
          .filter((id) => id !== undefined) as ISelectionId[];

        // Apply filtering using the collected selection IDs
        this.applyClusterFilteringWithInfo(childMarkers, clusterMarkerInfo);

        // At max zoom, don't prevent default - let Leaflet spiderfy markers automatically
        // The spiderfyOnMaxZoom option should handle this, but we need to not block it
        if (currentZoom < maxZoom) {
          // Not at max zoom - prevent default zoom behavior
          e.originalEvent.preventDefault();
          e.originalEvent.stopPropagation();
        }

        // At max zoom, manually trigger spiderfy to ensure markers expand
        if (currentZoom >= maxZoom) {
          setTimeout(() => {
            try {
              // Try to manually trigger spiderfy - cluster should have this method
              if ((cluster as any).spiderfy) {
                (cluster as any).spiderfy();
              } else if ((this.markerClusterGroup as any).spiderfy) {
                // Try via markerClusterGroup
                (this.markerClusterGroup as any).spiderfy(cluster);
              }
            } catch (spiderfyErr) {}
          }, 50);
        }

        // Hide markers when they appear after spiderfy
        // Check multiple times as spiderfy animation happens
        setTimeout(() => {
          this.hideClusterMarkers(childMarkers);
        }, 100);

        setTimeout(() => {
          this.hideClusterMarkers(childMarkers);
        }, 300);

        setTimeout(() => {
          this.hideClusterMarkers(childMarkers);
        }, 500);

        setTimeout(() => {
          this.hideClusterMarkers(childMarkers);
        }, 800);

        setTimeout(() => {
          this.hideClusterMarkers(childMarkers);
        }, 1200);

        // Also hide markers on animation end events
        const hideMarkersAfterAnimation = () => {
          this.hideClusterMarkers(childMarkers);
        };
        this.markerClusterGroup.once("animationend", hideMarkersAfterAnimation);

        // Continuously monitor and hide markers if they become visible
        // Stop monitoring after 5 seconds (by then they should be stable)
        const monitorInterval = setInterval(() => {
          this.hideClusterMarkers(childMarkers);
        }, 300);
        setTimeout(() => {
          clearInterval(monitorInterval);
        }, 5000);

        // After applying filter, check for marker elements after delays
        // Check multiple times as spiderfy animation happens
        setTimeout(() => {
          this.applyOpacityToSelectedMarkers();
        }, 200);

        setTimeout(() => {
          this.applyOpacityToSelectedMarkers();
        }, 500);

        setTimeout(() => {
          this.applyOpacityToSelectedMarkers();
        }, 1000);
      }
    }
  }

  // Helper function to get a stable key from a selection ID for comparison
  private getSelectionIdKey(id: ISelectionId): string {
    if (!id) return "";
    if (id.getKey) {
      try {
        return String(id.getKey());
      } catch {
        // Fallback
      }
    }
    if (id.toString) {
      try {
        return String(id.toString());
      } catch {
        // Fallback
      }
    }
    return String(id);
  }

  // Collect comprehensive information about all markers in a cluster
  private collectClusterMarkerInfo(markers: L.Marker[]): Array<{
    marker: L.Marker;
    markerIndex: number;
    selectionId: ISelectionId;
    selectionKey: string;
    tooltipData?: any[];
    tooltipColumnNames?: string[];
  }> {
    const clusterMarkerInfo: Array<{
      marker: L.Marker;
      markerIndex: number;
      selectionId: ISelectionId;
      selectionKey: string;
      tooltipData?: any[];
      tooltipColumnNames?: string[];
    }> = [];

    markers.forEach((marker, clusterMarkerIdx) => {
      const markerIndex = this.markers.indexOf(marker);
      let selectionId = (marker as any).options?.selectionId;
      const tooltipData = (marker as any).tooltipData;
      const tooltipColumnNames = (marker as any).tooltipColumnNames;

      // If not found, find the marker index and use this.selectionIds for consistency
      if (
        !selectionId &&
        markerIndex >= 0 &&
        this.selectionIds &&
        this.selectionIds[markerIndex]
      ) {
        selectionId = this.selectionIds[markerIndex];
        (marker as any).options.selectionId = selectionId;
      }

      if (selectionId) {
        const selectionKey = this.getSelectionIdKey(selectionId);

        clusterMarkerInfo.push({
          marker,
          markerIndex,
          selectionId,
          selectionKey,
          tooltipData,
          tooltipColumnNames,
        });
      }
    });

    return clusterMarkerInfo;
  }

  // Build cluster tooltip from collected marker tooltip data
  private buildClusterTooltipFromMarkerInfo(
    markerInfo: Array<{
      marker: L.Marker;
      markerIndex: number;
      selectionId: ISelectionId;
      selectionKey: string;
      tooltipData?: any[];
      tooltipColumnNames?: string[];
    }>
  ): string {
    if (markerInfo.length === 0) {
      return "";
    }

    // Collect all tooltip data and column names from markers
    const allTooltipData: any[][] = [];
    let columnNames: string[] | undefined = undefined;
    markerInfo.forEach((info) => {
      if (info.tooltipData && info.tooltipData.length > 0) {
        allTooltipData.push(info.tooltipData);
        // Use column names from first marker that has them
        if (!columnNames && info.tooltipColumnNames) {
          columnNames = info.tooltipColumnNames;
        }
      }
    });

    if (allTooltipData.length === 0) {
      return "";
    }

    // If only one marker, use its tooltip directly
    if (allTooltipData.length === 1) {
      return this.buildTooltipContent(allTooltipData[0], columnNames);
    }

    // For multiple markers, show all fields from all markers
    // Group by field name and show all values
    const fieldMap = new Map<string, Set<string>>();

    allTooltipData.forEach((tooltipData) => {
      for (let i = 0; i < tooltipData.length; i++) {
        if (tooltipData[i] !== undefined && tooltipData[i] !== null) {
          const value = String(tooltipData[i]).trim();
          if (value) {
            const fieldName =
              columnNames && columnNames[i] ? columnNames[i] : `Field ${i + 1}`;
            if (!fieldMap.has(fieldName)) {
              fieldMap.set(fieldName, new Set());
            }
            fieldMap.get(fieldName)!.add(value);
          }
        }
      }
    });

    // Build tooltip showing field name: values
    let html = "";
    fieldMap.forEach((values, fieldName) => {
      const uniqueValues = Array.from(values);
      const valueText =
        uniqueValues.length === 1 ? uniqueValues[0] : uniqueValues.join(", ");
      html += `<div class="tooltip-row"><span class="field-name">${this.escapeHtml(
        fieldName
      )}</span><span class="field-value">${this.escapeHtml(
        valueText
      )}</span></div>`;
    });

    return html || "";
  }

  // Apply filtering based on markers in the cluster (using pre-collected info)
  private applyClusterFilteringWithInfo(
    markers: L.Marker[],
    markerInfo: Array<{
      marker: L.Marker;
      markerIndex: number;
      selectionId: ISelectionId;
      selectionKey: string;
      tooltipData?: any[];
    }>
  ) {
    // Extract selection IDs from the pre-collected marker info
    const clusterSelectionIds: ISelectionId[] = markerInfo.map(
      (info) => info.selectionId
    );

    // If we have selection IDs, apply filtering
    if (clusterSelectionIds.length > 0) {
      // Get keys for all cluster selection IDs for comparison
      const clusterKeys = new Set(
        clusterSelectionIds.map((id) => this.getSelectionIdKey(id))
      );

      // Get keys from current selection
      const currentSelectionKeys = new Set(
        this.currentSelection.map((id) => this.getSelectionIdKey(id))
      );

      // Check if ALL cluster marker keys are in the current selection
      const allClusterKeysSelected = Array.from(clusterKeys).every((key) =>
        currentSelectionKeys.has(key)
      );

      // If all cluster markers are selected, toggle them off
      if (allClusterKeysSelected && this.currentSelection.length > 0) {
        // All cluster markers are already selected, so deselect them (toggle off)
        this.selectionManager
          .clear()
          .then(() => {
            this.clearSelectionAndCluster();
          })
          .catch(() => {
            // Error clearing selection
          });
      } else {
        // Select all markers in the cluster to apply filtering
        this.selectionManager
          .clear()
          .then(() => {
            // Update our internal state with all cluster selection IDs
            this.currentSelection = [...clusterSelectionIds] as ISelectionId[];
            this.persistentSelection = [
              ...clusterSelectionIds,
            ] as ISelectionId[];

            // Update marker visibility immediately so UI reflects selection
            this.updateMarkersVisibility(
              this.currentSelection as ISelectionId[]
            );

            // Multi-select approach based on Stack Overflow solution:
            // https://stackoverflow.com/questions/37388223/how-to-multiselect-with-selection-manager-in-power-bi-custom-visual
            // The select() method supports an isMultiSelect parameter (second argument)
            // Already cleared above, now select each item with isMultiSelect=true for subsequent items
            if (clusterSelectionIds.length > 1) {
              // Select first item (we already cleared above, so this is the first selection)
              let selectionChain = this.selectionManager.select(
                clusterSelectionIds[0]
              );

              // Select remaining items with isMultiSelect=true to accumulate selections
              // This tells Power BI to keep previous selections instead of replacing them
              for (let i = 1; i < clusterSelectionIds.length; i++) {
                selectionChain = selectionChain.then(() => {
                  // Pass true as second parameter to enable multi-select accumulation
                  return this.selectionManager.select(
                    clusterSelectionIds[i],
                    true
                  );
                });
              }

              selectionChain
                .then(() => {
                  // Update visibility after all selections complete (Power BI may have filtered data)
                  this.updateMarkersVisibility(
                    this.currentSelection as ISelectionId[]
                  );
                })
                .catch(() => {
                  // Even if selection fails, update visibility
                  this.updateMarkersVisibility(
                    this.currentSelection as ISelectionId[]
                  );
                });
            } else if (clusterSelectionIds.length === 1) {
              // Single selection
              this.selectionManager
                .select(clusterSelectionIds[0])
                .then(() => {
                  this.updateMarkersVisibility(
                    this.currentSelection as ISelectionId[]
                  );
                })
                .catch(() => {
                  this.updateMarkersVisibility(
                    this.currentSelection as ISelectionId[]
                  );
                });
            }
          })
          .catch(() => {
            // Error clearing selection
          });
      }
    }
  }

  // Select all rows matching a GAUL admin code and apply Power BI filtering

  // Get country name from admin code using GeoJSON features
  private getCountryNameFromAdminCode(adminCode: string): string | null {
    if (!this.geoJsonFeatures || this.geoJsonFeatures.length === 0) {
      return null;
    }

    const feature = this.geoJsonFeatures.find((feature) => {
      const gaulCode = feature.properties?.gaul_code;
      return gaulCode && String(gaulCode) === adminCode;
    });

    if (feature) {
      return (
        feature.properties?.gaul0_name ||
        feature.properties?.disp_en ||
        feature.properties?.name ||
        null
      );
    }

    return null;
  }

  // Build cluster tooltip content

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
            if (currentZoom >= 5) {
              // If we're at or above zoom level 5, reset to 5
              setTimeout(() => {
                this.map.setZoom(5);
              }, 100);
            }
          });
        }
      }
    }
  }

  private loadBaseMap() {
    // Check if user provided a custom base map URL
    const baseMapUrl = this.settings?.mapSettingsCard?.baseMapUrl?.value;

    if (baseMapUrl && baseMapUrl.trim() !== "") {
      this.hideBaseMapMessage();
      this.loadMapDataFromUrl(baseMapUrl);

      // Add markers to map now that base map is loaded
      if (
        this.markers.length > 0 &&
        !this.map.hasLayer(this.markerClusterGroup)
      ) {
        this.markerClusterGroup.addTo(this.map);
      }
    } else {
      // Remove markers from map if no URL
      if (this.map.hasLayer(this.markerClusterGroup)) {
        this.map.removeLayer(this.markerClusterGroup);
      }
      this.showBaseMapMessage();
    }
  }

  private async loadDisputedBordersFromUrl(url: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const geoData = await response.json();

      if (!geoData.type || !geoData.features) {
        throw new Error("Invalid GeoJSON format - missing type or features");
      }

      if (this.disputedBordersLayer) {
        this.disputedBordersLayer.clearLayers();
      }

      this.disputedBordersLayer.addData(geoData as any);

      if (!this.map.hasLayer(this.disputedBordersLayer)) {
        this.disputedBordersLayer.addTo(this.map);
      }
    } catch (error) {
      // If URL fails, just clear the layer and don't show anything
      if (this.disputedBordersLayer) {
        this.disputedBordersLayer.clearLayers();
        if (this.map.hasLayer(this.disputedBordersLayer)) {
          this.map.removeLayer(this.disputedBordersLayer);
        }
      }
    }
  }

  private handleDisputedBordersUrlChange() {
    // Only proceed if map is fully loaded
    if (!this.mapLoaded) {
      return;
    }

    const currentUrl =
      this.settings?.mapSettingsCard?.disputedBordersUrl?.value;

    if (!(this as any).lastDisputedBordersUrl) {
      (this as any).lastDisputedBordersUrl = currentUrl || "";
      if (currentUrl && currentUrl.trim() !== "") {
        this.loadDisputedBordersFromUrl(currentUrl);
      } else {
        // Clear layer if no URL provided
        if (this.disputedBordersLayer) {
          this.disputedBordersLayer.clearLayers();
          if (this.map.hasLayer(this.disputedBordersLayer)) {
            this.map.removeLayer(this.disputedBordersLayer);
          }
        }
      }
      return;
    }
    if ((this as any).lastDisputedBordersUrl !== (currentUrl || "")) {
      (this as any).lastDisputedBordersUrl = currentUrl || "";
      if (this.disputedBordersLayer) {
        this.disputedBordersLayer.clearLayers();
      }
      if (currentUrl && currentUrl.trim() !== "") {
        this.loadDisputedBordersFromUrl(currentUrl);
      } else {
        // Clear layer if no URL provided
        if (this.disputedBordersLayer) {
          this.disputedBordersLayer.clearLayers();
          if (this.map.hasLayer(this.disputedBordersLayer)) {
            this.map.removeLayer(this.disputedBordersLayer);
          }
        }
      }
    }
  }

  private async loadMapDataFromUrl(url: string) {
    try {
      this.showLoader("baseMap");
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const geoData = await response.json();

      // Validate GeoJSON structure
      if (!geoData.type || !geoData.features) {
        throw new Error("Invalid GeoJSON format - missing type or features");
      }

      // Store GeoJSON features for gaul_code lookup
      this.geoJsonFeatures = geoData.features;

      // Add to base map layer
      this.baseMapLayer.addData(geoData);
      this.map.addLayer(this.baseMapLayer);

      // Mark map as loaded
      this.mapLoaded = true;

      // Load disputed borders from URL only after map is fully loaded
      setTimeout(() => {
        this.handleDisputedBordersUrlChange();
      }, 100);

      this.hideLoader("baseMap");
    } catch (error) {
      this.hideLoader("baseMap");
      this.showUrlErrorMessage(url, error.message);
    }
  }

  private updateSettingsFromPowerBI(options: VisualUpdateOptions) {
    // Access settings from the dataView metadata
    const dataView = options.dataViews[0];

    if (dataView && dataView.metadata && dataView.metadata.objects) {
      const mapSettings = dataView.metadata.objects.mapSettings as any;

      if (mapSettings) {
        // Base map URL
        const newBaseUrl = mapSettings.baseMapUrl
          ? String(mapSettings.baseMapUrl)
          : "";
        const currentBaseUrl = this.settings.mapSettingsCard.baseMapUrl.value;
        this.settings.mapSettingsCard.baseMapUrl.value = newBaseUrl;
        if (currentBaseUrl !== newBaseUrl) {
          setTimeout(() => {
            this.handleBaseMapUrlChange();
          }, 50);
        }

        // Disputed borders URL
        const newDisputedUrl = mapSettings.disputedBordersUrl
          ? String(mapSettings.disputedBordersUrl)
          : "";
        const currentDisputedUrl =
          this.settings.mapSettingsCard.disputedBordersUrl?.value || "";
        this.settings.mapSettingsCard.disputedBordersUrl.value = newDisputedUrl;
        if (currentDisputedUrl !== newDisputedUrl) {
          setTimeout(() => {
            this.handleDisputedBordersUrlChange();
          }, 50);
        }
      }
    }
  }

  private showBaseMapMessage() {
    // Clear any existing base map
    this.baseMapLayer.clearLayers();

    // Show message in the empty state div
    if (this.emptyStateDiv) {
      this.emptyStateDiv.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #22294B;">
            Setup Required
          </div>
          <div style="font-size: 12px; color: #666; line-height: 1.6;">
            <div style="margin-bottom: 8px;"><strong>Step 1:</strong> Add Data field to your visual</div>
            <div style="margin-bottom: 8px;"><strong>Step 2:</strong> Add a Base Map GeoJSON URL in Map Settings</div>
            <div style="font-size: 11px; color: #888; margin-top: 10px;">
              For best results, add your data fields first, then configure the map URL.
            </div>
          </div>
        </div>
      `;
      this.showEmptyState();
    }
  }

  private hideBaseMapMessage() {
    this.hideEmptyState();
  }

  private showUrlRequiredMessage() {
    // Clear any existing base map
    this.baseMapLayer.clearLayers();

    // Show message in the empty state div
    if (this.emptyStateDiv) {
      this.emptyStateDiv.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #22294B;">
            Almost Ready!
          </div>
          <div style="font-size: 12px; color: #666; line-height: 1.6;">
            <div style="margin-bottom: 8px;">✅ Data fields added successfully</div>
            <div style="margin-bottom: 8px;"><strong>Next:</strong> Add a Base Map GeoJSON URL in Map Settings</div>
            <div style="font-size: 11px; color: #888; margin-top: 10px;">
              Once you provide the URL, your map and markers will appear.
            </div>
          </div>
        </div>
      `;
      this.showEmptyState();
    }
  }

  private showNoDataMessage() {
    // Show message in the empty state div
    if (this.emptyStateDiv) {
      this.emptyStateDiv.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 12px; font-weight: bold; margin-bottom: 10px; color: #22294B;">
            No distribution information available
          </div>
          
        </div>
      `;
      this.showEmptyState();
    }
  }

  private showUrlErrorMessage(url: string, errorMessage: string) {
    // Clear any existing base map
    this.baseMapLayer.clearLayers();

    // Show error message in the empty state div
    if (this.emptyStateDiv) {
      this.emptyStateDiv.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #d32f2f;">
            Error Loading Map
          </div>
          <div style="font-size: 12px; color: #666; line-height: 1.4; margin-bottom: 10px;">
            Failed to load GeoJSON from URL:
          </div>
          <div style="font-size: 10px; color: #999; word-break: break-all; margin-bottom: 10px;">
            ${url}
          </div>
          <div style="font-size: 11px; color: #d32f2f; font-weight: bold;">
            ${errorMessage}
          </div>
          <div style="font-size: 11px; color: #666; margin-top: 10px;">
            <strong>Tips:</strong><br/>
            • Ensure the URL is publicly accessible<br/>
            • Use direct download links (not Google Drive sharing links)<br/>
            • Verify the URL contains valid GeoJSON data
          </div>
        </div>
      `;
      this.showEmptyState();
    }
  }

  private handleBaseMapUrlChange() {
    const currentUrl = this.settings?.mapSettingsCard?.baseMapUrl?.value;

    // Store the current URL to detect changes
    if (!(this as any).lastBaseMapUrl) {
      (this as any).lastBaseMapUrl = currentUrl;
      // Load base map on first run
      this.loadBaseMap();
      return;
    }

    // If URL has changed, reload the base map
    if ((this as any).lastBaseMapUrl !== currentUrl) {
      (this as any).lastBaseMapUrl = currentUrl;

      // Clear existing base map layer
      this.baseMapLayer.clearLayers();

      // Reload base map with new URL
      this.loadBaseMap();
    }
  }

  private checkAdminCodeMatch(adminCode: any): boolean {
    if (!adminCode || this.geoJsonFeatures.length === 0) {
      return false;
    }

    // Convert adminCode to string for comparison
    const adminCodeStr = String(adminCode);

    // Show first few gaul_code values for debugging
    this.geoJsonFeatures.slice(0, 5).forEach((feature, index) => {
      const gaulCode = feature.properties?.gaul_code;
    });

    // Check if any GeoJSON feature has a matching gaul_code
    const match = this.geoJsonFeatures.find((feature) => {
      const gaulCode = feature.properties?.gaul_code;
      const gaulCodeStr = String(gaulCode);
      const isMatch = gaulCode && gaulCodeStr === adminCodeStr;

      return isMatch;
    });

    if (match) {
      return true;
    }

    return false;
  }

  // Add a method to force URL reload (can be called externally if needed)
  public reloadBaseMap() {
    this.handleBaseMapUrlChange();
  }

  // Method to manually update settings (for debugging)
  public updateSettingsManually(url: string) {
    this.settings.mapSettingsCard.baseMapUrl.value = url;
    this.handleBaseMapUrlChange();
  }

  public update(options: VisualUpdateOptions) {
    const startTime = performance.now();

    if (!options || !options.dataViews || options.dataViews.length === 0) {
      this.clearAllData();
      // Still try to handle base map URL even with no data
      this.handleBaseMapUrlChange();
      return;
    }

    // Update settings from Power BI (this works better when data is present)
    this.updateSettingsFromPowerBI(options);

    // Check if base map URL has changed and reload if necessary
    this.handleBaseMapUrlChange();

    // Store the current data view for marker visibility checks
    this.currentDataView = options.dataViews[0];

    try {
      const dataView: DataView = options.dataViews[0];

      // Debug: Log the data structure we're receiving

      // Handle table data format for both location and refId
      if (dataView.table && dataView.table.columns && dataView.table.rows) {
        this.processTableData(dataView);
      } else {
        this.clearAllData();
        this.showEmptyState();
        return;
      }

      // Log helpful information about data import
      // Power BI Leaflet Visual - Data Import Guide:
      //   • For best results with complex geometries, use JSON import instead of CSV/Excel
      //   • Power BI has a 32,766 character limit for text fields
      //   • Simple display: Power BI geometry strings shown in red

      // Add comprehensive debugging for the update method
      // UPDATE METHOD - Data structure received:
      //   hasDataView: !!dataView,
      //   hasTable: !!dataView.table,
      //   hasColumns: !!dataView.table.columns,
      //   hasRows: !!dataView.table.rows,
      //   totalRows: dataView.table.rows?.length || 0,
      //   totalColumns: dataView.table.columns?.length || 0,
      //   columnNames: dataView.table.columns?.map((col) => col.displayName) || [],
      //   columnRoles: dataView.table.columns?.map((col) => ({
      //     name: col.displayName,
      //     roles: col.roles,
      //   })) || [],

      // Check if Power BI is filtering the data
      if (dataView.table.rows && dataView.table.rows.length > 0) {
        // Data sample check - First row:
        //   rowData: dataView.table.rows[0],
        //   rowKeys: Object.keys(dataView.table.rows[0] || {}),
        //   rowValues: Object.values(dataView.table.rows[0] || {}),
        //   rowLength: Object.keys(dataView.table.rows[0] || {}).length,

        if (dataView.table.rows.length > 1) {
          // Data sample check - Second row:
          //   rowData: dataView.table.rows[1],
          //   rowKeys: Object.keys(dataView.table.rows[1] || {}),
          //   rowValues: Object.values(dataView.table.rows[1] || {}),
          //   rowLength: Object.keys(dataView.table.rows[1] || {}).length,
        }
      }

      // Check for categorical data (markers)
      // Categorical data check:
      //   hasCategorical: !!dataView.categorical,
      //   hasSingle: !!dataView.single,
      //   hasTable: !!dataView.table,
      //   tableRowCount: dataView.table?.rows?.length || 0,
      //   tableColumnCount: dataView.table?.columns?.length || 0,

      // Data processing is handled by processCategoricalData or processTableData methods

      // Update markers visibility based on current Power BI filtering
      this.updateMarkersVisibility(this.currentSelection);

      // Perform empty state check after all data processing is complete
      this.performEmptyStateCheck();

      const updateDuration = performance.now() - startTime;
    } catch (error) {
      // Error during visual update
    }
  }

  // Process table data (backward compatibility)
  private processTableData(dataView: DataView) {
    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      this.clearAllData();
      this.showEmptyState();
      return;
    }

    // Create selection IDs for markers FIRST
    this.createSelectionIds(dataView);

    // Process marker data from Power BI (lat/long) AFTER selection IDs are created
    this.processMarkerData(dataView);
  }

  // Create selection IDs from categorical data
  private createSelectionIdsFromCategorical(dataView: DataView) {
    if (!dataView.categorical || !dataView.categorical.categories) {
      return;
    }

    const locationCategory = dataView.categorical.categories[0];
    if (!locationCategory || !locationCategory.values) {
      return;
    }

    // Clear existing selection IDs
    this.selectionIds = [];

    // Create selection IDs for each location value
    this.selectionIds = locationCategory.values.map((value, index) => {
      return this.host
        .createSelectionIdBuilder()
        .withCategory(locationCategory, index)
        .createSelectionId();
    });
  }

  // Process markers from categorical data with table refId data
  private processMarkersFromCategoricalWithTable(
    locationCategory: any,
    refIdData: any[],
    dataView: DataView
  ) {
    if (!locationCategory || !locationCategory.values) {
      return;
    }

    // Clear existing markers
    this.markers.forEach((marker) => {
      this.markerClusterGroup.removeLayer(marker);
    });
    this.markers = [];

    // Clear the cluster group
    this.markerClusterGroup.clearLayers();

    // Process each location value - categorical data processing removed, only table data supported
    // This method is kept for compatibility but won't process data
    locationCategory.values.forEach((locationValue: any, index: number) => {
      // Categorical data processing removed - only table data with lat/lng fields is supported
      const locationInfo: any = {};

      // Get refId from table data if available
      let refId = undefined;
      if (refIdData && refIdData[index] !== undefined) {
        refId = refIdData[index];
      }

      // Only create markers for valid coordinates
      if (
        locationInfo.latitude !== undefined &&
        locationInfo.longitude !== undefined &&
        !isNaN(locationInfo.latitude) &&
        !isNaN(locationInfo.longitude)
      ) {
        const lat = locationInfo.latitude;
        const lng = locationInfo.longitude;

        // Categorical data processing - use default icon (this path is deprecated)
        const svgIcon = positiveSvg; // Default fallback

        // Create custom marker icon using the determined SVG
        const customMarkerIcon = L.divIcon({
          className: "custom-marker",
          html: `<img src="${svgIcon}" style="width: 40px; height: 65px;" />`,
          iconSize: [40, 65],
          iconAnchor: [20, 65],
          popupAnchor: [1, -54],
          tooltipAnchor: [25, -45],
        });

        const marker = L.marker([lat, lng], {
          icon: customMarkerIcon,
        });

        // Add selection ID to marker
        if (this.selectionIds && this.selectionIds[index]) {
          (marker as any).options.selectionId = this.selectionIds[index];
        }

        // Store location info and refId for tooltip
        (marker as any).locationInfo = locationInfo;
        (marker as any).refId = refId;

        // Add click handler for selection
        marker.on("click", (event) => {
          // Build tooltip content (empty for categorical - not supported anymore)
          const tooltipContent = this.buildTooltipContent([]);
          if (tooltipContent) {
            this.showTooltip(tooltipContent, event.latlng);
          }

          // Handle selection if selection ID exists
          if (this.selectionIds && this.selectionIds[index]) {
            const clickedSelectionId = this.selectionIds[index];

            // Check if clicking on a marker from a selected cluster should deselect the entire cluster
            if (this.shouldDeselectCluster(marker)) {
              this.selectionManager
                .clear()
                .then(() => {
                  this.clearSelectionAndCluster();
                })
                .catch((error) => {
                  // Error clearing selection
                });
              return; // Exit early, don't do individual marker selection
            }

            // Check if this marker is already selected
            const isCurrentlySelected = this.currentSelection.some((id) => {
              if (!id || !clickedSelectionId) return false;
              const markerKey = this.getSelectionIdKey(clickedSelectionId);
              const selectedKey = this.getSelectionIdKey(id);
              return markerKey === selectedKey;
            });

            if (isCurrentlySelected) {
              // Deselect the marker
              this.selectionManager
                .clear()
                .then(() => {
                  this.clearSelectionAndCluster();
                })
                .catch((error) => {
                  // Error clearing selection
                });
            } else {
              // Select the marker
              this.selectionManager
                .select(clickedSelectionId)
                .then((ids: ISelectionId[]) => {
                  this.currentSelection = ids;
                  this.persistentSelection = [...ids];
                  this.updateMarkersVisibility(ids);
                })
                .catch((error) => {
                  // Error selecting marker
                });
            }
          }

          L.DomEvent.stopPropagation(event);
        });

        // Add marker to cluster group
        this.markerClusterGroup.addLayer(marker);
        this.markers.push(marker);
      }
    });

    // Only add cluster group to map if base map URL is provided
    const hasBaseMapUrl =
      this.settings?.mapSettingsCard?.baseMapUrl?.value?.trim() !== "";
    if (hasBaseMapUrl && !this.map.hasLayer(this.markerClusterGroup)) {
      this.markerClusterGroup.addTo(this.map);
    }
  }

  // Build tooltip content for categorical data
  // Build tooltip content from tooltip field - show field name: value for each field
  private buildTooltipContent(
    tooltipData: any[],
    columnNames?: string[]
  ): string {
    if (!tooltipData || tooltipData.length === 0) {
      return "";
    }

    // Build HTML structure showing field name: value for each field
    let html = "";
    for (let i = 0; i < tooltipData.length; i++) {
      if (tooltipData[i] !== undefined && tooltipData[i] !== null) {
        const value = String(tooltipData[i]).trim();
        if (value) {
          const fieldName =
            columnNames && columnNames[i] ? columnNames[i] : `Field ${i + 1}`;
          html += `<div class="tooltip-row"><span class="field-name">${this.escapeHtml(
            fieldName
          )}</span><span class="field-value">${this.escapeHtml(
            value
          )}</span></div>`;
        }
      }
    }

    return html || "";
  }

  // Helper to escape HTML for safe display
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private processMarkerData(dataView: DataView) {
    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      return;
    }

    const columns = dataView.table.columns;
    const values = dataView.table.rows;

    // Get tooltip field indices and column names
    const tooltipIndices: number[] = [];
    const tooltipColumnNames: string[] = [];
    columns.forEach((col, idx) => {
      if (col.roles && (col.roles as any).tooltip) {
        tooltipIndices.push(idx);
        tooltipColumnNames.push(col.displayName || `Field ${idx}`);
      }
    });

    // Get color field indices and find REGULATORYSTATUSVALUE and PEMOVALUE columns
    const colorIndices: number[] = [];
    let regulatoryStatusIndex = -1;
    let pemoValueIndex = -1;
    columns.forEach((col, idx) => {
      if (col.roles && (col.roles as any).color) {
        colorIndices.push(idx);
        // Check column name to identify REGULATORYSTATUSVALUE and PEMOVALUE
        const colName = (col.displayName || "").toUpperCase();
        if (
          colName.includes("REGULATORYSTATUS") ||
          colName === "REGULATORYSTATUSVALUE"
        ) {
          regulatoryStatusIndex = idx;
        }
        if (colName.includes("PEMO") || colName === "PEMOVALUE") {
          pemoValueIndex = idx;
        }
      }
    });

    // Build markers using latitude and longitude fields
    const extracted = values.map((row) => this.getLatLngForRow(row, columns));
    const validCoordinateRows = values
      .map((row, idx) => ({
        row,
        idx,
        coords: extracted[idx],
        tooltipData: tooltipIndices.map((i) => row[i]),
        tooltipColumnNames: tooltipColumnNames,
        colorData: colorIndices.map((i) => row[i]),
        regulatoryStatus:
          regulatoryStatusIndex >= 0
            ? String(row[regulatoryStatusIndex] || "").trim()
            : "",
        pemoValue:
          pemoValueIndex >= 0 ? String(row[pemoValueIndex] || "").trim() : "",
      }))
      .filter(
        (o) =>
          o.coords &&
          o.coords.latitude !== undefined &&
          o.coords.longitude !== undefined &&
          !isNaN(o.coords.latitude as number) &&
          !isNaN(o.coords.longitude as number)
      );

    if (validCoordinateRows.length > 0) {
      // Clear existing markers
      this.markers.forEach((marker) => {
        this.markerClusterGroup.removeLayer(marker);
      });
      this.markers = [];

      // Clear the cluster group
      this.markerClusterGroup.clearLayers();

      // Create markers only for rows with valid coordinates
      validCoordinateRows.forEach((o) => {
        const lat = o.coords.latitude as number;
        const lng = o.coords.longitude as number;

        // Determine which SVG icon to use based on REGULATORYSTATUSVALUE and PEMOVALUE
        const svgIcon = this.getMarkerIcon(o.regulatoryStatus, o.pemoValue);

        // Create custom marker icon using the determined SVG
        const customMarkerIcon = L.divIcon({
          className: "custom-marker",
          html: `<img src="${svgIcon}" style="width: 40px; height: 65px;" />`,
          iconSize: [40, 65],
          iconAnchor: [20, 65],
          popupAnchor: [1, -54],
          tooltipAnchor: [25, -45],
        });

        const marker = L.marker([lat, lng], {
          icon: customMarkerIcon,
        });

        // Add selection ID to marker (use original row index if possible)
        const originalRowIndex = o.idx;
        if (this.selectionIds && this.selectionIds[originalRowIndex]) {
          (marker as any).options.selectionId =
            this.selectionIds[originalRowIndex];
        }

        // Store tooltip data and column names on marker
        (marker as any).tooltipData = o.tooltipData;
        (marker as any).tooltipColumnNames = o.tooltipColumnNames;

        // Store regulatory status and pemo value for cluster styling
        (marker as any).regulatoryStatus = o.regulatoryStatus;
        (marker as any).pemoValue = o.pemoValue;

        // Apply opacity - show all markers at full opacity (no filtering)
        const markerElement = marker.getElement();
        if (markerElement) {
          markerElement.style.opacity = "1";
        } else {
          // If element not available yet, apply opacity after marker is added to map
          marker.on("add", () => {
            const element = marker.getElement();
            if (element) {
              element.style.opacity = "1";
            }
          });
        }

        // Add click handler for selection
        marker.on("click", (event) => {
          // Build tooltip content from tooltip field
          const tooltipContent = this.buildTooltipContent(
            o.tooltipData,
            o.tooltipColumnNames
          );
          if (tooltipContent) {
            this.showTooltip(tooltipContent, event.latlng);
          }

          // Handle selection if selection ID exists
          if (this.selectionIds && this.selectionIds[originalRowIndex]) {
            const clickedSelectionId = this.selectionIds[originalRowIndex];

            // Check if clicking on a marker from a selected cluster should deselect the entire cluster
            if (this.shouldDeselectCluster(marker)) {
              this.selectionManager
                .clear()
                .then(() => {
                  this.clearSelectionAndCluster();
                })
                .catch((error) => {
                  // Error clearing selection
                });
              return; // Exit early, don't do individual marker selection
            }

            // Check if this marker is already selected
            const isCurrentlySelected = this.currentSelection.some((id) => {
              if (!id || !clickedSelectionId) return false;
              const markerKey = this.getSelectionIdKey(clickedSelectionId);
              const selectedKey = this.getSelectionIdKey(id);
              return markerKey === selectedKey;
            });

            if (isCurrentlySelected) {
              // Deselect the marker
              this.selectionManager
                .clear()
                .then(() => {
                  this.clearSelectionAndCluster();
                })
                .catch((error) => {
                  // Error clearing selection
                });
            } else {
              // Select the marker
              this.selectionManager
                .select(clickedSelectionId)
                .then((ids: ISelectionId[]) => {
                  this.currentSelection = ids;
                  this.persistentSelection = [...ids];
                  this.updateMarkersVisibility(ids);
                })
                .catch((error) => {
                  // Error selecting marker
                });
            }
          } else {
            // No selection ID found for marker
          }

          L.DomEvent.stopPropagation(event);
        });

        // Add marker to cluster group instead of map
        this.markerClusterGroup.addLayer(marker);
        this.markers.push(marker);
      });

      // Only add cluster group to map if base map URL is provided
      const hasBaseMapUrl =
        this.settings?.mapSettingsCard?.baseMapUrl?.value?.trim() !== "";
      if (hasBaseMapUrl && !this.map.hasLayer(this.markerClusterGroup)) {
        this.markerClusterGroup.addTo(this.map);
      }
    } else {
      // No valid latitude/longitude columns found for markers
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
  }

  private clearAllData() {
    // Clear all loading operations and hide loader
    this.loadingOperations.clear();
    if (this.loaderDiv) {
      this.loaderDiv.style.display = "none";
      this.isLoading = false;
    }

    // Clear markers
    this.markers.forEach((marker) => {
      this.markerClusterGroup.removeLayer(marker);
    });
    this.markers = [];

    // Clear selection state
    this.currentSelection = [];
    this.persistentSelection = [];
    this.selectionIds = [];

    // Reset map loaded flag
    this.mapLoaded = false;
  }

  private updateMarkersVisibility(selectedIds: ISelectionId[]) {
    let visibleMarkers = 0;
    let hiddenMarkers = 0;

    this.markers.forEach((marker, index) => {
      let markerSelectionId = (marker as any).options?.selectionId;

      // Fallback: get from this.selectionIds array if not stored on marker
      if (!markerSelectionId && this.selectionIds && this.selectionIds[index]) {
        markerSelectionId = this.selectionIds[index];
        // Store it on the marker for future use
        (marker as any).options = (marker as any).options || {};
        (marker as any).options.selectionId = markerSelectionId;
      }

      // Skip markers without selection IDs
      if (!markerSelectionId) {
        return;
      }

      // Check if this marker should be visible based on Power BI filtering
      // A marker should be visible if:
      // 1. It's in the current filtered data view (Power BI filtering), OR
      // 2. It's explicitly selected by the user (cross-filtering)
      const isInFilteredData = this.isMarkerInFilteredData(markerSelectionId);

      // Use key-based comparison for reliable matching (same as cluster filtering)
      const markerKey = this.getSelectionIdKey(markerSelectionId);
      const selectedKeys = new Set(
        selectedIds.map((id) => this.getSelectionIdKey(id))
      );
      const isExplicitlySelected = selectedKeys.has(markerKey);

      // Also check if this marker is in selectedIds by direct object comparison as fallback
      const isDirectlySelected = selectedIds.some((selectedId) => {
        if (!selectedId) return false;
        // Try direct comparison first
        if (selectedId === markerSelectionId) return true;
        // Try key comparison (already done above, but checking again for debug)
        return this.getSelectionIdKey(selectedId) === markerKey;
      });

      // Use whichever match works
      const isSelected = isExplicitlySelected || isDirectlySelected;

      // For manual selection: show all markers but dim non-selected ones
      // For Power BI filtering: show markers that are in the filtered data OR are explicitly selected
      // When markers are selected, we should show them even if Power BI filtered them out
      const shouldBeVisible =
        selectedIds.length > 0
          ? isInFilteredData || isSelected
          : isInFilteredData;

      if (shouldBeVisible) {
        // Show marker
        if (!this.markerClusterGroup.hasLayer(marker)) {
          this.markerClusterGroup.addLayer(marker);
          visibleMarkers++;
        } else {
          visibleMarkers++;
        }

        // Apply opacity based on selection
        const markerElement = marker.getElement();

        if (markerElement) {
          if (selectedIds.length > 0) {
            // If there are selections, dim non-selected markers
            // Use the combined check (key-based or direct comparison)
            if (isSelected) {
              // Selected marker: always use full opacity - use helper method
              this.setMarkerOpacityTo1(markerElement, index);
            } else {
              // Non-selected marker: dim to lower opacity
              markerElement.style.opacity = "0.3";
            }
          } else {
            // No selections: all markers should be at full opacity
            markerElement.style.opacity = "1";
          }
        } else {
          // Marker element not available yet - likely still in a cluster
          // Store selection state so we can apply it when element becomes available
          if (isSelected) {
            (marker as any)._shouldHaveOpacity1 = true;
            (marker as any)._isSelected = true;

            // Try to get element with a delay in case cluster is expanding/spiderfying
            setTimeout(() => {
              const delayedElement = marker.getElement();
              if (delayedElement) {
                this.setMarkerOpacityTo1(delayedElement, index);
              }
            }, 300);
          }

          // Wait for marker to be added to map (when it becomes visible outside cluster after spiderfy)
          // Use once() to avoid multiple listeners - check if already attached
          if (!(marker as any)._opacityListenerAttached) {
            (marker as any)._opacityListenerAttached = true;
            marker.once("add", () => {
              setTimeout(() => {
                const element = marker.getElement();
                if (element) {
                  const markerKey = this.getSelectionIdKey(markerSelectionId);
                  const selectedKeys = new Set(
                    selectedIds.map((id) => this.getSelectionIdKey(id))
                  );
                  const isSelected =
                    selectedKeys.has(markerKey) || (marker as any)._isSelected;

                  if (isSelected) {
                    this.setMarkerOpacityTo1(element, index);
                  } else {
                    // Check if there are any selections
                    if (selectedIds.length > 0) {
                      element.style.opacity = "0.3";
                    } else {
                      element.style.opacity = "1";
                    }
                  }
                }
              }, 50);
            });
          }
        }
      } else {
        // Hide marker (not in filtered data)
        if (this.markerClusterGroup.hasLayer(marker)) {
          this.markerClusterGroup.removeLayer(marker);
          hiddenMarkers++;
        }
      }
    });

    // Update cluster opacity based on selection
    this.updateClusterOpacity(selectedIds);

    // Check empty state after marker visibility update
    this.performEmptyStateCheck();
  }

  // Helper method to check if clicking a marker from a selected cluster should deselect the cluster
  private shouldDeselectCluster(marker: L.Marker): boolean {
    // Check if this marker is part of the last selected cluster
    const isFromLastSelectedCluster =
      this.lastSelectedClusterMarkers.has(marker);

    // Check if ALL markers from the last selected cluster are currently selected
    if (
      isFromLastSelectedCluster &&
      this.lastSelectedClusterSelectionIds.length > 0
    ) {
      const allClusterMarkersSelected =
        this.lastSelectedClusterSelectionIds.every((clusterId) => {
          return this.currentSelection.some((selectedId) => {
            if (!selectedId || !clusterId) return false;
            const clusterKey = this.getSelectionIdKey(clusterId);
            const selectedKey = this.getSelectionIdKey(selectedId);
            return clusterKey === selectedKey;
          });
        });
      return allClusterMarkersSelected;
    }
    return false;
  }

  // Helper method to clear selection and cluster tracking
  private clearSelectionAndCluster() {
    this.currentSelection = [];
    this.persistentSelection = [];
    this.lastSelectedClusterMarkers.clear();
    this.lastSelectedClusterSelectionIds = [];
    this.updateMarkersVisibility([]);
  }

  // Helper method to hide markers using display: none
  private hideClusterMarkers(markers: L.Marker[]) {
    markers.forEach((marker) => {
      const element = marker.getElement();
      if (element) {
        element.style.display = "none";
        element.classList.add("hidden-by-cluster");
        // Also hide any icon element
        const iconElement = element.querySelector(".leaflet-marker-icon");
        if (iconElement) {
          (iconElement as HTMLElement).style.display = "none";
        }
      } else {
        // Marker element not ready yet - try again after a delay
        setTimeout(() => {
          const delayedElement = marker.getElement();
          if (delayedElement) {
            delayedElement.style.display = "none";
            delayedElement.classList.add("hidden-by-cluster");
            const iconElement = delayedElement.querySelector(
              ".leaflet-marker-icon"
            );
            if (iconElement) {
              (iconElement as HTMLElement).style.display = "none";
            }
          }
        }, 200);
      }
    });
  }

  // Helper method to set marker opacity to 1 with !important
  // This method will also monitor and reapply if opacity gets changed
  private setMarkerOpacityTo1(element: HTMLElement, markerIndex: number) {
    // Store marker index on element for monitoring
    (element as any)._selectedMarkerIndex = markerIndex;

    const applyOpacity = () => {
      element.style.opacity = "1";
      const currentStyle = element.getAttribute("style") || "";
      const newStyle =
        currentStyle
          .replace(/opacity\s*:\s*[^;]*;?/gi, "")
          .replace(/;\s*$/, "")
          .trim() + "; opacity: 1 !important;";
      element.setAttribute("style", newStyle);

      // Also set a data attribute as a flag
      element.setAttribute("data-selected-opacity", "1");
    };

    applyOpacity();

    // Monitor and reapply if opacity changes (to handle cases where it gets overridden)
    const checkInterval = setInterval(() => {
      if (!element.parentElement) {
        // Element removed, stop checking
        clearInterval(checkInterval);
        return;
      }

      const computedOpacity = window.getComputedStyle(element).opacity;
      const styleOpacity = element.style.opacity;

      // If opacity is not 1, reapply it
      if (computedOpacity !== "1" && styleOpacity !== "1") {
        applyOpacity();
        if (markerIndex < 30) {
        }
      }
    }, 200);

    // Stop monitoring after 10 seconds (markers should be stable by then)
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 10000);

    // Verify it was set correctly after a delay
    setTimeout(() => {
      const computedOpacity = window.getComputedStyle(element).opacity;
      const styleOpacity = element.style.opacity;
      if (markerIndex < 30) {
        if (computedOpacity !== "1" || styleOpacity !== "1") {
          // Try to reapply immediately
          applyOpacity();
        } else {
        }
      }
    }, 100);
  }

  // Apply opacity to selected markers when their elements become available
  private applyOpacityToSelectedMarkers(retryCount: number = 0) {
    const maxRetries = 5; // Limit retries to prevent infinite loop

    if (this.currentSelection.length === 0) {
      return;
    }

    if (retryCount >= maxRetries) {
      // Stop retrying after max attempts
      return;
    }

    const selectedKeys = new Set(
      this.currentSelection.map((id) => this.getSelectionIdKey(id))
    );

    let foundCount = 0;
    let appliedCount = 0;

    this.markers.forEach((marker, index) => {
      const markerSelectionId = (marker as any).options?.selectionId;
      if (!markerSelectionId) return;

      const markerKey = this.getSelectionIdKey(markerSelectionId);
      if (!selectedKeys.has(markerKey)) return;

      foundCount++;
      const markerElement = marker.getElement();
      if (markerElement) {
        // Marker element is now available, apply opacity using helper method
        this.setMarkerOpacityTo1(markerElement, index);
        appliedCount++;
      }
    });

    // If some markers still don't have elements and we haven't exceeded max retries, schedule another check
    if (
      foundCount > 0 &&
      appliedCount < foundCount &&
      retryCount < maxRetries - 1
    ) {
      setTimeout(() => {
        this.applyOpacityToSelectedMarkers(retryCount + 1);
      }, 500);
    }
  }

  private updateClusterOpacity(selectedIds: ISelectionId[]) {
    // Use a timeout to ensure clusters are rendered and marker opacity is set first
    setTimeout(() => {
      const clusterElements = document.querySelectorAll(
        ".marker-cluster-small, .marker-cluster-medium, .marker-cluster-large"
      );

      if (selectedIds.length === 0) {
        // No selections - set all clusters to full opacity
        clusterElements.forEach((clusterElement) => {
          const elem = clusterElement as HTMLElement;
          elem.style.opacity = "1";
          // Force with !important
          const currentStyle = elem.getAttribute("style") || "";
          const newStyle =
            currentStyle
              .replace(/opacity\s*:\s*[^;]*;?/gi, "")
              .replace(/;\s*$/, "")
              .trim() + "; opacity: 1 !important;";
          elem.setAttribute("style", newStyle);
        });
        return;
      }

      // Create a set of selected marker keys for efficient lookup
      const selectedKeys = new Set(
        selectedIds.map((id) => this.getSelectionIdKey(id))
      );

      // Get positions of all selected markers (that are visible and have opacity = 1)
      const selectedMarkerPositions: Array<{ x: number; y: number }> = [];
      this.markers.forEach((marker) => {
        const markerSelectionId = (marker as any).options?.selectionId;
        if (!markerSelectionId) return;

        const markerKey = this.getSelectionIdKey(markerSelectionId);
        if (!selectedKeys.has(markerKey)) return;

        // Check if marker is actually selected (has opacity = 1)
        const markerElement = marker.getElement();
        if (!markerElement) return;

        const markerStyleOpacity = markerElement.style.opacity;
        const markerComputedOpacity =
          window.getComputedStyle(markerElement).opacity;
        const markerOpacityValue = parseFloat(
          markerStyleOpacity || markerComputedOpacity
        );

        // Only consider markers that are actually visible and selected (opacity >= 0.99)
        if (markerOpacityValue >= 0.99) {
          const markerLatLng = marker.getLatLng();
          const markerPoint = this.map.latLngToContainerPoint(markerLatLng);
          selectedMarkerPositions.push({ x: markerPoint.x, y: markerPoint.y });
        }
      });

      // Check each cluster DOM element
      clusterElements.forEach((clusterElement) => {
        let hasSelected = false;

        // Get cluster position
        const clusterRect = (
          clusterElement as HTMLElement
        ).getBoundingClientRect();
        const mapContainer = this.map.getContainer().getBoundingClientRect();
        const clusterCenterX =
          clusterRect.left + clusterRect.width / 2 - mapContainer.left;
        const clusterCenterY =
          clusterRect.top + clusterRect.height / 2 - mapContainer.top;

        // Check if any selected marker is near this cluster (within cluster radius)
        // Cluster radius is typically around 40-50 pixels
        const clusterRadius = 60; // pixels - generous tolerance for cluster size
        for (const markerPos of selectedMarkerPositions) {
          const distance = Math.sqrt(
            Math.pow(clusterCenterX - markerPos.x, 2) +
              Math.pow(clusterCenterY - markerPos.y, 2)
          );
          if (distance < clusterRadius) {
            hasSelected = true;
            break;
          }
        }

        // If still not found, try finding the Leaflet cluster layer
        if (!hasSelected) {
          // Get all visible cluster layers from Leaflet
          this.markerClusterGroup.eachLayer((layer: any) => {
            // Check if this is a cluster (has getAllChildMarkers method)
            if (
              layer.getAllChildMarkers &&
              typeof layer.getAllChildMarkers === "function"
            ) {
              const layerLatLng = layer.getLatLng();
              const layerPoint = this.map.latLngToContainerPoint(layerLatLng);

              // Check if this DOM element corresponds to this cluster layer
              const distance = Math.sqrt(
                Math.pow(clusterCenterX - layerPoint.x, 2) +
                  Math.pow(clusterCenterY - layerPoint.y, 2)
              );

              if (distance < 50) {
                // This is the cluster - check if any of its child markers are selected
                const childMarkers = layer.getAllChildMarkers();
                childMarkers.forEach((marker: L.Marker) => {
                  const markerSelectionId = (marker as any).options
                    ?.selectionId;
                  if (!markerSelectionId) return;

                  const markerKey = this.getSelectionIdKey(markerSelectionId);
                  if (selectedKeys.has(markerKey)) {
                    hasSelected = true;
                  }
                });
              }
            }
          });
        }

        // Set cluster opacity: full opacity if it contains selected markers, dimmed otherwise
        const clusterOpacity = hasSelected ? "1" : "0.5";
        const elem = clusterElement as HTMLElement;
        elem.style.opacity = clusterOpacity;

        // Force opacity with !important to prevent overrides
        const currentStyle = elem.getAttribute("style") || "";
        const newStyle =
          currentStyle
            .replace(/opacity\s*:\s*[^;]*;?/gi, "")
            .replace(/;\s*$/, "")
            .trim() + `; opacity: ${clusterOpacity} !important;`;
        elem.setAttribute("style", newStyle);
      });
    }, 250); // Increased timeout to ensure everything is rendered and marker opacity is set

    // Additional delayed update to catch any re-renders or animations
    setTimeout(() => {
      const clusterElements = document.querySelectorAll(
        ".marker-cluster-small, .marker-cluster-medium, .marker-cluster-large"
      );

      if (selectedIds.length === 0) {
        clusterElements.forEach((clusterElement) => {
          const elem = clusterElement as HTMLElement;
          elem.style.opacity = "1";
          const currentStyle = elem.getAttribute("style") || "";
          const newStyle =
            currentStyle
              .replace(/opacity\s*:\s*[^;]*;?/gi, "")
              .replace(/;\s*$/, "")
              .trim() + "; opacity: 1 !important;";
          elem.setAttribute("style", newStyle);
        });
        return;
      }

      // Create a set of selected marker keys
      const selectedKeys = new Set(
        selectedIds.map((id) => this.getSelectionIdKey(id))
      );

      // Get positions of selected markers
      const selectedMarkerPositions: Array<{ x: number; y: number }> = [];
      this.markers.forEach((marker) => {
        const markerSelectionId = (marker as any).options?.selectionId;
        if (!markerSelectionId) return;

        const markerKey = this.getSelectionIdKey(markerSelectionId);
        if (!selectedKeys.has(markerKey)) return;

        const markerElement = marker.getElement();
        if (!markerElement) return;

        const markerStyleOpacity = markerElement.style.opacity;
        const markerComputedOpacity =
          window.getComputedStyle(markerElement).opacity;
        const markerOpacityValue = parseFloat(
          markerStyleOpacity || markerComputedOpacity
        );

        if (markerOpacityValue >= 0.99) {
          const markerLatLng = marker.getLatLng();
          const markerPoint = this.map.latLngToContainerPoint(markerLatLng);
          selectedMarkerPositions.push({ x: markerPoint.x, y: markerPoint.y });
        }
      });

      clusterElements.forEach((clusterElement) => {
        let hasSelected = false;
        const clusterRect = (
          clusterElement as HTMLElement
        ).getBoundingClientRect();
        const mapContainer = this.map.getContainer().getBoundingClientRect();
        const clusterCenterX =
          clusterRect.left + clusterRect.width / 2 - mapContainer.left;
        const clusterCenterY =
          clusterRect.top + clusterRect.height / 2 - mapContainer.top;

        const clusterRadius = 60;
        for (const markerPos of selectedMarkerPositions) {
          const distance = Math.sqrt(
            Math.pow(clusterCenterX - markerPos.x, 2) +
              Math.pow(clusterCenterY - markerPos.y, 2)
          );
          if (distance < clusterRadius) {
            hasSelected = true;
            break;
          }
        }

        const clusterOpacity = hasSelected ? "1" : "0.5";
        const elem = clusterElement as HTMLElement;
        elem.style.opacity = clusterOpacity;
        const currentStyle = elem.getAttribute("style") || "";
        const newStyle =
          currentStyle
            .replace(/opacity\s*:\s*[^;]*;?/gi, "")
            .replace(/;\s*$/, "")
            .trim() + `; opacity: ${clusterOpacity} !important;`;
        elem.setAttribute("style", newStyle);
      });
    }, 500); // Secondary update after animations complete
  }

  private isMarkerInFilteredData(markerSelectionId: ISelectionId): boolean {
    // Power BI filtering works by providing only the filtered data in dataView.table.rows
    // We should show markers that correspond to the current filtered data view

    if (
      !this.currentDataView ||
      !this.currentDataView.table ||
      !this.currentDataView.table.rows
    ) {
      return true; // No data view, show all markers
    }

    // Check if this marker's selection ID corresponds to a row in the current filtered data
    const currentFilteredRows = this.currentDataView.table.rows;

    // Find the marker's index in the original data
    const markerIndex = this.selectionIds.findIndex((id) => {
      if (!id || !markerSelectionId) return false;

      if (id.getKey && markerSelectionId.getKey) {
        return id.getKey() === markerSelectionId.getKey();
      }
      if (id.toString && markerSelectionId.toString) {
        return id.toString() === markerSelectionId.toString();
      }
      return id === markerSelectionId;
    });

    // If marker index is found and it's within the current filtered data range, show it
    if (markerIndex >= 0 && markerIndex < currentFilteredRows.length) {
      return true;
    }

    return false;
  }

  private showTooltip(content: string, latlng: L.LatLng) {
    if (!this.tooltipDiv) {
      console.error(
        `[Show Tooltip] tooltipDiv is null/undefined, cannot show tooltip`
      );
      return;
    }

    if (!content || content.trim() === "") {
      console.warn(`[Show Tooltip] Content is empty/null, not showing tooltip`);
      return;
    }

    try {
      // Calculate max height based on visual container height
      const visualHeight = this.target.clientHeight || this.target.offsetHeight;
      const maxTooltipHeight = visualHeight - 50; // Leave 20px margin from top/bottom

      const tooltipWithCloseButton = `
        <div style="position: relative; display: flex; flex-direction: column; height: 100%;">
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
          <div style="
            max-height: ${maxTooltipHeight}px;
            overflow-y: auto;
            overflow-x: hidden;
            padding-right: 2px;
          ">
            ${content}
          </div>
        </div>
      `;

      this.tooltipDiv.innerHTML = tooltipWithCloseButton;
      this.tooltipDiv.style.opacity = "1";
      this.tooltipDiv.style.left = "10px";
      this.tooltipDiv.style.top = "10px";

      // Set max-height on the tooltip container itself
      this.tooltipDiv.style.maxHeight = `${maxTooltipHeight}px`;
    } catch (error) {
      console.error(`[Show Tooltip] Error setting up tooltip:`, error);
    }
  }

  private showEmptyState() {
    if (this.emptyStateDiv) {
      this.ensureEmptyStateDivPosition();
      this.emptyStateDiv.style.opacity = "1";
      this.emptyStateDiv.style.pointerEvents = "auto";
      this.emptyStateDiv.style.display = "block";
    }
  }

  private hideEmptyState() {
    if (this.emptyStateDiv) {
      this.emptyStateDiv.style.opacity = "0";
      this.emptyStateDiv.style.pointerEvents = "none";
    }
  }

  private showLoader(operation: string = "default"): void {
    this.loadingOperations.add(operation);
    if (this.loaderDiv) {
      this.loaderDiv.style.display = "block";
      this.isLoading = true;
    }
  }

  private hideLoader(operation: string = "default"): void {
    this.loadingOperations.delete(operation);
    if (this.loaderDiv && this.loadingOperations.size === 0) {
      this.loaderDiv.style.display = "none";
      this.isLoading = false;
    }
  }

  private performEmptyStateCheck(): void {
    setTimeout(() => {
      try {
        this.ensureEmptyStateDivPosition();
        const hasAnyData = this.hasAnyDistributionData();
        const hasBaseMapUrl =
          this.settings?.mapSettingsCard?.baseMapUrl?.value?.trim() !== "";
        const hasOriginalData = this.selectionIds.length > 0;

        // Always show message until URL is provided, regardless of data
        if (!hasBaseMapUrl) {
          // Show appropriate message based on whether data is present
          if (hasOriginalData) {
            this.showUrlRequiredMessage();
          } else {
            this.showBaseMapMessage();
          }
        } else {
          // URL is provided, check if we should show empty state
          if (hasOriginalData && !hasAnyData) {
            // We have original data but no visible data (filtered out)
            this.showNoDataMessage();
          } else {
            // Hide empty state (map will be shown)
            this.hideEmptyState();
          }
        }
      } catch (error) {
        this.showBaseMapMessage();
      }
    }, 100);
  }

  private hasAnyDistributionData(): boolean {
    try {
      const visibleMarkers = this.markers.filter((marker) =>
        this.markerClusterGroup.hasLayer(marker)
      ).length;

      // Only return true if there are actually visible markers on the map
      return visibleMarkers > 0;
    } catch (error) {
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

  private showOnlyCurrentContextMarkers(): void {
    try {
      // Show markers that are in the current Power BI filtered data
      this.updateMarkersVisibility([]);
    } catch (error) {
      // Error showing current context markers
    }
  }

  public clearSelection(): void {
    try {
      this.selectionManager
        .clear()
        .then(() => {
          this.currentSelection = [];
          this.persistentSelection = [];
          this.showOnlyCurrentContextMarkers();
        })
        .catch((error) => {
          this.currentSelection = [];
          this.persistentSelection = [];
          this.showOnlyCurrentContextMarkers();
        });
    } catch (error) {
      // Error in clearSelection
    }
  }

  public enumerateObjectInstances(
    options: powerbiVisualsApi.EnumerateVisualObjectInstancesOptions
  ): powerbiVisualsApi.VisualObjectInstanceEnumeration {
    const objectName = options.objectName;
    const objectEnumeration: powerbiVisualsApi.VisualObjectInstance[] = [];

    if (objectName === "mapSettings") {
      // Base map URL enumeration
      const currentUrl =
        this.settings?.mapSettingsCard?.baseMapUrl?.value || "";
      let finalUrl = currentUrl;
      if (!finalUrl && (this as any).lastBaseMapUrl) {
        finalUrl = (this as any).lastBaseMapUrl;
      }
      objectEnumeration.push({
        objectName: objectName,
        properties: {
          baseMapUrl: finalUrl,
        },
        selector: null,
      });

      // Disputed borders URL enumeration
      const currentDisputed =
        this.settings?.mapSettingsCard?.disputedBordersUrl?.value || "";
      let finalDisputed = currentDisputed;
      if (!finalDisputed && (this as any).lastDisputedBordersUrl) {
        finalDisputed = (this as any).lastDisputedBordersUrl;
      }
      objectEnumeration.push({
        objectName: objectName,
        properties: {
          disputedBordersUrl: finalDisputed,
        },
        selector: null,
      });
    }

    return objectEnumeration;
  }

  // Override the parse method to handle settings changes
  public parseSettings(settings: any) {
    if (settings && settings.mapSettings && settings.mapSettings.baseMapUrl) {
      const url = String(settings.mapSettings.baseMapUrl);
      this.settings.mapSettingsCard.baseMapUrl.value = url;
      this.handleBaseMapUrlChange();
    }
  }

  public destroy(): void {
    try {
      if (this.map) {
        this.map.remove();
      }
      this.markers = [];
      this.selectionIds = [];
      this.currentSelection = [];
      this.persistentSelection = [];
    } catch (error) {
      // Error during visual destruction
    }
  }

  public onResize(): void {
    try {
      if (this.map) {
        this.map.invalidateSize();
      }
      this.ensureEmptyStateDivPosition();
      this.performEmptyStateCheck();
    } catch (error) {
      // Error during visual resize
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
}
