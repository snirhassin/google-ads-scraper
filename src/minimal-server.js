const express = require('express');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

console.log('🚀 Starting minimal test server...');
console.log('📦 Node version:', process.version);
console.log('📦 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port (raw):', process.env.PORT);
console.log('🔌 Port (parsed):', PORT);
console.log('🔌 Railway Domain:', process.env.RAILWAY_PUBLIC_DOMAIN);
console.log('🔑 Firecrawl API Key:', process.env.FIRECRAWL_API_KEY ? 'Set ✅' : 'Missing ❌');

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
  console.log(`🌐 Should be accessible at: https://${process.env.RAILWAY_PUBLIC_DOMAIN}/`);
  
  // Signal that we're ready
  if (process.send) {
    process.send('ready');
  }
  
  // Keep the process alive with immediate first heartbeat
  console.log(`💓 Server heartbeat - ${new Date().toISOString()}`);
  setInterval(() => {
    console.log(`💓 Server heartbeat - ${new Date().toISOString()}`);
  }, 15000);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.log(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

// Handle graceful shutdown - but delay to see if Railway retries
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received - Railway is trying to stop the container');
  console.log('⏳ Waiting 5 seconds to see if this is a health check issue...');
  
  setTimeout(() => {
    console.log('📴 Proceeding with graceful shutdown...');
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  }, 5000);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});