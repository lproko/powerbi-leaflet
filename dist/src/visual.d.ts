import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import powerbiVisualsApi from "powerbi-visuals-api";
import IVisual = powerbiVisualsApi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbiVisualsApi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbiVisualsApi.extensibility.visual.VisualUpdateOptions;
export declare class Visual implements IVisual {
    private target;
    private map;
    private drawControl;
    private selectionManager;
    private host;
    private markers;
    private selectionIds;
    private drawnItems;
    constructor(options: VisualConstructorOptions);
    private updateMarkersVisibility;
    update(options: VisualUpdateOptions): void;
}
