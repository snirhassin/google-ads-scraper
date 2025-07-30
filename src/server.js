const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const AdsScraper = require('./scraper');

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
  res.sendFile(path.join(__dirname, '../public/index.html'));
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
      scraper.cleanup();
      scraperInstances.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});