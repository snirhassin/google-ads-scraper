const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

// Import with error handling - SerpAPI scraper (replaces Firecrawl)
let AdsScraper;
try {
  AdsScraper = require('./serpapi-scraper');
  console.log('✅ SerpAPI scraper loaded successfully');
} catch (error) {
  console.error('❌ Failed to load SerpAPI scraper:', error.message);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const scraperInstances = new Map();

app.get('/', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } catch (error) {
    console.error('Error serving index.html:', error);
    res.status(500).send('Server Error');
  }
});

app.get('/export-excel', async (req, res) => {
  try {
    const { socketId } = req.query;
    const scraper = scraperInstances.get(socketId);
    
    if (!scraper || scraper.scrapedAds.length === 0) {
      return res.status(400).json({ error: 'No data available for export' });
    }

    const excelBuffer = scraper.exportToExcel();
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="google-ads-scraper-${Date.now()}.xlsx"`);
    res.send(excelBuffer);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('start-scraping', async (data) => {
    const { url } = data;
    
    try {
      const scraper = new AdsScraper(socket);
      scraperInstances.set(socket.id, scraper);
      
      await scraper.scrapeTransparencyPage(url);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('stop-scraping', () => {
    const scraper = scraperInstances.get(socket.id);
    if (scraper) {
      scraper.stop();
    }
  });

  socket.on('resume-scraping', () => {
    const scraper = scraperInstances.get(socket.id);
    if (scraper) {
      scraper.resume();
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const scraper = scraperInstances.get(socket.id);
    if (scraper) {
      scraper.stop();
      scraperInstances.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

console.log('🚀 Starting Google Ads Scraper server...');
console.log('📦 Environment:', process.env.NODE_ENV || 'development');
console.log('🔑 SerpAPI Key:', process.env.SERPAPI_API_KEY ? 'Set ✅' : 'Missing ❌');

server.listen(PORT, HOST, () => {
  console.log(`✅ Server running on http://${HOST}:${PORT}`);
  console.log('🎯 Health check available at /health');
  console.log('🌐 Ready to accept connections');
});

// Add health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});