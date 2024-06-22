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
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import pinNegative from '../assets/markers/negative.png'
import pinNot from '../assets/markers/notavailable.png'
import pinPositive from '../assets/markers/possitive.png'

export class Visual implements IVisual {
    private target: HTMLElement;
    private map: L.Map;
    private drawControl: L.Control.Draw;
    private selectionManager: ISelectionManager;
    private host: powerbiVisualsApi.extensibility.visual.IVisualHost;
    private markers: L.Marker[] = [];
    private selectionIds: ISelectionId[] = [];
    private drawnItems: L.FeatureGroup;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();

        const mapElement = document.createElement('div');
        mapElement.id = "map";
        mapElement.style.height = "100%";
        this.target.appendChild(mapElement);

        this.map = L.map(mapElement).setView([51.505, -0.09], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);

        

        this.drawnItems = new L.FeatureGroup();
        this.map.addLayer(this.drawnItems);

        this.drawControl = new L.Control.Draw({
            draw: {
                rectangle: false,
                polygon: true,
                polyline: false,
                circle: false,
                marker: false,
                circlemarker:false
            },
            edit: {
               featureGroup: this.drawnItems,
                remove: true,
                edit:false
            }
        });

        this.map.addControl(this.drawControl);

        this.map.on(L.Draw.Event.CREATED, (event: any) => {
            const layer = event.layer;
            this.drawnItems.addLayer(layer);

            // Handle area selection
            const bounds = layer.getBounds();
            const selectedMarkers = this.markers.filter(marker => bounds.contains(marker.getLatLng()));
            const selectedIds = selectedMarkers.map(marker => marker.options.selectionId);

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
    }

    

    public update(options: VisualUpdateOptions) {
        const dataView: DataView = options.dataViews[0];
        if (!dataView || !dataView.table || !dataView.table.columns || !dataView.table.rows) {
            return;
        }
    
        const values = dataView.table.rows;
        this.selectionIds = values.map((row, index) => {
            return this.host.createSelectionIdBuilder()
                .withTable(dataView.table, index)
                .createSelectionId();
        });
    
        // Clear existing markers
        this.markers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.markers = [];
    
        for (let i = 0; i < values.length; i++) {
            const latitude = parseFloat(values[i][0].toString());
            const longitude = parseFloat(values[i][1].toString());
            const pest = values[i][3];
    
            let iconUrl;
            if (values[i][2] == null) {
                iconUrl = pinNot;
            } else if (values[i][2] == "Negative") {
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
                shadowSize: [41, 41]
            });
    
            const marker = L.marker([latitude, longitude], { icon: icon }).addTo(this.map)
                .bindPopup(`Pest name: ${pest}`);
    
            marker.on('mouseover', () => {
                marker.openPopup();
            });
    
            marker.on('mouseout', () => {
                marker.closePopup();
            });
    
            (marker as any).options.selectionId = this.selectionIds[i];
            this.markers.push(marker);
    
            marker.on('click', (event) => {
                this.selectionManager.select(this.selectionIds[i]).then((ids: ISelectionId[]) => {
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
    
    private updateMarkersVisibility(selectedIds: ISelectionId[]) {
        this.markers.forEach(marker => {
            if (selectedIds.length > 0 && selectedIds.indexOf(marker.options.selectionId) === -1) {
                this.map.removeLayer(marker);
            } else {
                if (!this.map.hasLayer(marker)) {
                    marker.addTo(this.map);
                }
            }
        });
    }
}
