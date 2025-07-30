// Handle both CommonJS and ES module imports
let FirecrawlApp;
try {
  // Try ES module style first
  const firecrawlModule = require('@mendable/firecrawl-js');
  FirecrawlApp = firecrawlModule.default || firecrawlModule.FirecrawlApp || firecrawlModule;
  console.log('✅ Firecrawl module loaded successfully');
} catch (error) {
  console.error('❌ Failed to load Firecrawl module:', error.message);
  throw error;
}
const cheerio = require('cheerio');
const XLSX = require('xlsx');

class FirecrawlAdsScraper {
  constructor(socket) {
    this.socket = socket;
    this.firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    this.isRunning = false;
    this.isPaused = false;
    this.scrapedAds = [];
    this.totalPagesScraped = 0;
  }

  async scrapeTransparencyPage(url) {
    if (!url || !url.includes('adstransparency.google.com')) {
      throw new Error('Invalid Google Ads Transparency URL');
    }

    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY environment variable is required');
    }

    this.isRunning = true;
    this.isPaused = false;
    this.scrapedAds = [];
    this.totalPagesScraped = 0;

    try {
      this.socket.emit('status-update', { message: 'Starting Firecrawl scraping...' });
      
      // Use Firecrawl's crawl endpoint to handle pagination automatically
      const crawlResult = await this.firecrawl.crawlUrl(url, {
        crawlerOptions: {
          includes: [url + '*'], // Only crawl pages within the transparency domain
          excludes: [],
          generateImgAltText: false,
          returnOnlyUrls: false,
          maxDepth: 2,
          limit: 50 // Limit to prevent excessive crawling
        },
        pageOptions: {
          onlyMainContent: true,
          includeHtml: true,
          includeRawHtml: false,
          waitFor: 3000, // Wait for JavaScript to load
          screenshot: false
        }
      });

      if (crawlResult.success) {
        await this.processCrawlResults(crawlResult);
      } else {
        // Fallback to single page scrape if crawl fails
        await this.scrapeSinglePage(url);
      }
      
      this.socket.emit('scraping-complete', {
        ads: this.scrapedAds,
        total: this.scrapedAds.length
      });

    } catch (error) {
      console.error('Firecrawl scraping error:', error);
      this.socket.emit('error', { message: `Scraping failed: ${error.message}` });
    }
  }

  async processCrawlResults(crawlResult) {
    this.socket.emit('status-update', { 
      message: `Processing ${crawlResult.data.length} pages...` 
    });

    for (let i = 0; i < crawlResult.data.length && this.isRunning; i++) {
      if (this.isPaused) {
        await this.waitForResume();
      }

      const pageData = crawlResult.data[i];
      this.socket.emit('status-update', { 
        message: `Processing page ${i + 1}/${crawlResult.data.length}...` 
      });

      const adsOnPage = this.extractAdsFromContent(pageData.content, pageData.metadata, pageData.html);
      this.scrapedAds.push(...adsOnPage);
      this.totalPagesScraped++;

      this.socket.emit('progress-update', {
        adsScraped: this.scrapedAds.length,
        currentPage: i + 1,
        totalPages: crawlResult.data.length
      });
    }
  }

  async scrapeSinglePage(url) {
    this.socket.emit('status-update', { message: 'Scraping single page with Firecrawl...' });
    
    const scrapeResult = await this.firecrawl.scrapeUrl(url, {
      pageOptions: {
        onlyMainContent: true,
        includeHtml: true,
        includeRawHtml: false,
        waitFor: 5000,
        screenshot: false
      }
    });

    if (scrapeResult.success) {
      const ads = this.extractAdsFromContent(
        scrapeResult.data.content, 
        scrapeResult.data.metadata, 
        scrapeResult.data.html
      );
      this.scrapedAds.push(...ads);
      this.totalPagesScraped = 1;

      this.socket.emit('progress-update', {
        adsScraped: this.scrapedAds.length,
        currentPage: 1,
        totalPages: 1
      });
    } else {
      throw new Error('Failed to scrape page with Firecrawl');
    }
  }

  extractAdsFromContent(content, metadata, htmlContent) {
    const ads = [];
    
    try {
      // Parse HTML content with Cheerio for more precise extraction
      const $ = cheerio.load(htmlContent || '');
      
      // Look for Google Ads transparency specific selectors
      const adSelectors = [
        '[data-creative-id]',
        '.eLNT1d',
        '.commercial-unit-desktop-rhs',
        '.ads-ad',
        '.mnr-c',
        '.uEierd',
        '.VqFMTc',
        '.cu-container',
        '[role="listitem"]',
        '.g-blk'
      ];

      adSelectors.forEach(selector => {
        $(selector).each((index, element) => {
          const $element = $(element);
          
          // Extract ad data
          const title = $element.find('h3, .BNeawe, .LC20lb, .ads-creative-headline, [role="heading"]').first().text().trim();
          
          const descriptions = [];
          $element.find('.VwiC3b, .BNeawe, .ads-creative-text, .yXK7lf, p').each((i, desc) => {
            const text = $(desc).text().trim();
            if (text && text.length > 10) {
              descriptions.push(text);
            }
          });
          
          const url = $element.find('a[href]').first().attr('href') || '';
          
          const images = [];
          $element.find('img').each((i, img) => {
            const src = $(img).attr('src');
            if (src && !src.includes('data:image') && src.startsWith('http')) {
              images.push(src);
            }
          });

          // Determine ad format
          let adFormat = 'Text';
          if (images.length > 0) adFormat = 'Display';
          if ($element.find('video').length > 0 || $element.text().includes('Video')) {
            adFormat = 'Video';
          }

          // Only add if we have meaningful content
          if (title || descriptions.length > 0) {
            ads.push({
              id: `firecrawl_ad_${Date.now()}_${index}`,
              title: title || 'No title found',
              description: descriptions.join(' | ') || 'No description found',
              url: url || 'No URL found',
              images: images,
              format: adFormat,
              dateRange: this.extractDateRange($element.text()) || 'Unknown',
              source: 'Firecrawl'
            });
          }
        });
      });

      // Fallback: Extract from text content using patterns
      if (ads.length === 0) {
        ads.push(...this.extractAdsFromText(content));
      }

    } catch (error) {
      console.error('Error extracting ads:', error);
      // Fallback to text-based extraction
      ads.push(...this.extractAdsFromText(content));
    }

    return ads.filter(ad => ad && this.isValidAd(ad));
  }

  extractAdsFromText(content) {
    const ads = [];
    
    // Split content into potential ad blocks
    const blocks = content.split(/\n\s*\n/).filter(block => block.trim().length > 20);
    
    blocks.forEach((block, index) => {
      // Look for URL patterns
      const urlMatch = block.match(/https?:\/\/[^\s]+/);
      
      // Look for common ad indicators
      if (urlMatch || block.includes('Ad') || block.includes('Sponsored')) {
        const lines = block.split('\n').map(line => line.trim()).filter(line => line);
        
        if (lines.length >= 2) {
          ads.push({
            id: `text_ad_${Date.now()}_${index}`,
            title: lines[0] || 'Extracted from text',
            description: lines.slice(1).join(' | '),
            url: urlMatch ? urlMatch[0] : 'No URL found',
            images: [],
            format: 'Text',
            dateRange: this.extractDateRange(block) || 'Unknown',
            source: 'Text extraction'
          });
        }
      }
    });

    return ads;
  }

  extractDateRange(text) {
    // Look for date patterns in the text
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
      /(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/,
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/gi
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  isValidAd(ad) {
    return ad && (
      (ad.title && ad.title !== 'No title found') ||
      (ad.description && ad.description !== 'No description found') ||
      (ad.url && ad.url !== 'No URL found')
    );
  }

  async waitForResume() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.isPaused || !this.isRunning) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.socket.emit('status-update', { message: 'Scraping stopped' });
  }

  resume() {
    if (this.isRunning) {
      this.isPaused = false;
      this.socket.emit('status-update', { message: 'Scraping resumed' });
    }
  }

  pause() {
    if (this.isRunning) {
      this.isPaused = true;
      this.socket.emit('status-update', { message: 'Scraping paused' });
    }
  }

  exportToExcel() {
    try {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(this.scrapedAds.map(ad => ({
        'Ad Title': ad.title,
        'Description': ad.description,
        'URL': ad.url,
        'Images': ad.images.join(', '),
        'Format': ad.format,
        'Date Range': ad.dateRange,
        'Source': ad.source,
        'Scraped At': new Date().toISOString()
      })));

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Ads');
      
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      throw new Error(`Failed to create Excel file: ${error.message}`);
    }
  }
}

module.exports = FirecrawlAdsScraper;