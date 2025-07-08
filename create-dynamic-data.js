const fs = require('fs');

// Read the original GeoJSON file
console.log('Reading plh-map.geojson for dynamic loading...');
const geoJsonData = JSON.parse(fs.readFileSync('plh-map.geojson', 'utf8'));

console.log(`Processing ${geoJsonData.features.length} countries for dynamic loading...`);

// Process all countries for dynamic loading
const processedCountries = geoJsonData.features.map(feature => {
  const props = feature.properties;
  const geometry = feature.geometry;
  
  // Extract coordinates and simplify if needed
  let coordinates = geometry.coordinates;
  
  // For MultiPolygon, take the first polygon
  if (geometry.type === 'MultiPolygon' && coordinates.length > 0) {
    coordinates = coordinates[0];
  }
  
  return {
    type: "Feature",
    properties: {
      iso3_code: props.iso3_code || '',
      gaul0_name: props.gaul0_name || props.disp_en || 'Unknown',
      continent: props.continent || 'Unknown',
      gaul0_code: props.gaul0_code || Math.floor(Math.random() * 1000),
      disp_en: props.disp_en || props.gaul0_name || 'Unknown'
    },
    geometry: {
      type: "Polygon",
      coordinates: coordinates
    }
  };
});

// Generate the dynamic data file
const dynamicDataCode = `// Dynamic GeoJSON data for PowerBI Leaflet Visual
// This file contains all ${processedCountries.length} countries from plh-map.geojson
// Generated for dynamic loading system

export const dynamicCountryData = {
  type: "FeatureCollection",
  name: "GAUL.EFSA",
  features: ${JSON.stringify(processedCountries, null, 2)}
};

// Zoom-based filtering thresholds
export const zoomThresholds = {
  highDetail: 8,    // Show all countries
  mediumDetail: 6,  // Show major countries (gaul0_code <= 100)
  lowDetail: 4,     // Show very major countries (gaul0_code <= 500)
  minimalDetail: 2  // Show only largest countries (gaul0_code <= 1000)
};

// Country statistics
export const countryStats = {
  totalCountries: ${processedCountries.length},
  continents: [...new Set(${JSON.stringify(processedCountries.map(c => c.properties.continent))})],
  countriesByContinent: ${JSON.stringify(
    processedCountries.reduce((acc, country) => {
      const continent = country.properties.continent;
      acc[continent] = (acc[continent] || 0) + 1;
      return acc;
    }, {})
  )}
};

console.log('Dynamic country data loaded:', countryStats);
`;

// Write the dynamic data file
fs.writeFileSync('src/dynamic-country-data.ts', dynamicDataCode);

// Also create a summary file
const summaryCode = `// Summary of available countries for dynamic loading
export const countrySummary = {
  total: ${processedCountries.length},
  sample: ${processedCountries.slice(0, 20).map(c => c.properties.gaul0_name).join(', ')},
  continents: ${JSON.stringify([...new Set(processedCountries.map(c => c.properties.continent))])}
};
`;

fs.writeFileSync('src/country-summary.ts', summaryCode);

console.log('\n✅ Dynamic loading data generated successfully!');
console.log(`📊 Total countries: ${processedCountries.length}`);
console.log(`🌍 Continents: ${[...new Set(processedCountries.map(c => c.properties.continent))].join(', ')}`);
console.log('\n📁 Files created:');
console.log('  - src/dynamic-country-data.ts (Full country data)');
console.log('  - src/country-summary.ts (Summary statistics)');
console.log('\n🚀 Next steps:');
console.log('  1. Import dynamic-country-data.ts in your visual.ts');
console.log('  2. Replace getSampleCountries() with the full dataset');
console.log('  3. Test the dynamic loading system'); 