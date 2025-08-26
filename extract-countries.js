const fs = require('fs');

// Read the GeoJSON file
console.log('Reading plh-map.geojson...');
const geoJsonData = JSON.parse(fs.readFileSync('plh-map.geojson', 'utf8'));

console.log(`Found ${geoJsonData.features.length} countries/regions`);

// Extract and format countries for embedding
const embeddedCountries = geoJsonData.features.map(feature => {
  const props = feature.properties;
  const geometry = feature.geometry;
  
  // Extract coordinates and simplify if needed
  let coordinates = geometry.coordinates;
  
  // For MultiPolygon, take the first polygon
  if (geometry.type === 'MultiPolygon' && coordinates.length > 0) {
    coordinates = coordinates[0];
  }
  
  // For Polygon, ensure it's in the right format
  if (geometry.type === 'Polygon') {
    coordinates = coordinates;
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

// Generate the embedded GeoJSON code
const embeddedCode = `const embeddedGeoJson = {
  type: "FeatureCollection",
  name: "GAUL.EFSA",
  features: ${JSON.stringify(embeddedCountries, null, 2)}
};`;

// Write to a file
fs.writeFileSync('embedded-countries.js', embeddedCode);
console.log('Generated embedded-countries.js with all countries');

// Also create a summary
const countryNames = embeddedCountries.map(c => c.properties.gaul0_name).sort();
console.log('\nCountries found:');
countryNames.forEach((name, index) => {
  if (index < 20) {
    console.log(`  ${index + 1}. ${name}`);
  } else if (index === 20) {
    console.log(`  ... and ${countryNames.length - 20} more countries`);
  }
});

console.log(`\nTotal countries: ${embeddedCountries.length}`);
console.log('You can now copy the content from embedded-countries.js into your visual.ts file'); 