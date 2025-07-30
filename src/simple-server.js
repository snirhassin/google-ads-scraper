const express = require('express');
const app = express();

// Use Railway's PORT or fallback
const PORT = process.env.PORT || 3000;

console.log('🚀 Simple server starting...');
console.log('🔌 PORT:', PORT);

// Simple root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Google Ads Scraper is running!',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Start server with minimal configuration
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});