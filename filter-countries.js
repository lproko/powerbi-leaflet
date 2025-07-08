const fs = require('fs');

// Read the GeoJSON file
const geoJsonData = JSON.parse(fs.readFileSync('plh-map.geojson', 'utf8'));

// Define priority countries (major countries, EU, etc.)
const priorityCountries = [
  'United States', 'Canada', 'Mexico', 'Brazil', 'Argentina',
  'United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Poland', 'Sweden', 'Norway', 'Denmark', 'Finland',
  'Russia', 'China', 'Japan', 'India', 'Australia', 'New Zealand',
  'South Africa', 'Nigeria', 'Egypt', 'Morocco', 'Kenya',
  'Saudi Arabia', 'Iran', 'Turkey', 'Israel', 'Pakistan', 'Bangladesh',
  'Thailand', 'Vietnam', 'Malaysia', 'Singapore', 'Indonesia', 'Philippines',
  'South Korea', 'North Korea', 'Mongolia'
];

// Filter countries
const filteredCountries = geoJsonData.features.filter(feature => {
  const countryName = feature.properties.gaul0_name || feature.properties.disp_en || '';
  return priorityCountries.some(priority => 
    countryName.toLowerCase().includes(priority.toLowerCase()) ||
    priority.toLowerCase().includes(countryName.toLowerCase())
  );
});

console.log(`Found ${filteredCountries.length} priority countries out of ${geoJsonData.features.length} total`);

// Generate embedded code for priority countries
const embeddedCountries = filteredCountries.map(feature => {
  const props = feature.properties;
  const geometry = feature.geometry;
  
  let coordinates = geometry.coordinates;
  
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

// Generate the embedded GeoJSON code
const embeddedCode = `const embeddedGeoJson = {
  type: "FeatureCollection",
  name: "GAUL.EFSA",
  features: ${JSON.stringify(embeddedCountries, null, 2)}
};`;

fs.writeFileSync('priority-countries.js', embeddedCode);

console.log('\nPriority countries found:');
embeddedCountries.forEach((country, index) => {
  console.log(`  ${index + 1}. ${country.properties.gaul0_name}`);
});

console.log(`\nGenerated priority-countries.js with ${embeddedCountries.length} countries`);
console.log('This is a good balance between coverage and performance for PowerBI'); 