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
  private choroplethLayer: L.GeoJSON<any> | null = null; // Choropleth layer for highlighting matching regions
  private isLoading: boolean = false;
  private loadingOperations: Set<string> = new Set();
  private cachedAdminCodes: string[] = []; // Cache admin codes to avoid repeated processing
  private mapLoaded: boolean = false; // Track if map is fully loaded
  private debugLocationLogCount: number = 0; // Limit noisy debug logs
  private debugLocationValueLogCount: number = 0; // Limit raw value logs

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

    // Initialize choropleth layer for highlighting matching regions
    this.choroplethLayer = L.geoJSON(null, {
      style: this.getChoroplethStyle.bind(this),
      onEachFeature: this.onEachChoroplethFeature.bind(this),
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
        font-family: Arial, sans-serif;
        font-size: 12px;
      }

      .tooltip-divider {
        height: 1px;
        background-color: #22294B;
        width: 100%;
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
        background-color: rgba(249, 177, 18, 0.6);
        border: 2px solid #F9B112;
      }
      
      .marker-cluster-small div {
        background-color: #F9B112;
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
        background-color: rgba(249, 177, 18, 0.7);
        border: 2px solid #F9B112;
      }
      
      .marker-cluster-medium div {
        background-color: #F9B112;
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
        background-color: rgba(249, 177, 18, 0.8);
        border: 2px solid #22294d;
      }
      
      .marker-cluster-large div {
        background-color: #F9B112;
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
        background-color: rgba(249, 177, 18, 0.8);
        border-color: #455E6F;
      }
    `;
    document.head.appendChild(style);

    // Disputed borders will be loaded from URL if provided in settings

    // Setup custom zoom controls
    this.setupZoomControls();
  }

  // Helper: build tooltip content with optional dividers after odd rows when > 2 rows
  private buildTooltipWithOddDividers(rows: string[]): string {
    const parts: string[] = [];
    const shouldInsertDividers = rows.length > 2;
    for (let i = 0; i < rows.length; i++) {
      parts.push(rows[i]);
      // Insert divider after even-numbered rows (1-based: after rows 2,4,6,...) but not after the last row
      if (shouldInsertDividers && i % 2 === 1 && i < rows.length - 1) {
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

  // Helper: parse a single location field supporting JSON or delimited strings
  private parseLocationField(value: any): {
    latitude?: number;
    longitude?: number;
    adminCode?: string;
    obsId?: string;
    country?: string;
    refId?: string;
  } {
    if (value === null || value === undefined) return {};
    const raw = String(value).trim();
    if (!raw || raw === "NA") return {};

    if (this.debugLocationLogCount < 20) {
      try {
      } catch {}
    }

    // Try JSON first
    try {
      const obj = JSON.parse(raw);
      const lat = parseFloat(
        String((obj as any).lat ?? (obj as any).latitude ?? (obj as any).y)
      );
      const lng = parseFloat(
        String(
          (obj as any).lng ??
            (obj as any).long ??
            (obj as any).longitude ??
            (obj as any).x
        )
      );
      const admin =
        (obj as any).admin ??
        (obj as any).adminCode ??
        (obj as any).gaul_code ??
        (obj as any).code;
      const obsId =
        (obj as any).obsId ?? (obj as any).obs_id ?? (obj as any).obs;
      const country =
        (obj as any).country ??
        (obj as any).countryName ??
        (obj as any).country_name;

      const result: any = {};
      if (!isNaN(lat)) result.latitude = lat;
      if (!isNaN(lng)) result.longitude = lng;
      if (admin !== undefined && admin !== null && String(admin) !== "") {
        result.adminCode = String(admin);
      }
      if (obsId !== undefined && obsId !== null && String(obsId) !== "") {
        result.obsId = String(obsId);
      }
      if (country !== undefined && country !== null && String(country) !== "") {
        result.country = String(country);
      }
      if (this.debugLocationLogCount < 20) {
        try {
          this.debugLocationLogCount++;
        } catch {}
      }
      return result;
    } catch (_) {
      // Not JSON, continue
    }

    // Support common delimiters: comma, pipe, semicolon, space
    const parts = raw.split(/,/);
    if (parts.length >= 2) {
      let latStr: string | undefined;
      let lngStr: string | undefined;
      let admin: string | undefined;
      let obsId: string | undefined;
      let country: string | undefined;
      let refId: string | undefined;

      // Check if we have the pattern refId,lat,lng,admin,obsId,country (6+ parts with commas)
      if (parts.length >= 6 && /,/.test(raw)) {
        // Treat as: refId, lat, lng, admin, obsId, country
        refId = parts[0] && parts[0].trim() !== "" ? parts[0] : undefined;
        latStr = parts[1] && parts[1].trim() !== "" ? parts[1] : undefined;
        lngStr = parts[2] && parts[2].trim() !== "" ? parts[2] : undefined;
        admin = parts[3] && parts[3].trim() !== "" ? parts[3] : undefined;
        obsId = parts[4] && parts[4].trim() !== "" ? parts[4] : undefined;
        country = parts[5] && parts[5].trim() !== "" ? parts[5] : undefined;

        if (this.debugLocationLogCount < 20) {
          try {
            this.debugLocationLogCount++;
          } catch {}
        }
      }
      // Check if we have the pattern refId,lat,lng,admin (4+ parts with commas)
      else if (parts.length >= 4 && /,/.test(raw)) {
        // Treat as: refId, lat, lng, admin
        refId = parts[0] && parts[0].trim() !== "" ? parts[0] : undefined;
        latStr = parts[1] && parts[1].trim() !== "" ? parts[1] : undefined;
        lngStr = parts[2] && parts[2].trim() !== "" ? parts[2] : undefined;
        admin = parts[3] && parts[3].trim() !== "" ? parts[3] : undefined;

        if (this.debugLocationLogCount < 20) {
          try {
            this.debugLocationLogCount++;
          } catch {}
        }
      } else {
        // Treat as: lat, lng, admin
        latStr = parts[0] && parts[0].trim() !== "" ? parts[0] : undefined;
        lngStr = parts[1] && parts[1].trim() !== "" ? parts[1] : undefined;
        admin = parts[2] && parts[2].trim() !== "" ? parts[2] : undefined;
      }

      const lat = latStr ? parseFloat(latStr) : NaN;
      const lng = lngStr ? parseFloat(lngStr) : NaN;
      const result: any = {};
      if (!isNaN(lat)) result.latitude = lat;
      if (!isNaN(lng)) result.longitude = lng;
      if (admin !== undefined && admin !== null && String(admin) !== "") {
        result.adminCode = String(admin);
      }
      if (obsId !== undefined && obsId !== null && String(obsId) !== "") {
        result.obsId = String(obsId);
      }
      if (country !== undefined && country !== null && String(country) !== "") {
        result.country = String(country);
      }
      // Add refId if it was extracted
      if (
        typeof refId !== "undefined" &&
        refId !== null &&
        String(refId) !== ""
      ) {
        result.refId = String(refId);
      }
      if (this.debugLocationLogCount < 20) {
        try {
          this.debugLocationLogCount++;
        } catch {}
      }
      return result;
    }

    // Edge case: admin-only with delimiters (e.g., "472,,,235")
    if (parts.length >= 4) {
      const admin = parts[3] && parts[3].trim() !== "" ? parts[3] : undefined;
      const obsId = parts[4] && parts[4].trim() !== "" ? parts[4] : undefined;
      const country = parts[5] && parts[5].trim() !== "" ? parts[5] : undefined;

      if (admin !== undefined && admin !== null && String(admin) !== "") {
        const result: any = { adminCode: String(admin) };
        if (obsId !== undefined && obsId !== null && String(obsId) !== "") {
          result.obsId = String(obsId);
        }
        if (
          country !== undefined &&
          country !== null &&
          String(country) !== ""
        ) {
          result.country = String(country);
        }
        if (this.debugLocationLogCount < 20) {
          try {
            this.debugLocationLogCount++;
          } catch {}
        }
        return result;
      }
    }

    // Try labeled patterns like "lat: .., lon: .., admin: .., obsId: .., country: .."
    const labeledLatMatch = raw.match(
      /(lat|latitude|y)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i
    );
    const labeledLngMatch = raw.match(
      /(lng|long|longitude|x)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i
    );
    const labeledAdminMatch = raw.match(
      /(admin|adminCode|gaul[_\s]*code|code)\s*[:=]\s*([^,;|\s]+)/i
    );
    const labeledObsIdMatch = raw.match(
      /(obsId|obs_id|obs)\s*[:=]\s*([^,;|\s]+)/i
    );
    const labeledCountryMatch = raw.match(
      /(country|countryName|country_name)\s*[:=]\s*([^,;|\s]+)/i
    );

    if (labeledLatMatch || labeledLngMatch) {
      const result: any = {};
      if (labeledLatMatch) {
        const lat = parseFloat(labeledLatMatch[2]);
        if (!isNaN(lat)) result.latitude = lat;
      }
      if (labeledLngMatch) {
        const lng = parseFloat(labeledLngMatch[2]);
        if (!isNaN(lng)) result.longitude = lng;
      }
      if (labeledAdminMatch) {
        const admin = labeledAdminMatch[2];
        if (admin !== undefined && admin !== null && String(admin) !== "") {
          result.adminCode = String(admin);
        }
      }
      if (labeledObsIdMatch) {
        const obsId = labeledObsIdMatch[2];
        if (obsId !== undefined && obsId !== null && String(obsId) !== "") {
          result.obsId = String(obsId);
        }
      }
      if (labeledCountryMatch) {
        const country = labeledCountryMatch[2];
        if (
          country !== undefined &&
          country !== null &&
          String(country) !== ""
        ) {
          result.country = String(country);
        }
      }
      if (this.debugLocationLogCount < 20) {
        try {
          this.debugLocationLogCount++;
        } catch {}
      }
      return result;
    }

    // As a last resort, extract first two numbers in the string as lat/lng
    // BUT ONLY when there are no delimiters present, to avoid misreading admin-only strings
    if (!/[|;,]/.test(raw)) {
      const numberMatches = raw.match(/-?\d+(?:\.\d+)?/g);
      if (numberMatches && numberMatches.length >= 2) {
        const lat = parseFloat(numberMatches[0]);
        const lng = parseFloat(numberMatches[1]);
        const result: any = {};
        if (!isNaN(lat) && lat >= -90 && lat <= 90) result.latitude = lat;
        if (!isNaN(lng) && lng >= -180 && lng <= 180) result.longitude = lng;
        if (this.debugLocationLogCount < 20) {
          try {
            this.debugLocationLogCount++;
          } catch {}
        }
        return result;
      }
    }

    // Fallback: single admin code
    const fallback = { adminCode: raw } as any;
    if (this.debugLocationLogCount < 20) {
      try {
        this.debugLocationLogCount++;
      } catch {}
    }
    return fallback;
  }

  // Helper: extract lat/lng/admin/obsId/country for a row, preferring explicit roles over combined location
  private getLatLngAdminForRow(
    row: any[],
    columns: any[]
  ): {
    latitude?: number;
    longitude?: number;
    adminCode?: string;
    obsId?: string;
    country?: string;
    refId?: string;
  } {
    const latIdx = this.getColumnIndexByRole(columns, "latitude");
    const lngIdx = this.getColumnIndexByRole(columns, "longitude");
    const adminIdx = this.getColumnIndexByRole(columns, "adminCode");
    const locationIdx = this.getColumnIndexByRole(columns, "location");

    const result: any = {};

    if (latIdx >= 0 && row[latIdx] !== undefined && row[latIdx] !== null) {
      const lat = parseFloat(String(row[latIdx]));
      if (!isNaN(lat)) result.latitude = lat;
    }
    if (lngIdx >= 0 && row[lngIdx] !== undefined && row[lngIdx] !== null) {
      const lng = parseFloat(String(row[lngIdx]));
      if (!isNaN(lng)) result.longitude = lng;
    }
    if (
      adminIdx >= 0 &&
      row[adminIdx] !== undefined &&
      row[adminIdx] !== null
    ) {
      const admin = String(row[adminIdx]);
      if (admin && admin !== "undefined" && admin !== "null")
        result.adminCode = admin;
    }

    if (
      result.latitude === undefined ||
      result.longitude === undefined ||
      result.adminCode === undefined
    ) {
      if (locationIdx >= 0) {
        if (this.debugLocationValueLogCount < 50) {
          try {
            const colName = columns[locationIdx]?.displayName || "location";
            this.debugLocationValueLogCount++;
          } catch {}
        }
        const parsed = this.parseLocationField(row[locationIdx]);
        if (result.latitude === undefined && parsed.latitude !== undefined)
          result.latitude = parsed.latitude;
        if (result.longitude === undefined && parsed.longitude !== undefined)
          result.longitude = parsed.longitude;
        if (result.adminCode === undefined && parsed.adminCode !== undefined)
          result.adminCode = parsed.adminCode;
        if (result.obsId === undefined && parsed.obsId !== undefined)
          result.obsId = parsed.obsId;
        if (result.country === undefined && parsed.country !== undefined)
          result.country = parsed.country;
        if (result.refId === undefined && parsed.refId !== undefined)
          result.refId = parsed.refId;
        if (this.debugLocationLogCount < 20) {
          try {
            this.debugLocationLogCount++;
          } catch {}
        }
      }
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
      // This ensures only Power BI choropleth features are interactive
    }
  }

  // Performance monitoring helper
  private logPerformance(operation: string, startTime: number) {
    const duration = performance.now() - startTime;
    return duration;
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
        // Group markers by country and count ObsIDs
        const countryData = this.groupMarkersByCountry(childMarkers);

        // Create and show tooltip
        const tooltipContent = this.buildClusterTooltipContent(countryData);
        this.showTooltip(tooltipContent, e.latlng);

        // Prevent default cluster behavior
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      }
    }
  }

  // Group markers by country using adminCode data
  private groupMarkersByCountry(
    markers: L.Marker[]
  ): Map<string, { countryName: string; obsIds: string[] }> {
    const countryMap = new Map<
      string,
      { countryName: string; obsIds: string[] }
    >();

    // Handle table data (primary format)
    if (
      this.currentDataView?.table?.columns &&
      this.currentDataView?.table?.rows
    ) {
      const columns = this.currentDataView.table.columns;

      // Get the original row data for each marker
      markers.forEach((marker) => {
        const markerIndex = this.markers.indexOf(marker);

        if (
          markerIndex >= 0 &&
          markerIndex < this.currentDataView.table.rows.length
        ) {
          const row = this.currentDataView.table.rows[markerIndex];

          // Use the same logic as the rest of the code to get admin code, obsId, and country
          const info = this.getLatLngAdminForRow(row, columns);
          const adminCode = info.adminCode;
          const obsId = info.obsId;
          const country = info.country;

          // Skip markers without country information
          if (!country) {
            return;
          }

          // Use country name as the grouping key
          const groupKey = country;

          if (countryMap.has(groupKey)) {
            // Add the ObsID if available
            if (obsId) {
              countryMap.get(groupKey)!.obsIds.push(obsId);
            } else {
              // Add a placeholder for markers without ObsID data
              countryMap
                .get(groupKey)!
                .obsIds.push(`Marker ${markerIndex + 1}`);
            }
          } else {
            countryMap.set(groupKey, {
              countryName: country,
              obsIds: obsId ? [obsId] : [`Marker ${markerIndex + 1}`],
            });
          }
        }
      });
    }
    // Handle categorical data (fallback)
    else if (this.currentDataView?.categorical?.categories) {
      markers.forEach((marker, index) => {
        const markerIndex = this.markers.indexOf(marker);

        if (markerIndex >= 0) {
          // Get location info and refId from the marker's stored data
          const locationInfo = (marker as any).locationInfo;
          const refId = (marker as any).refId;

          if (locationInfo) {
            const obsId = locationInfo.obsId;
            const country = locationInfo.country;

            // Skip markers without country information
            if (!country) {
              return;
            }

            // Use country name as the grouping key
            const groupKey = country;

            if (countryMap.has(groupKey)) {
              // Add the ObsID if available
              if (obsId) {
                countryMap.get(groupKey)!.obsIds.push(obsId);
              } else {
                // Add a placeholder for markers without ObsID data
                countryMap
                  .get(groupKey)!
                  .obsIds.push(`Marker ${markerIndex + 1}`);
              }
            } else {
              countryMap.set(groupKey, {
                countryName: country,
                obsIds: obsId ? [obsId] : [`Marker ${markerIndex + 1}`],
              });
            }
          }
        }
      });
      return countryMap;
    }

    // Note: Removed legacy duplicate table processing to avoid double counting

    return countryMap;
  }

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
  private buildClusterTooltipContent(
    countryData: Map<string, { countryName: string; obsIds: string[] }>
  ): string {
    if (countryData.size === 0) {
      return '<div class="tooltip-row"><span class="field-name">No data available</span></div>';
    }

    const tooltipParts: string[] = [];

    // Show each country with its ObsID information
    countryData.forEach((data, adminCode) => {
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Country</span><span class="field-value">${data.countryName}</span></div>`
      );

      // Ensure unique ObsIDs to avoid repeat entries
      const uniqueObsIds = Array.from(new Set(data.obsIds));

      if (uniqueObsIds.length === 1) {
        // Show actual ObsID when count is 1
        tooltipParts.push(
          `<div class="tooltip-row"><span class="field-name">Obs</span><span class="field-value">${uniqueObsIds[0]}</span></div>`
        );
      } else {
        // Show count when more than 1
        tooltipParts.push(
          `<div class="tooltip-row"><span class="field-name">Obs Count</span><span class="field-value">${uniqueObsIds.length}</span></div>`
        );
      }
    });

    return this.buildTooltipWithOddDividers(tooltipParts);
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

  // Simple helper function to load map data
  private loadMapData() {
    const startTime = performance.now();

    try {
      const geoData = customGeoJSON;

      // Add to base map layer
      this.baseMapLayer.addData(geoData);
      this.map.addLayer(this.baseMapLayer);

      // Mark map as loaded
      this.mapLoaded = true;

      // Load disputed borders from URL only after map is fully loaded
      setTimeout(() => {
        this.handleDisputedBordersUrlChange();
      }, 100);

      // Don't fit bounds - keep our desired zoom level 2
      // This prevents the jarring zoom-in-then-zoom-out effect

      this.logPerformance("Map data loading", startTime);
    } catch (error) {
      this.map.setView([20, 0], 2);
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

      // Force choropleth layer update when both GeoJSON and data are ready
      this.forceChoroplethUpdate();

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

  // Choropleth styling method
  private getChoroplethStyle(feature: any): L.PathOptions {
    // Since we only add matching features to the choropleth layer, all features should be styled as matches
    return {
      fillColor: "#455E6F", // Blue-gray for all choropleth features (they are all matches)
      weight: 1,
      opacity: 1,
      fillOpacity: 1,
      color: "black", // Black border for all choropleth features
    };
  }

  // Choropleth feature handler
  private onEachChoroplethFeature(feature: any, layer: L.Layer): void {
    // Use cached admin codes instead of calling getAdminCodesFromData repeatedly
    const adminCodes = this.cachedAdminCodes;
    const gaulCode = feature.properties?.gaul0_code;
    const isMatch = adminCodes.includes(String(gaulCode));

    if (isMatch) {
      // Get choropleth tooltip data for this region
      const choroplethTooltipData =
        this.getChoroplethTooltipDataForRegion(gaulCode);
      const regionName =
        feature.properties?.gaul0_name ||
        feature.properties?.disp_en ||
        "Unknown Region";

      layer.on("click", (e) => {
        // Show tooltip on click with choropleth data using same format as markers
        const tooltipContent = this.buildChoroplethTooltipContent(gaulCode);
        this.showTooltip(tooltipContent, e.latlng);

        // Stop event propagation to prevent map click
        L.DomEvent.stopPropagation(e);
      });
    }
  }

  // Get all Admin Codes from current data (with caching)
  private getAdminCodesFromData(): string[] {
    // Return cached admin codes if available
    if (this.cachedAdminCodes.length > 0) {
      return this.cachedAdminCodes;
    }

    const adminCodes: string[] = [];

    // Handle table data (primary format)
    if (
      this.currentDataView?.table?.columns &&
      this.currentDataView?.table?.rows
    ) {
      const columns = this.currentDataView.table.columns;
      const tableAdminCodes = this.currentDataView.table.rows
        .map((row) => this.getLatLngAdminForRow(row, columns).adminCode)
        .filter((code) => !!code) as string[];
      adminCodes.push(...tableAdminCodes);
    }
    // Handle categorical data (fallback)
    else if (this.currentDataView?.categorical?.categories) {
      const locationCategory = this.currentDataView.categorical.categories[0];
      if (locationCategory && locationCategory.values) {
        locationCategory.values.forEach((locationValue: any) => {
          const locationInfo = this.parseLocationField(locationValue);
          if (locationInfo.adminCode) {
            adminCodes.push(locationInfo.adminCode);
          }
        });
      }
    }

    // Cache the admin codes
    this.cachedAdminCodes = adminCodes;
    return adminCodes;
  }

  // Get choropleth tooltip data for a specific region (GAUL code)
  private getChoroplethTooltipDataForRegion(gaulCode: any): string | null {
    if (
      !this.currentDataView?.table?.columns ||
      !this.currentDataView?.table?.rows
    ) {
      return null;
    }

    const columns = this.currentDataView.table.columns;
    const choroplethTooltipColIndex = columns.findIndex(
      (col) => col.roles?.choroplethTooltip
    );

    if (choroplethTooltipColIndex === -1) {
      return null;
    }

    // Find the first row that matches this GAUL code
    const matchingRow = this.currentDataView.table.rows.find((row) => {
      const info = this.getLatLngAdminForRow(row, columns);
      return (
        info.adminCode !== undefined &&
        String(info.adminCode) === String(gaulCode)
      );
    });

    if (matchingRow) {
      const choroplethTooltipValue = matchingRow[choroplethTooltipColIndex];
      return choroplethTooltipValue ? String(choroplethTooltipValue) : null;
    }

    return null;
  }

  // Build choropleth tooltip content using same format as cluster tooltips
  private buildChoroplethTooltipContent(gaulCode: any): string {
    const obsIds: string[] = [];
    let countryName: string | null = null;

    // Handle table data (primary format)
    if (
      this.currentDataView?.table?.columns &&
      this.currentDataView?.table?.rows
    ) {
      const columns = this.currentDataView.table.columns;

      // Find ALL rows that match this GAUL code
      const matchingRows = this.currentDataView.table.rows.filter((row) => {
        const info = this.getLatLngAdminForRow(row, columns);
        return (
          info.adminCode !== undefined &&
          String(info.adminCode) === String(gaulCode)
        );
      });

      if (matchingRows.length > 0) {
        // Get country name from first matching row's location field, or from GeoJSON
        const firstRowInfo = this.getLatLngAdminForRow(
          matchingRows[0],
          columns
        );
        countryName =
          firstRowInfo.country ||
          this.getCountryNameFromAdminCode(String(gaulCode));

        // Collect all ObsIDs for this country from location field
        matchingRows.forEach((row) => {
          const info = this.getLatLngAdminForRow(row, columns);
          if (
            info.obsId !== undefined &&
            info.obsId !== null &&
            info.obsId !== ""
          ) {
            obsIds.push(String(info.obsId));
          }
        });
      }
    }

    if (obsIds.length === 0) {
      return `Matched Region (Code: ${gaulCode})`;
    }

    const tooltipParts: string[] = [];

    // Add country information
    tooltipParts.push(
      `<div class="tooltip-row"><span class="field-name">Country</span><span class="field-value">${
        countryName ||
        this.getCountryNameFromAdminCode(String(gaulCode)) ||
        `Country ${gaulCode}`
      }</span></div>`
    );

    // Add ObsID information
    if (obsIds.length === 1) {
      // Show actual ObsID when count is 1
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Obs</span><span class="field-value">${obsIds[0]}</span></div>`
      );
    } else {
      // Show count when more than 1
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Obs Count</span><span class="field-value">${obsIds.length}</span></div>`
      );
    }

    return this.buildTooltipWithOddDividers(tooltipParts);
  }

  // Update choropleth layer with current data
  private updateChoroplethLayer(): void {
    if (!this.choroplethLayer) {
      return;
    }

    if (this.geoJsonFeatures.length === 0) {
      return;
    }

    // Check if we have data to process
    if (
      !this.currentDataView?.table?.rows ||
      this.currentDataView.table.rows.length === 0
    ) {
      return;
    }

    // Show loader for choropleth processing
    this.showLoader("choropleth");

    // Clear existing choropleth data
    this.choroplethLayer.clearLayers();

    // Get Admin Codes from current data (with caching)
    const adminCodes = this.getAdminCodesFromData();

    // Find matching features and create choropleth polygons
    const matchingFeatures = this.geoJsonFeatures.filter((feature) => {
      const gaulCode = feature.properties?.gaul_code;
      const gaulCodeStr = String(gaulCode);

      const isMatch = adminCodes.includes(gaulCodeStr);

      return isMatch;
    });

    // Only add choropleth layer to map if we have matching features
    if (matchingFeatures.length > 0) {
      this.choroplethLayer.addData({
        type: "FeatureCollection",
        features: matchingFeatures,
      } as any);

      // Add choropleth layer to map if not already added
      if (!this.map.hasLayer(this.choroplethLayer)) {
        this.choroplethLayer.addTo(this.map);
      }
    } else {
      // Remove choropleth layer from map if no matches
      if (this.map.hasLayer(this.choroplethLayer)) {
        this.map.removeLayer(this.choroplethLayer);
      }
    }

    // Hide loader after choropleth processing is complete
    this.hideLoader("choropleth");
  }

  // Force choropleth layer update when both GeoJSON and data are ready
  private forceChoroplethUpdate(): void {
    if (
      this.mapLoaded &&
      this.choroplethLayer &&
      this.geoJsonFeatures.length > 0 &&
      this.currentDataView?.table?.rows &&
      this.currentDataView.table.rows.length > 0
    ) {
      this.updateChoroplethLayer();
    }
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
      //   • Choropleth data loaded from Power BI geometryString
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

  // Process categorical data from two separate datasets (location and refId)
  private processCategoricalData(dataView: DataView) {
    if (!dataView.categorical) {
      return;
    }

    // Clear cached admin codes when processing new data
    this.cachedAdminCodes = [];

    // Get location data from first categorical dataset
    const locationCategories = dataView.categorical.categories;

    if (!locationCategories || locationCategories.length === 0) {
      this.clearAllData();
      this.showEmptyState();
      return;
    }

    // Get refId data from table (if available)
    let refIdData: any[] = [];
    if (dataView.table && dataView.table.rows) {
      const refIdColIndex = dataView.table.columns.findIndex(
        (col) => col.roles?.refId
      );
      if (refIdColIndex >= 0) {
        refIdData = dataView.table.rows.map((row) => row[refIdColIndex]);
      }
    }

    const locationCategory = locationCategories[0]; // First dataset

    // Create selection IDs for markers
    this.createSelectionIdsFromCategorical(dataView);

    // Process markers using categorical data
    this.processMarkersFromCategoricalWithTable(
      locationCategory,
      refIdData,
      dataView
    );

    // Force choropleth layer update when both GeoJSON and data are ready
    this.forceChoroplethUpdate();
  }

  // Process table data (backward compatibility)
  private processTableData(dataView: DataView) {
    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      this.clearAllData();
      this.showEmptyState();
      return;
    }

    // Clear cached admin codes when processing new data
    this.cachedAdminCodes = [];

    // Create selection IDs for markers FIRST
    this.createSelectionIds(dataView);

    // Process marker data from Power BI (lat/long) AFTER selection IDs are created
    this.processMarkerData(dataView);

    // Force choropleth layer update when both GeoJSON and data are ready
    this.forceChoroplethUpdate();
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

  // Process markers from categorical data
  private processMarkersFromCategorical(
    locationCategory: any,
    refIdCategory: any,
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

    // Process each location value
    locationCategory.values.forEach((locationValue: any, index: number) => {
      // Parse location field
      const locationInfo = this.parseLocationField(locationValue);

      // Get refId if available
      let refId = undefined;
      if (
        refIdCategory &&
        refIdCategory.values &&
        refIdCategory.values[index]
      ) {
        refId = refIdCategory.values[index];
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

        // Always use orange color for markers
        const markerColor = "#F9B112";

        // Create custom marker with dynamic color styling
        const customMarkerIcon = L.divIcon({
          className: "custom-marker",
          html: `
              <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.5 0C5.596 0 0 5.596 0 12.5c0 9.375 12.5 28.5 12.5 28.5s12.5-19.125 12.5-28.5C25 5.596 19.404 0 12.5 0z" fill="${markerColor}"/>
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

        // Add selection ID to marker
        if (this.selectionIds && this.selectionIds[index]) {
          (marker as any).options.selectionId = this.selectionIds[index];
        }

        // Store location info and refId for tooltip
        (marker as any).locationInfo = locationInfo;
        (marker as any).refId = refId;

        // Add click handler for selection
        marker.on("click", (event) => {
          // Build tooltip content
          const tooltipContent = this.buildCategoricalTooltipContent(
            locationInfo,
            refId
          );
          this.showTooltip(tooltipContent, event.latlng);

          // Handle selection if selection ID exists
          if (this.selectionIds && this.selectionIds[index]) {
            const clickedSelectionId = this.selectionIds[index];

            // Check if this marker is already selected
            const isCurrentlySelected = this.currentSelection.some((id) => {
              if (!id || !clickedSelectionId) return false;
              if (id.getKey && clickedSelectionId.getKey) {
                return id.getKey() === clickedSelectionId.getKey();
              }
              if (id.toString && clickedSelectionId.toString) {
                return id.toString() === clickedSelectionId.toString();
              }
              return id === clickedSelectionId;
            });

            if (isCurrentlySelected) {
              // Deselect the marker
              this.selectionManager
                .clear()
                .then(() => {
                  this.currentSelection = [];
                  this.persistentSelection = [];
                  this.updateMarkersVisibility([]);
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

    // Process each location value
    locationCategory.values.forEach((locationValue: any, index: number) => {
      // Parse location field
      const locationInfo = this.parseLocationField(locationValue);

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

        // Always use orange color for markers
        const markerColor = "#F9B112";

        // Create custom marker with dynamic color styling
        const customMarkerIcon = L.divIcon({
          className: "custom-marker",
          html: `
              <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.5 0C5.596 0 0 5.596 0 12.5c0 9.375 12.5 28.5 12.5 28.5s12.5-19.125 12.5-28.5C25 5.596 19.404 0 12.5 0z" fill="${markerColor}"/>
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

        // Add selection ID to marker
        if (this.selectionIds && this.selectionIds[index]) {
          (marker as any).options.selectionId = this.selectionIds[index];
        }

        // Store location info and refId for tooltip
        (marker as any).locationInfo = locationInfo;
        (marker as any).refId = refId;

        // Add click handler for selection
        marker.on("click", (event) => {
          // Build tooltip content
          const tooltipContent = this.buildCategoricalTooltipContent(
            locationInfo,
            refId
          );
          this.showTooltip(tooltipContent, event.latlng);

          // Handle selection if selection ID exists
          if (this.selectionIds && this.selectionIds[index]) {
            const clickedSelectionId = this.selectionIds[index];

            // Check if this marker is already selected
            const isCurrentlySelected = this.currentSelection.some((id) => {
              if (!id || !clickedSelectionId) return false;
              if (id.getKey && clickedSelectionId.getKey) {
                return id.getKey() === clickedSelectionId.getKey();
              }
              if (id.toString && clickedSelectionId.toString) {
                return id.toString() === clickedSelectionId.toString();
              }
              return id === clickedSelectionId;
            });

            if (isCurrentlySelected) {
              // Deselect the marker
              this.selectionManager
                .clear()
                .then(() => {
                  this.currentSelection = [];
                  this.persistentSelection = [];
                  this.updateMarkersVisibility([]);
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
  private buildCategoricalTooltipContent(
    locationInfo: any,
    refId: any
  ): string {
    const tooltipParts: string[] = [];

    // Add Obs ID from location field if available
    if (
      locationInfo.obsId !== undefined &&
      locationInfo.obsId !== null &&
      locationInfo.obsId !== ""
    ) {
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Obs ID</span><span class="field-value">${locationInfo.obsId}</span></div>`
      );
    }

    // Add Country from location field if available
    if (
      locationInfo.country !== undefined &&
      locationInfo.country !== null &&
      locationInfo.country !== ""
    ) {
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Country</span><span class="field-value">${locationInfo.country}</span></div>`
      );
    }

    return this.buildTooltipWithOddDividers(tooltipParts);
  }

  private processMarkerData(dataView: DataView) {
    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      return;
    }

    // Clear cached admin codes when processing new data
    this.cachedAdminCodes = [];

    const columns = dataView.table.columns;
    const values = dataView.table.rows;

    // Get Ref ID field for filtering (contains comma-separated list of visible Ref IDs)
    const refIdColIndex = columns.findIndex((col) => col.roles?.refId);
    let refIdFilterString = "";
    if (refIdColIndex >= 0 && values.length > 0) {
      refIdFilterString = String(values[0][refIdColIndex] || "");
    }

    // Build markers using either explicit lat/lng or the combined location field
    const extracted = values.map((row) =>
      this.getLatLngAdminForRow(row, columns)
    );
    const validCoordinateRows = values
      .map((row, idx) => ({ row, idx, info: extracted[idx] }))
      .filter(
        (o) =>
          o.info &&
          o.info.latitude !== undefined &&
          o.info.longitude !== undefined &&
          !isNaN(o.info.latitude as number) &&
          !isNaN(o.info.longitude as number)
      );

    if (validCoordinateRows.length > 0) {
      // Found latitude/longitude columns for markers
      // Latitude column index: finalLatColIndex, name: columns[finalLatColIndex]?.displayName
      // Longitude column index: finalLngColIndex, name: columns[finalLngColIndex]?.displayName

      // Debug: Show actual values in the first few rows
      // First 3 rows of lat/lng data

      // validCoordinateRows already computed above using combined/existing fields

      // Clear existing markers
      this.markers.forEach((marker) => {
        this.markerClusterGroup.removeLayer(marker);
      });
      this.markers = [];

      // Clear the cluster group
      this.markerClusterGroup.clearLayers();

      // Create markers only for rows with valid coordinates
      validCoordinateRows.forEach((o) => {
        const lat = o.info.latitude as number;
        const lng = o.info.longitude as number;

        // Always use orange color for markers
        const markerColor = "#F9B112";

        // Create custom marker with dynamic color styling
        const customMarkerIcon = L.divIcon({
          className: "custom-marker",
          html: `
              <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.5 0C5.596 0 0 5.596 0 12.5c0 9.375 12.5 28.5 12.5 28.5s12.5-19.125 12.5-28.5C25 5.596 19.404 0 12.5 0z" fill="${markerColor}"/>
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
        const originalRowIndex = o.idx;
        if (this.selectionIds && this.selectionIds[originalRowIndex]) {
          (marker as any).options.selectionId =
            this.selectionIds[originalRowIndex];
        }

        // Store location info and refId for tooltips and clustering
        (marker as any).locationInfo = o.info;

        // Get refId from the location data (first part of the location string)
        const locationRefId = o.info.refId;
        (marker as any).refId = locationRefId;

        // Apply opacity based on Ref ID filtering
        const isRefIdInMeasure = this.isMarkerRefIdInMeasure(
          locationRefId,
          refIdFilterString
        );

        // Store the opacity state on the marker for later use
        (marker as any).refIdFiltered = isRefIdInMeasure;

        // Apply opacity immediately if element is available
        const markerElement = marker.getElement();
        if (markerElement) {
          markerElement.style.opacity = isRefIdInMeasure ? "1" : "0.3";
        } else {
          // If element not available yet, apply opacity after marker is added to map
          marker.on("add", () => {
            const element = marker.getElement();
            if (element) {
              element.style.opacity = isRefIdInMeasure ? "1" : "0.3";
            }
          });
        }

        // Add click handler for selection
        marker.on("click", (event) => {
          // Build tooltip content using stored locationInfo and refId
          const tooltipContent = this.buildCategoricalTooltipContent(
            o.info,
            locationRefId
          );
          this.showTooltip(tooltipContent, event.latlng);

          // Handle selection if selection ID exists
          if (this.selectionIds && this.selectionIds[originalRowIndex]) {
            const clickedSelectionId = this.selectionIds[originalRowIndex];

            // Check if this marker is already selected
            const isCurrentlySelected = this.currentSelection.some((id) => {
              if (!id || !clickedSelectionId) return false;
              if (id.getKey && clickedSelectionId.getKey) {
                return id.getKey() === clickedSelectionId.getKey();
              }
              if (id.toString && clickedSelectionId.toString) {
                return id.toString() === clickedSelectionId.toString();
              }
              return id === clickedSelectionId;
            });

            if (isCurrentlySelected) {
              // Deselect the marker
              this.selectionManager
                .clear()
                .then(() => {
                  this.currentSelection = [];
                  this.persistentSelection = [];
                  // Show markers in filtered data
                  this.updateMarkersVisibility([]);
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

      // Force choropleth layer update when both GeoJSON and data are ready
      this.forceChoroplethUpdate();
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

    // Clear choropleth layer
    if (this.choroplethLayer) {
      this.choroplethLayer.clearLayers();
    }

    // Clear cached admin codes
    this.cachedAdminCodes = [];

    // Reset map loaded flag
    this.mapLoaded = false;
  }

  private updateMarkersVisibility(selectedIds: ISelectionId[]) {
    let visibleMarkers = 0;
    let hiddenMarkers = 0;

    this.markers.forEach((marker, index) => {
      const markerSelectionId = (marker as any).options.selectionId;

      // Skip markers without selection IDs
      if (!markerSelectionId) {
        return;
      }

      // Check if this marker should be visible based on Power BI filtering
      // A marker should be visible if:
      // 1. It's in the current filtered data view (Power BI filtering), OR
      // 2. It's explicitly selected by the user (cross-filtering)
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

      // For manual selection: show all markers but dim non-selected ones
      // For Power BI filtering: show markers that are in the filtered data
      const shouldBeVisible =
        selectedIds.length > 0 ? isInFilteredData : isInFilteredData;

      if (shouldBeVisible) {
        // Show marker
        if (!this.markerClusterGroup.hasLayer(marker)) {
          this.markerClusterGroup.addLayer(marker);
          visibleMarkers++;
        } else {
          visibleMarkers++;
        }

        // Apply opacity based on selection and Ref ID filtering
        const markerElement = marker.getElement();
        if (markerElement) {
          // Get Ref ID filtering state
          const isRefIdFiltered = (marker as any).refIdFiltered;

          if (selectedIds.length > 0) {
            // If there are selections, dim non-selected markers
            const isSelected = isExplicitlySelected;
            if (isSelected) {
              // Selected marker: use Ref ID filtering opacity
              markerElement.style.opacity = isRefIdFiltered ? "1" : "0.3";
            } else {
              // Non-selected marker: dim further
              markerElement.style.opacity = isRefIdFiltered ? "0.5" : "0.15";
            }
          } else {
            // No selections, use Ref ID filtering opacity
            markerElement.style.opacity = isRefIdFiltered ? "1" : "0.3";
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

  private updateClusterOpacity(selectedIds: ISelectionId[]) {
    // Use a timeout to ensure clusters are rendered before updating opacity
    setTimeout(() => {
      const clusterElements = document.querySelectorAll(
        ".marker-cluster-small, .marker-cluster-medium, .marker-cluster-large"
      );

      clusterElements.forEach((clusterElement) => {
        // Access the Leaflet layer via DOM traversal is not reliable; instead, approximate by checking child markers' selection
        // We'll compute based on bounds overlap with selected markers' layers present in the cluster group
        // Simpler approach: if any visible selected marker exists, dim clusters that don't contain selected markers

        if (selectedIds.length === 0) {
          (clusterElement as HTMLElement).style.opacity = "1";
          return;
        }

        // Determine if this cluster contains any selected marker by probing nearby markers via DOM ancestors
        // Fallback heuristic: if any selected marker element exists inside this cluster element
        const markerChildren = clusterElement.querySelectorAll(
          ".leaflet-marker-icon"
        );
        let hasSelected = false;
        markerChildren.forEach((el) => {
          const opacity = (el as HTMLElement).style.opacity;
          if (opacity === "1") {
            hasSelected = true;
          }
        });

        (clusterElement as HTMLElement).style.opacity = hasSelected
          ? "1"
          : "0.5";
      });
    }, 100);
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

  private buildMarkerTooltipContent(row: any[], columns: any[]): string {
    const tooltipParts: string[] = [];

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
      const info = this.getLatLngAdminForRow(row, columns);
      if (info.latitude !== undefined && info.longitude !== undefined) {
        const lat = info.latitude;
        const lng = info.longitude;
        tooltipParts.push(
          `<div class="tooltip-row"><span class="field-name">Latitude</span><span class="field-value">${lat}</span></div>`
        );
        tooltipParts.push(
          `<div class="tooltip-row"><span class="field-name">Longitude</span><span class="field-value">${lng}</span></div>`
        );
      }
    }

    return this.buildTooltipWithOddDividers(tooltipParts);
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

  private getCurrentDataContext(): ISelectionId[] {
    try {
      return this.selectionIds.filter((id, index) => {
        return (
          this.markers[index] &&
          this.markerClusterGroup.hasLayer(this.markers[index])
        );
      });
    } catch (error) {
      return [];
    }
  }

  private handleMarkerDeselection(clickedMarkerIndex: number): void {
    try {
      // When deselecting, show markers that are in the current Power BI filtered data
      // This respects Power BI filters while clearing manual selections
      this.updateMarkersVisibility([]);
    } catch (error) {
      // Fallback: show markers in filtered data
      this.updateMarkersVisibility([]);
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

  private restoreSelectionState(): void {
    try {
      if (this.persistentSelection.length > 0) {
        this.currentSelection = [...this.persistentSelection];
        this.updateMarkersVisibility(this.persistentSelection);
      }
    } catch (error) {
      // Error restoring selection state
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
