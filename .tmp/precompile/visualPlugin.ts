import { Visual } from "../../src/visual";
import powerbiVisualsApi from "powerbi-visuals-api";
import IVisualPlugin = powerbiVisualsApi.visuals.plugins.IVisualPlugin;
import VisualConstructorOptions = powerbiVisualsApi.extensibility.visual.VisualConstructorOptions;
import DialogConstructorOptions = powerbiVisualsApi.extensibility.visual.DialogConstructorOptions;
var powerbiKey: any = "powerbi";
var powerbi: any = window[powerbiKey];
var leafletMapVisualD689974AB3D948E7B4B17ECA36CEEE89_DEBUG: IVisualPlugin = {
    name: 'leafletMapVisualD689974AB3D948E7B4B17ECA36CEEE89_DEBUG',
    displayName: 'LeafletMapVisual',
    class: 'Visual',
    apiVersion: '5.3.0',
    create: (options?: VisualConstructorOptions) => {
        if (Visual) {
            return new Visual(options);
        }
        throw 'Visual instance not found';
    },
    createModalDialog: (dialogId: string, options: DialogConstructorOptions, initialState: object) => {
        const dialogRegistry = (<any>globalThis).dialogRegistry;
        if (dialogId in dialogRegistry) {
            new dialogRegistry[dialogId](options, initialState);
        }
    },
    custom: true
};
if (typeof powerbi !== "undefined") {
    powerbi.visuals = powerbi.visuals || {};
    powerbi.visuals.plugins = powerbi.visuals.plugins || {};
    powerbi.visuals.plugins["leafletMapVisualD689974AB3D948E7B4B17ECA36CEEE89_DEBUG"] = leafletMapVisualD689974AB3D948E7B4B17ECA36CEEE89_DEBUG;
}
export default leafletMapVisualD689974AB3D948E7B4B17ECA36CEEE89_DEBUG;