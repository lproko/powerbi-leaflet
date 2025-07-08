const fs = require('fs');

// Read the GeoJSON file
console.log('Reading plh-map.geojson...');
const geoJsonData = JSON.parse(fs.readFileSync('plh-map.geojson', 'utf8'));

console.log(`Found ${geoJsonData.features.length} countries/regions`);

// Define priority countries (major countries that we want to include)
const priorityCountries = [
  'France', 'Germany', 'Italy', 'Spain', 'United Kingdom', 'Netherlands', 'Belgium', 'Poland', 'Sweden', 'Norway',
  'United States', 'Canada', 'Brazil', 'Mexico', 'Argentina',
  'China', 'India', 'Japan', 'Russia',
  'South Africa', 'Nigeria', 'Egypt',
  'Australia'
];

// Filter and extract priority countries with their real geometries
const embeddedCountries = geoJsonData.features
  .filter(feature => {
    const countryName = feature.properties.gaul0_name || feature.properties.disp_en || '';
    return priorityCountries.some(priority => 
      countryName.toLowerCase().includes(priority.toLowerCase()) ||
      priority.toLowerCase().includes(countryName.toLowerCase())
    );
  })
  .map(feature => {
    const props = feature.properties;
    const geometry = feature.geometry;
    
    // Keep the original geometry structure
    let processedGeometry = geometry;
    
    // For MultiPolygon, we'll keep the full structure but simplify if needed
    if (geometry.type === 'MultiPolygon') {
      // Keep the first polygon of each MultiPolygon for simplicity
      processedGeometry = {
        type: "Polygon",
        coordinates: geometry.coordinates[0]
      };
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
      geometry: processedGeometry
    };
  });

console.log(`Extracted ${embeddedCountries.length} priority countries with real geometries`);

// Generate the embedded GeoJSON code for the visual
const embeddedCode = `// Real country geometries extracted from plh-map.geojson
// This provides actual country shapes instead of simple rectangles

export const embeddedCountries = ${JSON.stringify(embeddedCountries, null, 2)};

// Country list for reference
export const countryList = ${JSON.stringify(embeddedCountries.map(c => c.properties.gaul0_name), null, 2)};
`;

// Write to a file
fs.writeFileSync('src/embedded-countries.ts', embeddedCode);

// Also create a summary
console.log('\nExtracted countries:');
embeddedCountries.forEach((country, index) => {
  console.log(`  ${index + 1}. ${country.properties.gaul0_name} (${country.properties.iso3_code})`);
});

console.log(`\nGenerated src/embedded-countries.ts with ${embeddedCountries.length} countries`);
console.log('These countries have their real geometries from the original GeoJSON file'); 