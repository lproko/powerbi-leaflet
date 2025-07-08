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
import pinNegative from "../assets/markers/negative.png";
import pinNot from "../assets/markers/notavailable.png";
import pinPositive from "../assets/markers/possitive.png";
import { embeddedCountries } from "./embedded-countries";

interface ChoroplethFeature {
  type: string;
  properties: {
    admin_boundary?: string;
    admin_level?: number;
    choropleth_value?: number;
    name?: string;
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
  private drawnItems: L.FeatureGroup;
  private choroplethLayer: L.GeoJSON;
  private colorScale: (value: number) => string;
  private choroplethSettings: {
    showChoropleth: boolean;
    colorScheme: string;
  };
  private defaultGeoJsonLoaded: boolean = false;

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

    this.map = L.map(mapElement).setView([51.505, -0.09], 2);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(this.map);

    this.drawnItems = new L.FeatureGroup();
    this.map.addLayer(this.drawnItems);

    // Initialize choropleth layer
    this.choroplethLayer = L.geoJSON(null, {
      style: (feature) => this.getChoroplethStyle(feature),
      onEachFeature: (feature, layer) =>
        this.onEachChoroplethFeature(feature, layer),
    });

    this.drawControl = new L.Control.Draw({
      draw: {
        rectangle: false,
        polygon: true,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: this.drawnItems,
        remove: true,
        edit: false,
      },
    });

    this.map.addControl(this.drawControl);

    this.map.on(L.Draw.Event.CREATED, (event: any) => {
      const layer = event.layer;
      this.drawnItems.addLayer(layer);

      // Handle area selection
      const bounds = layer.getBounds();
      const selectedMarkers = this.markers.filter((marker) =>
        bounds.contains(marker.getLatLng())
      );
      const selectedIds = selectedMarkers.map(
        (marker) => marker.options.selectionId
      );

      this.selectionManager.select(selectedIds).then((ids: ISelectionId[]) => {
        this.updateMarkersVisibility(ids);
      });

      console.log("Area selected:", layer.getLatLngs());
    });

    this.map.on(L.Draw.Event.DELETED, (event: any) => {
      // Clear the selection when an area is deleted
      this.selectionManager.clear().then(() => {
        this.updateMarkersVisibility(this.selectionIds);
      });
      console.log("Area deleted");
    });

    // Load default GeoJSON file
    this.loadDefaultGeoJson();
  }

  private async loadDefaultGeoJson() {
    try {
      console.log("Loading embedded GeoJSON data...");

      // Use a simpler, more reliable approach for PowerBI Desktop
      const embeddedGeoJson = {
        type: "FeatureCollection",
        name: "GAUL.EFSA",
        features: this.getEmbeddedCountries(),
      };

      console.log("Embedded GeoJSON loaded successfully:", embeddedGeoJson);
      console.log("Number of features:", embeddedGeoJson.features?.length);

      // Process the GeoJSON data to add choropleth values
      this.processGeoJsonData(embeddedGeoJson);

      this.addDefaultChoroplethLayer(embeddedGeoJson);
      this.defaultGeoJsonLoaded = true;
    } catch (error) {
      console.error("Error loading embedded GeoJSON:", error);
      this.defaultGeoJsonLoaded = true;
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
    const value = feature.properties.choropleth_value;
    const color = this.colorScale(value);

    return {
      fillColor: color,
      weight: 2,
      opacity: 1,
      color: "black",
      fillOpacity: 0.7,
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

      // Create detailed popup content
      let popupContent = `<b>${name}</b>`;
      if (countryCode) popupContent += `<br/>Country Code: ${countryCode}`;
      if (continent) popupContent += `<br/>Continent: ${continent}`;
      popupContent += `<br/>Value: ${value}`;

      layer.bindPopup(popupContent);

      // Add hover effects
      layer.on({
        mouseover: (e) => {
          const layer = e.target;
          layer.setStyle({
            weight: 3,
            color: "#666",
            fillOpacity: 0.9,
          });
          layer.bringToFront();
        },
        mouseout: (e) => {
          this.choroplethLayer.resetStyle(e.target);
        },
        click: (e) => {
          // Handle click events if needed
          console.log("Clicked on:", name);
        },
      });
    }
  }

  public update(options: VisualUpdateOptions) {
    const dataView: DataView = options.dataViews[0];
    if (
      !dataView ||
      !dataView.table ||
      !dataView.table.columns ||
      !dataView.table.rows
    ) {
      // If no data, just ensure default GeoJSON is loaded
      if (!this.defaultGeoJsonLoaded) {
        this.loadDefaultGeoJson();
      }
      return;
    }

    // Update choropleth settings if available
    this.choroplethSettings.showChoropleth = true;
    this.choroplethSettings.colorScheme = "Viridis"; // Use Viridis for better visualization
    this.colorScale = this.createColorScale();

    const values = dataView.table.rows;
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
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (
        row[0] !== null &&
        row[0] !== undefined &&
        row[1] !== null &&
        row[1] !== undefined
      ) {
        let iconUrl;
        if (row[2] == null) {
          iconUrl = pinNot;
        } else if (row[2] == "Negative") {
          iconUrl = pinNegative;
        } else {
          iconUrl = pinPositive;
        }

        const icon = L.icon({
          iconUrl: iconUrl,
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          tooltipAnchor: [16, -28],
          shadowSize: [41, 41],
        });

        const marker = L.marker(
          [parseFloat(row[0].toString()), parseFloat(row[1].toString())],
          { icon: icon }
        )
          .addTo(this.map)
          .bindPopup(`Pest name: ${row[3]}`);

        marker.on("mouseover", () => {
          marker.openPopup();
        });

        marker.on("mouseout", () => {
          marker.closePopup();
        });

        (marker as any).options.selectionId = this.selectionIds[i];
        this.markers.push(marker);

        marker.on("click", (event) => {
          this.selectionManager
            .select(this.selectionIds[i])
            .then((ids: ISelectionId[]) => {
              if (ids.length === 0) {
                this.updateMarkersVisibility(this.selectionIds);
              } else {
                this.updateMarkersVisibility(ids);
              }
            });

          // To prevent the default behavior of propagating the event to the map.
          L.DomEvent.stopPropagation(event);
        });
      }
    }
  }

  private updateMarkersVisibility(selectedIds: ISelectionId[]) {
    this.markers.forEach((marker) => {
      if (
        selectedIds.length > 0 &&
        selectedIds.indexOf(marker.options.selectionId) === -1
      ) {
        this.map.removeLayer(marker);
      } else {
        if (!this.map.hasLayer(marker)) {
          marker.addTo(this.map);
        }
      }
    });
  }

  private processGeoJsonData(geoJsonData: any) {
    // Process the GeoJSON data to add choropleth values based on your data structure
    if (geoJsonData.features) {
      geoJsonData.features.forEach((feature: any) => {
        // Add choropleth_value based on your data properties
        // You can customize this based on your specific needs
        if (feature.properties) {
          // Example: use gaul0_code as a basis for choropleth value
          if (feature.properties.gaul0_code) {
            feature.properties.choropleth_value =
              (feature.properties.gaul0_code % 100) / 100;
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
    console.log("Adding default choropleth layer...");

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

    console.log("Choropleth layer added to map");

    // Fit map to show all features
    if (this.choroplethLayer.getBounds) {
      const bounds = this.choroplethLayer.getBounds();
      console.log("Choropleth bounds:", bounds);
      this.map.fitBounds(bounds);
    }
  }

  private getDefaultChoroplethStyle(feature: any) {
    // Enhanced styling for the loaded GeoJSON based on Leaflet GeoJSON examples
    const value = feature.properties?.choropleth_value || 0;
    const color = this.colorScale(value);

    console.log(
      "Styling feature:",
      feature.properties?.gaul0_name || feature.properties?.name || "Unknown",
      "Value:",
      value,
      "Color:",
      color
    );

    return {
      fillColor: color,
      weight: 1,
      opacity: 1,
      color: "#666",
      fillOpacity: 0.7,
    };
  }
}
