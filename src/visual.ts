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
import { embeddedCountries } from "./embedded-countries";

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
  };
  geometry: any;
}

export class Visual implements IVisual {
  private target: HTMLElement;
  private map: L.Map;
  private drawControl: L.Control.Draw;
  private selectionManager: ISelectionManager;
  private host: powerbiVisualsApi.extensibility.visual.IVisualHost;
  private markers: L.Marker[] = [];
  private selectionIds: ISelectionId[] = [];
  private choroplethLayer: L.GeoJSON;
  private colorScale: (value: number) => string;
  private choroplethSettings: {
    showChoropleth: boolean;
    colorScheme: string;
  };
  private currentAdminCodes: (number | string)[] = [];
  private naAdminCodes: (number | string)[] = [];
  private defaultGeoJsonLoaded: boolean = false;
  private tooltipDiv: HTMLElement;
  private emptyStateDiv: HTMLElement;
  private choroplethTooltipData: Map<number, any[]> = new Map(); // Map admin code to tooltip data
  private currentSelection: ISelectionId[] = []; // Track current selection state
  private persistentSelection: ISelectionId[] = []; // Track selection state across updates

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
      zoomControl: false, // Disable default zoom control
    }).setView([51.505, -0.09], 2);

    // Add zoom control to top right
    L.control
      .zoom({
        position: "topright",
      })
      .addTo(this.map);

    // Add map click handler to clear selections when clicking on empty areas
    this.map.on("click", (event) => {
      // Only clear if clicking on the map itself, not on markers
      if (
        event.originalEvent &&
        event.originalEvent.target === this.map.getContainer()
      ) {
        console.log("Map clicked - clearing selections");
        // Show only markers in current filtered context instead of all markers
        this.showOnlyCurrentContextMarkers();
      }
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(this.map);

    // Drawn items feature group removed

    // Initialize choropleth layer
    this.choroplethLayer = L.geoJSON(null, {
      style: (feature) => this.getChoroplethStyle(feature),
      onEachFeature: (feature, layer) =>
        this.onEachChoroplethFeature(feature, layer),
    });

    // Draw control removed - no polygon drawing or delete functionality

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
    `;

    // .leaflet-control-attribution a {
    //   display: none !important;
    // }
    // .leaflet-control-attribution img {
    //   display: none !important;
    // }
    document.head.appendChild(style);

    // Draw control event handlers removed

    // Load default GeoJSON file
    this.loadDefaultGeoJson();
  }

  private async loadDefaultGeoJson() {
    try {
      // Use a simpler, more reliable approach for PowerBI Desktop
      const embeddedGeoJson = {
        type: "FeatureCollection",
        name: "GAUL.EFSA",
        features: this.getEmbeddedCountries(),
      };

      // Log available gaul_code values for debugging
      const availableGaulCodes = embeddedGeoJson.features
        .map((f) => ({
          name: f.properties?.gaul0_name,
          gaul_code: f.properties?.gaul_code,
        }))
        .filter((f) => f.gaul_code !== undefined);
      console.log(
        "Available gaul_code values in embedded data:",
        availableGaulCodes.slice(0, 10)
      ); // Show first 10

      // Process the GeoJSON data to add choropleth values
      this.processGeoJsonData(embeddedGeoJson);

      this.addDefaultChoroplethLayer(embeddedGeoJson);
      this.defaultGeoJsonLoaded = true;

      // Trigger empty state check after GeoJSON is loaded
      this.performEmptyStateCheck();
    } catch (error) {
      console.error("Error loading embedded GeoJSON:", error);
      this.defaultGeoJsonLoaded = true;

      // Trigger empty state check even if GeoJSON loading fails
      this.performEmptyStateCheck();
    }
  }

  private getEmbeddedCountries() {
    // Return the real country geometries extracted from the original GeoJSON file
    return embeddedCountries;
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
      // Add a new scheme that works well with country data
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
      ] || colorSchemes.Viridis; // Use Viridis as default for better visualization

    return (value: number): string => {
      if (value === null || value === undefined || isNaN(value)) {
        return colors[0]; // Return first color for null/undefined values
      }

      // Clamp value between 0 and 1
      const clampedValue = Math.max(0, Math.min(1, value));

      // Map to color index
      const index = Math.min(
        Math.floor(clampedValue * (colors.length - 1)),
        colors.length - 1
      );

      return colors[index];
    };
  }

  private getChoroplethStyle(feature: any) {
    // Check if admin code matches any of the current admin codes
    const featureGaulCode = feature.properties?.gaul_code;
    const shouldApplyChoropleth =
      this.currentAdminCodes.length > 0 &&
      (this.currentAdminCodes.includes(featureGaulCode) ||
        this.currentAdminCodes.includes(featureGaulCode?.toString()) ||
        this.currentAdminCodes.includes(parseFloat(featureGaulCode)));

    return {
      fillColor: shouldApplyChoropleth ? "#455E6F" : "transparent",
      weight: 2,
      opacity: 1,
      color: shouldApplyChoropleth ? "black" : "#ccc",
      fillOpacity: shouldApplyChoropleth ? 0.7 : 0,
    };
  }

  private onEachChoroplethFeature(feature: any, layer: L.Layer) {
    // Enhanced interaction based on Leaflet GeoJSON examples
    if (feature.properties) {
      const name =
        feature.properties.name ||
        feature.properties.gaul0_name ||
        feature.properties.disp_en ||
        "Unknown Region";
      const value = feature.properties.choropleth_value || "N/A";
      const countryCode = feature.properties.iso3_code || "";
      const continent = feature.properties.continent || "";

      // Check if this feature should have choropleth styling
      const featureGaulCode = feature.properties?.gaul_code;
      const shouldApplyChoropleth =
        this.currentAdminCodes.length > 0 &&
        (this.currentAdminCodes.includes(featureGaulCode) ||
          this.currentAdminCodes.includes(featureGaulCode?.toString()) ||
          this.currentAdminCodes.includes(parseFloat(featureGaulCode)));

      // Only add basic click effects for active choropleth countries
      // Tooltip interactions will be set up later when data is available
      if (shouldApplyChoropleth) {
        layer.on({
          click: (e) => {
            const layer = e.target;
            layer.setStyle({
              weight: 3,
              color: "#666",
              fillOpacity: 0.9,
            });
            layer.bringToFront();

            // Reset style after 2 seconds
            setTimeout(() => {
              this.choroplethLayer.resetStyle(e.target);
            }, 2000);
          },
        });
      }
    }
  }

  public update(options: VisualUpdateOptions) {
    try {
      const dataView: DataView = options.dataViews[0];

      // Reset admin codes when no data
      if (
        !dataView ||
        !dataView.table ||
        !dataView.table.columns ||
        !dataView.table.rows
      ) {
        this.currentAdminCodes = [];
        this.naAdminCodes = [];
        // If no data, just ensure default GeoJSON is loaded
        if (!this.defaultGeoJsonLoaded) {
          this.loadDefaultGeoJson();
        }
        // Refresh choropleth to show no highlighting
        if (this.choroplethLayer) {
          this.choroplethLayer.setStyle((feature) =>
            this.getDefaultChoroplethStyle(feature)
          );
        }
        // Clear markers and show empty state when no data
        this.markers.forEach((marker) => {
          this.map.removeLayer(marker);
        });
        this.markers = [];
        // Clear selection state when no data
        this.currentSelection = [];
        this.persistentSelection = [];
        this.showEmptyState();
        return;
      }

      // Update choropleth settings if available
      this.choroplethSettings.showChoropleth = true;
      this.choroplethSettings.colorScheme = "Viridis"; // Use Viridis for better visualization
      this.colorScale = this.createColorScale();

      const values = dataView.table.rows;

      // Read all admin codes from Power BI data (from the 3rd column - index 2)
      if (values.length > 0 && values[0].length >= 3) {
        // Collect all valid admin codes and NA admin codes from the dataset
        this.currentAdminCodes = [];
        this.naAdminCodes = [];

        let validAdminCodes = 0;
        let naAdminCodes = 0;
        let invalidAdminCodes = 0;

        for (let i = 0; i < values.length; i++) {
          const rowAdminCode = values[i][2];
          if (
            rowAdminCode !== null &&
            rowAdminCode !== undefined &&
            rowAdminCode !== "NA"
          ) {
            const adminCode = parseFloat(rowAdminCode.toString());
            if (!isNaN(adminCode)) {
              this.currentAdminCodes.push(adminCode);
              validAdminCodes++;
            } else {
              // Try as string comparison as well
              this.currentAdminCodes.push(rowAdminCode.toString());
              validAdminCodes++;
            }
          } else if (rowAdminCode === "NA") {
            // For NA admin codes, we need to determine which country this represents
            // Since we don't have country mapping in the data, we'll need to use
            // the latitude/longitude to find the corresponding country
            const lat = parseFloat(values[i][0].toString());
            const lng = parseFloat(values[i][1].toString());
            if (!isNaN(lat) && !isNaN(lng)) {
              // Find the country that contains this point
              const countryCode = this.findCountryByCoordinates(lat, lng);
              if (countryCode !== null) {
                this.naAdminCodes.push(countryCode);
                naAdminCodes++;
              }
            }
          }
        }

        // Debug logging for admin codes
        console.log("Power BI Admin Codes:", this.currentAdminCodes);
        console.log("NA Admin Codes:", this.naAdminCodes);
        console.log("Valid Admin Codes Count:", validAdminCodes);
        console.log("NA Admin Codes Count:", naAdminCodes);
        console.log("Invalid Admin Codes Count:", invalidAdminCodes);

        // Process choropleth tooltip data
        this.processChoroplethTooltipData(dataView);

        // Force the analysis to run
        this.hasActiveChoroplethData();

        // Refresh choropleth with all admin codes and update tooltip interactions
        if (this.choroplethLayer) {
          this.choroplethLayer.setStyle((feature) =>
            this.getDefaultChoroplethStyle(feature)
          );

          // Update tooltip interactions for all features
          this.choroplethLayer.eachLayer((layer: any) => {
            if (layer.feature) {
              this.updateChoroplethTooltipInteraction(layer.feature, layer);
            }
          });
        }
      } else {
      }
      this.selectionIds = values.map((row, index) => {
        return this.host
          .createSelectionIdBuilder()
          .withTable(dataView.table, index)
          .createSelectionId();
      });

      // Clear existing markers
      this.markers.forEach((marker) => {
        this.map.removeLayer(marker);
      });
      this.markers = [];

      // DO NOT process or display any choropleth boundaries from Power BI data
      // Only show the imported file as boundaries

      // Add markers (existing functionality)
      try {
        for (let i = 0; i < values.length; i++) {
          const row = values[i];

          // Validate latitude and longitude values
          const lat = parseFloat(row[0]?.toString() || "");
          const lng = parseFloat(row[1]?.toString() || "");

          // Check if coordinates are valid numbers and within reasonable bounds
          if (
            row[0] !== null &&
            row[0] !== undefined &&
            row[1] !== null &&
            row[1] !== undefined &&
            !isNaN(lat) &&
            !isNaN(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180
          ) {
            // Create custom marker with exact color #22294d
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

            // Build dynamic tooltip content from tooltip fields
            let tooltipContent = "";

            // Try to get field names from the dataView metadata
            const tooltipFields = dataView.table.columns.filter(
              (col) => col.roles && col.roles.tooltip
            );

            if (tooltipFields.length > 0) {
              // Build tooltip with field names and values
              const tooltipParts = [];
              for (const field of tooltipFields) {
                const columnIndex = dataView.table.columns.indexOf(field);

                if (
                  columnIndex >= 0 &&
                  row[columnIndex] !== null &&
                  row[columnIndex] !== undefined &&
                  row[columnIndex] !== "NA"
                ) {
                  const fieldName = field.displayName;
                  const fieldValue = row[columnIndex].toString();
                  tooltipParts.push(
                    `<div class="tooltip-row"><span class="field-name">${fieldName}</span><span class="field-value">${fieldValue}</span></div>`
                  );
                }
              }

              if (tooltipParts.length > 0) {
                tooltipContent = tooltipParts.join("");
              } else {
                // If no valid tooltip fields, show basic location info
                const lat =
                  row[0] !== null && row[0] !== undefined
                    ? row[0].toString()
                    : "N/A";
                const lng =
                  row[1] !== null && row[1] !== undefined
                    ? row[1].toString()
                    : "N/A";
                tooltipContent = `<div class="tooltip-row"><span class="field-name">Latitude</span><span class="field-value">${lat}</span></div><div class="tooltip-row"><span class="field-name">Longitude</span><span class="field-value">${lng}</span></div>`;
              }
            } else {
              // Fallback: show basic location info
              const lat =
                row[0] !== null && row[0] !== undefined
                  ? row[0].toString()
                  : "N/A";
              const lng =
                row[1] !== null && row[1] !== undefined
                  ? row[1].toString()
                  : "N/A";
              tooltipContent = `<div class="tooltip-row"><span class="field-name">Latitude</span><span class="field-value">${lat}</span></div><div class="tooltip-row"><span class="field-name">Longitude</span><span class="field-value">${lng}</span></div>`;
            }

            const marker = L.marker([lat, lng], {
              icon: customMarkerIcon,
              adminCode:
                row[2] !== null && row[2] !== undefined && row[2] !== "NA"
                  ? parseFloat(row[2].toString())
                  : null,
            }).addTo(this.map);

            (marker as any).options.selectionId = this.selectionIds[i];
            this.markers.push(marker);

            marker.on("click", (event) => {
              console.log(
                `Marker clicked: index ${i}, selectionId:`,
                this.selectionIds[i]
              );

              // Show tooltip on click
              this.showTooltip(tooltipContent, event.latlng);

              // Get current data context to understand what's filtered
              const currentDataContext = this.getCurrentDataContext();

              this.selectionManager
                .select(this.selectionIds[i])
                .then((ids: ISelectionId[]) => {
                  console.log("Selection result:", ids);
                  console.log("Current data context:", currentDataContext);
                  console.log("Previous selection:", this.currentSelection);

                  // Check if this is a deselection (clicking the same marker again)
                  const wasPreviouslySelected = this.persistentSelection.some(
                    (selectedId) =>
                      this.compareSelectionIds(this.selectionIds[i], selectedId)
                  );
                  const isCurrentlySelected = ids.some((selectedId) =>
                    this.compareSelectionIds(this.selectionIds[i], selectedId)
                  );

                  // Update both current and persistent selection state
                  this.currentSelection = ids;
                  this.persistentSelection = [...ids]; // Create a copy to persist

                  // Handle the selection/deselection logic
                  if (ids.length === 0) {
                    // No selection returned - this could be a deselection or error
                    if (wasPreviouslySelected) {
                      // This is a deselection - show all current context markers
                      console.log(
                        "Marker deselected - showing all current markers"
                      );
                      this.handleMarkerDeselection(i);
                    } else {
                      // This might be an error - show all markers from original data
                      console.log(
                        "No selection returned - showing all markers"
                      );
                      this.updateMarkersVisibility(this.selectionIds);
                    }
                  } else if (!isCurrentlySelected) {
                    // Selection returned but clicked marker is not in it
                    // This is likely a deselection
                    console.log(
                      "Marker not in selection - showing all current markers"
                    );
                    this.handleMarkerDeselection(i);
                  } else {
                    // Show the selected markers
                    console.log("Showing selected markers");
                    this.updateMarkersVisibility(ids);
                  }
                })
                .catch((error) => {
                  console.error("Error in marker selection:", error);
                  // Fallback: show all markers from original data
                  this.updateMarkersVisibility(this.selectionIds);
                });

              // To prevent the default behavior of propagating the event to the map.
              L.DomEvent.stopPropagation(event);
            });
          }
        }
      } catch (error) {
        console.error("Error in marker creation loop:", error);
      }

      // Log summary of marker creation
      console.log(
        `Marker creation completed: ${this.markers.length} valid markers created`
      );

      // Use comprehensive empty state check with proper timing
      this.performEmptyStateCheck();

      // Restore previous selection state if needed
      this.restoreSelectionState();

      // Additional empty state check with longer delay for packaged version
      this.performDelayedEmptyStateCheck();
    } catch (error) {
      console.error("Error in visual update:", error);
      // Fallback: show empty state if there's an error
      this.showEmptyState();
    }
  }

  private updateMarkersVisibility(selectedIds: ISelectionId[]) {
    let visibleMarkers = 0;
    let hiddenMarkers = 0;

    console.log("Updating markers visibility:", {
      totalMarkers: this.markers.length,
      selectedIdsCount: selectedIds.length,
      selectedIds: selectedIds,
    });

    this.markers.forEach((marker, index) => {
      const markerSelectionId = (marker as any).options.selectionId;

      // More robust selection comparison
      const isSelected = selectedIds.some((id) => {
        // Try different comparison methods
        if (id.getKey && markerSelectionId.getKey) {
          return id.getKey() === markerSelectionId.getKey();
        }
        if (id.toString && markerSelectionId.toString) {
          return id.toString() === markerSelectionId.toString();
        }
        return id === markerSelectionId;
      });

      if (selectedIds.length > 0 && !isSelected) {
        // Hide marker if it's not in the selected list
        if (this.map.hasLayer(marker)) {
          this.map.removeLayer(marker);
          hiddenMarkers++;
          console.log(`Hidden marker ${index}`);
        }
      } else {
        // Show marker if it's selected or if no selection (show all current markers)
        if (!this.map.hasLayer(marker)) {
          marker.addTo(this.map);
          visibleMarkers++;
          console.log(`Shown marker ${index}`);
        } else {
          visibleMarkers++;
        }
      }
    });

    console.log("Markers visibility update complete:", {
      visibleMarkers,
      hiddenMarkers,
    });

    // Use comprehensive empty state check for consistency
    this.performEmptyStateCheck();
  }

  private processGeoJsonData(geoJsonData: any) {
    // Process the GeoJSON data to add choropleth values based on your data structure
    if (geoJsonData.features) {
      geoJsonData.features.forEach((feature: any) => {
        // Add choropleth_value based on your data properties
        // You can customize this based on your specific needs
        if (feature.properties) {
          // Example: use gaul_code as a basis for choropleth value
          if (feature.properties.gaul_code) {
            feature.properties.choropleth_value =
              (feature.properties.gaul_code % 100) / 100;
          } else {
            feature.properties.choropleth_value = Math.random(); // Fallback random value
          }

          // Ensure we have a name for popups
          if (!feature.properties.name) {
            feature.properties.name =
              feature.properties.gaul0_name ||
              feature.properties.disp_en ||
              "Unknown Region";
          }
        }
      });
    }
  }

  private addDefaultChoroplethLayer(geoJsonData: any) {
    // Clear existing choropleth layer
    if (this.choroplethLayer) {
      this.map.removeLayer(this.choroplethLayer);
    }

    // Create a default choropleth layer with the loaded GeoJSON
    this.choroplethLayer = L.geoJSON(geoJsonData, {
      style: (feature) => this.getDefaultChoroplethStyle(feature),
      onEachFeature: (feature, layer) =>
        this.onEachChoroplethFeature(feature, layer),
    }).addTo(this.map);

    // Fit map to show all features
    if (this.choroplethLayer.getBounds) {
      const bounds = this.choroplethLayer.getBounds();

      // this.map.fitBounds(bounds); // Commented out to preserve custom zoom level
    }
  }

  private getDefaultChoroplethStyle(feature: any) {
    // Enhanced styling for the loaded GeoJSON based on Leaflet GeoJSON examples
    const featureGaulCode = feature.properties?.gaul_code;
    const shouldApplyChoropleth =
      this.currentAdminCodes.length > 0 &&
      (this.currentAdminCodes.includes(featureGaulCode) ||
        this.currentAdminCodes.includes(featureGaulCode?.toString()) ||
        this.currentAdminCodes.includes(parseFloat(featureGaulCode)));

    // Debug logging for first few features
    if (feature.properties?.gaul0_name && this.currentAdminCodes.length > 0) {
      console.log(
        `Feature: ${feature.properties.gaul0_name}, gaul_code: ${featureGaulCode}, shouldApply: ${shouldApplyChoropleth}`
      );
    }

    // Check if this country has NA admin code in the data
    const hasNAAdminCode = this.hasNAAdminCodeForCountry(featureGaulCode);

    if (hasNAAdminCode) {
      return {
        fillColor: "#F2F2F2",
        weight: 1,
        opacity: 1,
        color: "#ccc",
        fillOpacity: 0.7,
      };
    } else if (shouldApplyChoropleth) {
      return {
        fillColor: "#455E6F",
        weight: 1,
        opacity: 1,
        color: "#666",
        fillOpacity: 0.7,
      };
    } else {
      return {
        fillColor: "transparent",
        weight: 1,
        opacity: 1,
        color: "#ccc",
        fillOpacity: 0,
      };
    }
  }

  // Method to find country by coordinates
  private findCountryByCoordinates(lat: number, lng: number): number | null {
    // Use the embedded countries data to find which country contains this point
    const countries = this.getEmbeddedCountries();

    for (const feature of countries) {
      if (feature.geometry && feature.geometry.coordinates) {
        // Simple point-in-polygon check
        if (this.isPointInPolygon(lat, lng, feature.geometry)) {
          return feature.properties?.gaul_code || null;
        }
      }
    }

    return null;
  }

  // Simple point-in-polygon check
  private isPointInPolygon(lat: number, lng: number, geometry: any): boolean {
    // This is a simplified implementation
    // For production, you'd want to use a proper library like turf.js

    if (geometry.type === "Polygon") {
      return this.isPointInPolygonCoords(lat, lng, geometry.coordinates[0]);
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        if (this.isPointInPolygonCoords(lat, lng, polygon[0])) {
          return true;
        }
      }
    }

    return false;
  }

  private isPointInPolygonCoords(
    lat: number,
    lng: number,
    coords: number[][]
  ): boolean {
    // Ray casting algorithm
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][0],
        yi = coords[i][1];
      const xj = coords[j][0],
        yj = coords[j][1];

      if (
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Method to check if a country has NA admin code in the data
  private hasNAAdminCodeForCountry(gaulCode: number): boolean {
    return (
      this.naAdminCodes.includes(gaulCode) ||
      this.naAdminCodes.includes(gaulCode.toString())
    );
  }

  // Method to show custom tooltip
  private showTooltip(content: string, latlng: L.LatLng) {
    if (this.tooltipDiv) {
      // Add close button to the tooltip content
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

      // Position the tooltip in the top-left corner
      this.tooltipDiv.style.left = "10px";
      this.tooltipDiv.style.top = "10px";
    }
  }

  // Method to hide custom tooltip
  private hideTooltip() {
    if (this.tooltipDiv) {
      this.tooltipDiv.style.opacity = "0";
    }
  }

  // Method to update tooltip interactions for a choropleth feature
  private updateChoroplethTooltipInteraction(feature: any, layer: L.Layer) {
    const featureGaulCode = feature.properties?.gaul_code;

    // Check if this feature should have choropleth styling (active region)
    const shouldApplyChoropleth =
      this.currentAdminCodes.length > 0 &&
      (this.currentAdminCodes.includes(featureGaulCode) ||
        this.currentAdminCodes.includes(featureGaulCode?.toString()) ||
        this.currentAdminCodes.includes(parseFloat(featureGaulCode)));

    // Check if this feature has tooltip data
    const hasTooltipData =
      featureGaulCode && this.choroplethTooltipData.has(featureGaulCode);

    // Remove existing tooltip events for all features
    layer.off("mouseover");
    layer.off("mouseout");

    // Only add tooltip interactions for active choropleth regions that have tooltip data
    if (shouldApplyChoropleth && hasTooltipData) {
      // Build custom tooltip content for choropleth
      const tooltipContent = this.buildChoroplethTooltipContent(feature);

      // Add new tooltip events
      layer.on({
        click: (e) => {
          const layer = e.target;
          layer.setStyle({
            weight: 3,
            color: "#666",
            fillOpacity: 0.9,
          });
          layer.bringToFront();

          // Show custom tooltip on click
          this.showTooltip(tooltipContent, e.latlng);

          // Reset style after 2 seconds (keep highlighting shorter)
          setTimeout(() => {
            this.choroplethLayer.resetStyle(e.target);
          }, 2000);
        },
      });
    }
  }

  // Method to process choropleth tooltip data from Power BI
  private processChoroplethTooltipData(dataView: DataView) {
    this.choroplethTooltipData.clear();

    if (!dataView.table || !dataView.table.columns || !dataView.table.rows) {
      console.log("No data available for choropleth tooltips");
      return;
    }

    // Find all choropleth tooltip columns
    const choroplethTooltipColumns = dataView.table.columns.filter(
      (col) => col.roles && col.roles.choroplethTooltip
    );

    if (choroplethTooltipColumns.length === 0) {
      console.log("No choropleth tooltip columns found");
      return;
    }

    const tooltipColumnIndices = choroplethTooltipColumns.map((col) =>
      dataView.table.columns.indexOf(col)
    );
    const values = dataView.table.rows;

    // Group tooltip data by admin code (only one entry per admin code)
    const processedAdminCodes = new Set<number>();

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const adminCode = row[2]; // Admin code is in the 3rd column (index 2)

      if (adminCode !== null && adminCode !== undefined && adminCode !== "NA") {
        const adminCodeNum = parseFloat(adminCode.toString());
        if (!isNaN(adminCodeNum) && !processedAdminCodes.has(adminCodeNum)) {
          processedAdminCodes.add(adminCodeNum);

          // Initialize array if it doesn't exist
          if (!this.choroplethTooltipData.has(adminCodeNum)) {
            this.choroplethTooltipData.set(adminCodeNum, []);
          }

          // Process all tooltip columns for this admin code
          for (let j = 0; j < choroplethTooltipColumns.length; j++) {
            const tooltipColumn = choroplethTooltipColumns[j];
            const tooltipColumnIndex = tooltipColumnIndices[j];
            const tooltipValue = row[tooltipColumnIndex];

            // Only add if the tooltip value is meaningful
            if (
              tooltipValue !== null &&
              tooltipValue !== undefined &&
              tooltipValue !== "NA"
            ) {
              // Add to the array (don't overwrite)
              this.choroplethTooltipData.get(adminCodeNum)!.push({
                fieldName: tooltipColumn.displayName,
                value: tooltipValue,
              });
            }
          }
        }
      }
    }
  }

  // Method to build tooltip content for choropleth features
  private buildChoroplethTooltipContent(feature: any): string {
    const tooltipParts = [];

    // Check if we have custom choropleth tooltip data for this feature
    const featureGaulCode = feature.properties?.gaul_code;
    const hasCustomTooltipData =
      featureGaulCode && this.choroplethTooltipData.has(featureGaulCode);

    if (hasCustomTooltipData) {
      // Only show custom tooltip data from Power BI
      const tooltipData = this.choroplethTooltipData.get(featureGaulCode)!;
      for (const data of tooltipData) {
        if (
          data.value !== null &&
          data.value !== undefined &&
          data.value !== "NA"
        ) {
          const fieldValue = data.value.toString();
          tooltipParts.push(
            `<div class="tooltip-row"><span class="field-name">${data.fieldName}</span><span class="field-value">${fieldValue}</span></div>`
          );
        }
      }
    } else {
      // Fallback: show basic country info if no custom tooltip data
      const name =
        feature.properties?.name ||
        feature.properties?.gaul0_name ||
        feature.properties?.disp_en ||
        "Unknown Region";
      tooltipParts.push(
        `<div class="tooltip-row"><span class="field-name">Country</span><span class="field-value">${name}</span></div>`
      );
    }

    return tooltipParts.join("");
  }

  // Method to show empty state message
  private showEmptyState() {
    if (this.emptyStateDiv) {
      // Ensure the div is properly positioned and visible
      this.ensureEmptyStateDivPosition();

      this.emptyStateDiv.style.opacity = "1";
      this.emptyStateDiv.style.pointerEvents = "auto";
      this.emptyStateDiv.style.display = "block";

      console.log("Empty state shown - no distribution data available");
    } else {
      console.error("Empty state div not found - cannot show empty state");
    }
  }

  // Method to check if there are any active choropleth regions
  private hasActiveChoroplethData(): boolean {
    try {
      // Get all available choropleth admin codes from the map
      const availableChoroplethCodes = new Set<number | string>();

      if (this.choroplethLayer && this.choroplethLayer.getLayers) {
        this.choroplethLayer.eachLayer((layer: any) => {
          if (layer.feature && layer.feature.properties?.gaul_code) {
            availableChoroplethCodes.add(layer.feature.properties.gaul_code);
          }
        });
      }

      // Check if any of our data admin codes match available choropleth codes
      const matchingAdminCodes = this.currentAdminCodes.filter(
        (code) =>
          availableChoroplethCodes.has(code) ||
          availableChoroplethCodes.has(
            typeof code === "number" ? code.toString() : parseFloat(code)
          )
      );

      // Check if any of our NA admin codes match available choropleth codes
      const matchingNAAdminCodes = this.naAdminCodes.filter(
        (code) =>
          availableChoroplethCodes.has(code) ||
          availableChoroplethCodes.has(
            typeof code === "number" ? code.toString() : parseFloat(code)
          )
      );

      // Check if there's any tooltip data for matching countries
      const matchingTooltipCodes = Array.from(
        this.choroplethTooltipData.entries()
      ).filter(([adminCode, data]) => {
        return data.length > 0 && availableChoroplethCodes.has(adminCode);
      });

      // A choropleth region is considered active if:
      // 1. We have admin codes that match the choropleth map, OR
      // 2. We have NA admin codes that match the choropleth map, OR
      // 3. We have tooltip data for countries that match the choropleth map
      const hasMatchingAdminCodes = matchingAdminCodes.length > 0;
      const hasMatchingNAAdminCodes = matchingNAAdminCodes.length > 0;
      const hasTooltipData = matchingTooltipCodes.length > 0;

      const finalResult =
        hasMatchingAdminCodes || hasMatchingNAAdminCodes || hasTooltipData;

      console.log("Choropleth data check:", {
        availableCodes: availableChoroplethCodes.size,
        matchingAdminCodes: matchingAdminCodes.length,
        matchingNAAdminCodes: matchingNAAdminCodes.length,
        matchingTooltipCodes: matchingTooltipCodes.length,
        hasActiveData: finalResult,
      });

      return finalResult;
    } catch (error) {
      console.error("Error in hasActiveChoroplethData:", error);
      return false; // Return false to show empty state if there's an error
    }
  }

  // Method to check if there's any distribution data (markers or choropleth)
  private hasAnyDistributionData(): boolean {
    try {
      // Check if there are any markers created (regardless of visibility)
      const totalMarkers = this.markers.length;

      // Check if there are actually visible markers on the map
      const visibleMarkers = this.markers.filter((marker) =>
        this.map.hasLayer(marker)
      ).length;

      // Check if we have any data in the original dataset
      const hasOriginalData = this.selectionIds.length > 0;

      const hasMarkers = totalMarkers > 0 || visibleMarkers > 0;
      const hasChoropleth = this.hasActiveChoroplethData();

      // We have data if:
      // 1. We have markers (total or visible), OR
      // 2. We have choropleth data, OR
      // 3. We have original data in selectionIds
      const result = hasMarkers || hasChoropleth || hasOriginalData;

      console.log("Distribution data check:", {
        totalMarkers,
        visibleMarkers,
        hasOriginalData,
        hasMarkers,
        hasChoropleth,
        hasAnyData: result,
      });

      return result;
    } catch (error) {
      console.error("Error in hasAnyDistributionData:", error);
      return false; // Return false to show empty state if there's an error
    }
  }

  // Method to hide empty state message
  private hideEmptyState() {
    if (this.emptyStateDiv) {
      this.emptyStateDiv.style.opacity = "0";
      this.emptyStateDiv.style.pointerEvents = "none";
      console.log("Empty state hidden - distribution data available");
    } else {
      console.error("Empty state div not found - cannot hide empty state");
    }
  }

  // New method to perform a comprehensive empty state check with proper timing
  private performEmptyStateCheck(): void {
    // Use setTimeout to ensure all async operations are complete
    setTimeout(() => {
      try {
        // Ensure empty state div is properly positioned
        this.ensureEmptyStateDivPosition();

        const hasAnyData = this.hasAnyDistributionData();

        console.log("Comprehensive empty state check:", {
          hasAnyData,
          markersCount: this.markers.length,
          currentAdminCodesCount: this.currentAdminCodes.length,
          naAdminCodesCount: this.naAdminCodes.length,
          choroplethTooltipDataCount: this.choroplethTooltipData.size,
          defaultGeoJsonLoaded: this.defaultGeoJsonLoaded,
        });

        if (hasAnyData) {
          this.hideEmptyState();
        } else {
          this.showEmptyState();
        }
      } catch (error) {
        console.error("Error in comprehensive empty state check:", error);
        // Fallback: show empty state if there's an error
        this.showEmptyState();
      }
    }, 100); // Small delay to ensure all operations are complete
  }

  // Method to ensure empty state div is properly positioned and visible
  private ensureEmptyStateDivPosition(): void {
    if (this.emptyStateDiv && this.target) {
      // Ensure the empty state div is a child of the target element
      if (this.emptyStateDiv.parentElement !== this.target) {
        this.target.appendChild(this.emptyStateDiv);
      }

      // Ensure it has the correct z-index to be visible above the map
      this.emptyStateDiv.style.zIndex = "9999";

      // Ensure it's positioned correctly
      this.emptyStateDiv.style.position = "absolute";
      this.emptyStateDiv.style.top = "50%";
      this.emptyStateDiv.style.left = "50%";
      this.emptyStateDiv.style.transform = "translate(-50%, -50%)";
    }
  }

  // Method to update admin codes and refresh choropleth
  public updateAdminCodes(adminCodes: (number | string)[]) {
    this.currentAdminCodes = adminCodes;

    // Refresh the choropleth layer if it exists
    if (this.choroplethLayer) {
      this.choroplethLayer.setStyle((feature) =>
        this.getDefaultChoroplethStyle(feature)
      );
    }
  }

  // Method to handle visual destruction (called by PowerBI when visual is removed)
  public destroy(): void {
    try {
      // Clean up map
      if (this.map) {
        this.map.remove();
      }

      // Clear markers
      this.markers = [];

      // Clear selection IDs
      this.selectionIds = [];

      // Clear tooltip data
      this.choroplethTooltipData.clear();

      // Reset state
      this.currentAdminCodes = [];
      this.naAdminCodes = [];
      this.defaultGeoJsonLoaded = false;
      this.currentSelection = [];
      this.persistentSelection = [];

      console.log("Visual destroyed and cleaned up");
    } catch (error) {
      console.error("Error during visual destruction:", error);
    }
  }

  // Method to handle visual resize (called by PowerBI when visual is resized)
  public onResize(): void {
    try {
      // Ensure map is properly sized
      if (this.map) {
        this.map.invalidateSize();
      }

      // Ensure empty state div is properly positioned after resize
      this.ensureEmptyStateDivPosition();

      // Re-check empty state after resize
      this.performEmptyStateCheck();

      console.log("Visual resized and updated");
    } catch (error) {
      console.error("Error during visual resize:", error);
    }
  }

  // Method to clear all selections and show all markers
  public clearSelection(): void {
    try {
      console.log("Clearing all selections");
      this.selectionManager
        .clear()
        .then(() => {
          // Reset both current and persistent selection state
          this.currentSelection = [];
          this.persistentSelection = [];
          // Show only markers in current filtered context when selection is cleared
          this.showOnlyCurrentContextMarkers();
        })
        .catch((error) => {
          console.error("Error clearing selection:", error);
          // Reset both current and persistent selection state
          this.currentSelection = [];
          this.persistentSelection = [];
          // Fallback: show only current context markers
          this.showOnlyCurrentContextMarkers();
        });
    } catch (error) {
      console.error("Error in clearSelection:", error);
    }
  }

  // Method to get current data context (filtered data)
  private getCurrentDataContext(): ISelectionId[] {
    try {
      // Return the current selection IDs that correspond to the filtered data
      // This represents what's currently visible in the visual
      return this.selectionIds.filter((id, index) => {
        // Check if this marker is currently visible on the map
        return this.markers[index] && this.map.hasLayer(this.markers[index]);
      });
    } catch (error) {
      console.error("Error getting current data context:", error);
      return [];
    }
  }

  // Method to compare selection IDs robustly
  private compareSelectionIds(id1: ISelectionId, id2: ISelectionId): boolean {
    try {
      // Try different comparison methods
      if (id1.getKey && id2.getKey) {
        return id1.getKey() === id2.getKey();
      }
      if (id1.toString && id2.toString) {
        return id1.toString() === id2.toString();
      }
      return id1 === id2;
    } catch (error) {
      console.error("Error comparing selection IDs:", error);
      return false;
    }
  }

  // Method to show only markers that are in the current filtered context
  private showOnlyCurrentContextMarkers(): void {
    try {
      console.log("Showing only markers in current filtered context");
      // Show all markers from the original data when no specific selection is active
      this.updateMarkersVisibility(this.selectionIds);
    } catch (error) {
      console.error("Error showing current context markers:", error);
    }
  }

  // Method to handle marker deselection (second click)
  private handleMarkerDeselection(clickedMarkerIndex: number): void {
    try {
      console.log(`Handling deselection for marker ${clickedMarkerIndex}`);

      // When deselecting, show ALL markers from the original data
      // This ensures all markers become visible again
      this.updateMarkersVisibility(this.selectionIds);
    } catch (error) {
      console.error("Error handling marker deselection:", error);
    }
  }

  // Method to restore selection state after visual recreation
  private restoreSelectionState(): void {
    try {
      if (this.persistentSelection.length > 0) {
        console.log(
          "Restoring persistent selection state:",
          this.persistentSelection
        );
        this.currentSelection = [...this.persistentSelection]; // Restore current selection
        this.updateMarkersVisibility(this.persistentSelection);
      }
    } catch (error) {
      console.error("Error restoring selection state:", error);
    }
  }

  // Method to perform a delayed empty state check for packaged version
  private performDelayedEmptyStateCheck(): void {
    // Use a longer delay for packaged version to ensure all operations are complete
    setTimeout(() => {
      try {
        // Ensure empty state div is properly positioned
        this.ensureEmptyStateDivPosition();

        const hasAnyData = this.hasAnyDistributionData();

        console.log("Delayed empty state check (packaged version):", {
          hasAnyData,
          markersCount: this.markers.length,
          selectionIdsCount: this.selectionIds.length,
          currentAdminCodesCount: this.currentAdminCodes.length,
          naAdminCodesCount: this.naAdminCodes.length,
          choroplethTooltipDataCount: this.choroplethTooltipData.size,
          defaultGeoJsonLoaded: this.defaultGeoJsonLoaded,
        });

        if (hasAnyData) {
          this.hideEmptyState();
        } else {
          this.showEmptyState();
        }
      } catch (error) {
        console.error("Error in delayed empty state check:", error);
        // Fallback: show empty state if there's an error
        this.showEmptyState();
      }
    }, 500); // Longer delay for packaged version
  }
}
