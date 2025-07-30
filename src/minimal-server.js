const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting minimal test server...');
console.log('📦 Node version:', process.version);
console.log('📦 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', PORT);

// Basic health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'Google Ads Scraper - Server is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    node: process.version
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.get('/test', (req, res) => {
  res.send('<h1>Test Page</h1><p>If you see this, the server is working correctly!</p>');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Minimal server listening on 0.0.0.0:${PORT}`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});