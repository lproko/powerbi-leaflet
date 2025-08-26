const fs = require('fs');

// Read the GeoJSON file
const geojsonPath = './src/distribution.map.GAUL.simpl005.geojson';
const outputPath = './choropleth-data.json';

try {
  console.log('🔍 Reading GeoJSON file...');
  
  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found:', geojsonPath);
    process.exit(1);
  }
  
  const geojsonContent = fs.readFileSync(geojsonPath, 'utf8');
  const geojson = JSON.parse(geojsonContent);
  
  console.log('📊 GeoJSON loaded successfully:');
  console.log('- Type:', geojson.type);
  console.log('- Features:', geojson.features.length);
  
  // Prepare data for JSON
  const choroplethData = [];
  
  let processedFeatures = 0;
  let skippedFeatures = 0;
  
  geojson.features.forEach((feature, index) => {
    try {
      const properties = feature.properties;
      const geometry = feature.geometry;
      
      if (!geometry || !geometry.coordinates) {
        console.log(`⚠️  Feature ${index} has no geometry, skipping...`);
        skippedFeatures++;
        return;
      }
      
      // Extract properties
      const adminCode = properties.gaul_code || properties.gaul0_code || properties.admin_code || index;
      const countryName = properties.gaul0_name || properties.gaul_name || properties.name || `Country_${index}`;
      const continent = properties.continent || 'Unknown';
      const isoCode = properties.iso3_code || properties.iso_code || '';
      
      // Create the data object - no need to split geometry in JSON!
      const featureData = {
      
        geometry: {
          ...geometry,
          properties: {
            adminCode: adminCode,
            countryName: countryName,
            continent: continent,
            isoCode: isoCode
          }
        }, // Store the full geometry object with embedded properties
        geometryType: geometry.type,
        coordinatesCount: JSON.stringify(geometry.coordinates).length // For debugging
      };
      
      choroplethData.push(featureData);
      processedFeatures++;
      
      // Progress update
      if (index % 50 === 0) {
        console.log(`📈 Processed ${index + 1}/${geojson.features.length} features...`);
      }
      
      // Debug first few features
      if (index < 3) {
        console.log(`\n🔍 Feature ${index} (${countryName}):`);
        console.log(`- Admin Code: ${adminCode}`);
        console.log(`- Country: ${countryName}`);
        console.log(`- Continent: ${continent}`);
        console.log(`- ISO Code: ${isoCode}`);
        console.log(`- Geometry type: ${geometry.type}`);
        console.log(`- Coordinates length: ${featureData.coordinatesCount} characters`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing feature ${index}:`, error.message);
      skippedFeatures++;
    }
  });
  
  // Create the final JSON structure
  const finalData = {
    metadata: {
      source: 'distribution.map.GAUL.simpl005.geojson',
      generatedAt: new Date().toISOString(),
      totalFeatures: processedFeatures,
      skippedFeatures: skippedFeatures,
      description: 'Choropleth data for Power BI visual with complete geometries'
    },
    features: choroplethData
  };
  
  // Write JSON file
  console.log('\n💾 Writing JSON file...');
  fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2), 'utf8');
  
  const fileStats = fs.statSync(outputPath);
  
  console.log('✅ JSON file written successfully:');
  console.log('- Output path:', outputPath);
  console.log('- File size:', (fileStats.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('- Total features:', processedFeatures);
  console.log('- Skipped features:', skippedFeatures);
  console.log('- Success rate:', ((processedFeatures / (processedFeatures + skippedFeatures)) * 100).toFixed(1) + '%');
  
  // Calculate geometry size statistics
  const geometrySizes = choroplethData.map(f => f.coordinatesCount);
  const avgSize = geometrySizes.reduce((a, b) => a + b, 0) / geometrySizes.length;
  const maxSize = Math.max(...geometrySizes);
  const minSize = Math.min(...geometrySizes);
  
  console.log('\n📊 Geometry Statistics:');
  console.log(`- Average geometry size: ${Math.round(avgSize)} characters`);
  console.log(`- Largest geometry: ${maxSize} characters`);
  console.log(`- Smallest geometry: ${minSize} characters`);
  
  // Find the feature with the largest geometry
  const largestFeature = choroplethData.find(f => f.coordinatesCount === maxSize);
  if (largestFeature) {
    console.log(`- Largest geometry belongs to: ${largestFeature.countryName}`);
  }
  
  console.log('\n🎉 JSON file approach complete!');
  console.log('📋 In Power BI, you can import this JSON file directly.');
  console.log('🔧 The visual will read the geometry field directly - no concatenation needed!');
  console.log('\n💡 JSON Benefits:');
  console.log('- ✅ All 445 features included (no character limits)');
  console.log('- ✅ Faster parsing (native JSON)');
  console.log('- ✅ Smaller file size');
  console.log('- ✅ Better data integrity');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}