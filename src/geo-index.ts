// Auto-generated index file for all continent data
// Generated on: 2025-08-22T13:38:47.446Z

import {
  northAmericaGeoData,
  getNorthAmericaGeoData,
} from "./geo-north-america";
import { asiaGeoData, getAsiaGeoData } from "./geo-asia";
import {
  southAmericaGeoData,
  getSouthAmericaGeoData,
} from "./geo-south-america";
import { africaGeoData, getAfricaGeoData } from "./geo-africa";
import { europeGeoData, getEuropeGeoData } from "./geo-europe";
import { oceaniaGeoData, getOceaniaGeoData } from "./geo-oceania";

// Combined data for the entire world
export const allGeoData = {
  type: "FeatureCollection",
  features: [
    ...northAmericaGeoData.features,
    ...asiaGeoData.features,
    ...southAmericaGeoData.features,
    ...africaGeoData.features,
    ...europeGeoData.features,
    ...oceaniaGeoData.features,
  ],
};

export const getAllGeoData = () => {
  return allGeoData;
};

// Individual continent getters
export { getNorthAmericaGeoData } from "./geo-north-america";
export { getAsiaGeoData } from "./geo-asia";
export { getSouthAmericaGeoData } from "./geo-south-america";
export { getAfricaGeoData } from "./geo-africa";
export { getEuropeGeoData } from "./geo-europe";
export { getOceaniaGeoData } from "./geo-oceania";
