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
      this.socket.emit('status-update', { message: 'Starting optimized Firecrawl scraping...' });
      
      // Use single page scraping to avoid rate limits from crawling
      await this.scrapeSinglePage(url);
      
      this.socket.emit('scraping-complete', {
        ads: this.scrapedAds,
        total: this.scrapedAds.length
      });

    } catch (error) {
      console.error('Firecrawl scraping error:', error);
      this.socket.emit('error', { message: `Scraping failed: ${error.message}` });
      throw error; // Re-throw for test script
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
    this.socket.emit('status-update', { message: 'Scraping with pagination support...' });
    
    // First, try to get all ads using crawling with actions
    try {
      const crawlResult = await this.firecrawl.crawlUrl(url, {
        crawlerOptions: {
          includes: [url + '*'],
          excludes: [],
          generateImgAltText: false,
          returnOnlyUrls: false,
          maxDepth: 1,
          limit: 10
        },
        pageOptions: {
          onlyMainContent: false, // Get full page to detect "See all ads"
          includeHtml: true,
          includeRawHtml: false,
          waitFor: 10000, // Wait longer for dynamic content
          screenshot: false,
          actions: [
            {
              type: 'click',
              selector: 'material-button.grid-expansion-button',
              waitTime: 5000 // Wait after clicking "See all ads"
            }
          ]
        }
      });

      if (crawlResult.success && crawlResult.data && crawlResult.data.length > 0) {
        this.socket.emit('status-update', { message: 'Processing crawled pages with expanded content...' });
        
        // Process all pages from crawling
        for (const pageData of crawlResult.data) {
          const ads = this.extractAdsFromContent(
            pageData.content,
            pageData.metadata,
            pageData.html
          );
          this.scrapedAds.push(...ads);
        }
        
        this.totalPagesScraped = crawlResult.data.length;
        
        this.socket.emit('progress-update', {
          adsScraped: this.scrapedAds.length,
          currentPage: crawlResult.data.length,
          totalPages: crawlResult.data.length
        });
        
        // If crawling with actions worked, we're done
        if (this.scrapedAds.length > 4) {
          return;
        }
      }
    } catch (crawlError) {
      console.log('Crawl with actions failed, falling back to enhanced scraping:', crawlError.message);
    }

    // Fallback: Enhanced single page scraping with longer wait time
    this.socket.emit('status-update', { message: 'Using enhanced scraping fallback...' });
    
    const scrapeResult = await this.firecrawl.scrapeUrl(url, {
      pageOptions: {
        onlyMainContent: false,
        includeHtml: true,
        includeRawHtml: true,
        waitFor: 15000, // Wait longer for all content to potentially load
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
    
    // Google Ads Transparency specific patterns - enhanced to catch more variations
    const transparencyPatterns = [
      /\[!\[\]\((https:\/\/tpc\.googlesyndication\.com\/archive\/simgad\/\d+)\)\]\((https:\/\/adstransparency\.google\.com\/advertiser\/[^)]+)\)\s*\n\s*([^\n]+)\s*\n\s*(Verified|Not verified)/g,
      /https:\/\/tpc\.googlesyndication\.com\/archive\/simgad\/(\d+)[\s\S]*?https:\/\/adstransparency\.google\.com\/advertiser\/(AR\w+)\/creative\/(CR\w+)[\s\S]*?([A-Z\s&]+INC|[A-Z\s&]+LLC|[A-Z\s&]+CORP|[A-Z\s&]+LTD|[A-Z][A-Za-z\s&]+)[\s\S]*?(Verified|Not verified)/g
    ];
    
    let adIndex = 0;
    
    // Try multiple patterns to extract Google Ads Transparency format
    for (const pattern of transparencyPatterns) {
      let match;
      pattern.lastIndex = 0; // Reset pattern
      
      while ((match = pattern.exec(content)) !== null) {
        let imageUrl, detailUrl, advertiserName, verificationStatus, creativeId, advertiserId;
        
        if (match.length === 5) {
          // First pattern format
          [, imageUrl, detailUrl, advertiserName, verificationStatus] = match;
          const creativeMatch = detailUrl.match(/creative\/([^?]+)/);
          const advertiserMatch = detailUrl.match(/advertiser\/([^/]+)/);
          creativeId = creativeMatch ? creativeMatch[1] : null;
          advertiserId = advertiserMatch ? advertiserMatch[1] : null;
        } else if (match.length === 6) {
          // Second pattern format
          [, imageUrl, advertiserId, creativeId, advertiserName, verificationStatus] = match;
          detailUrl = `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}?region=anywhere`;
          imageUrl = `https://tpc.googlesyndication.com/archive/simgad/${imageUrl}`;
        }
        
        // Avoid duplicates
        const existingAd = ads.find(ad => 
          ad.metadata?.creativeId === creativeId || 
          ad.url === detailUrl ||
          ad.images.includes(imageUrl)
        );
        
        if (!existingAd && advertiserName && verificationStatus) {
          ads.push({
            id: `transparency_ad_${Date.now()}_${adIndex}`,
            title: advertiserName.trim() || 'Google Ads Transparency Ad',
            description: `${verificationStatus} advertiser on Google Ads Transparency. Creative ID: ${creativeId || 'Unknown'}, Advertiser ID: ${advertiserId || 'Unknown'}`,
            url: detailUrl,
            images: imageUrl ? [imageUrl] : [],
            format: 'Display',
            dateRange: 'Current',
            source: 'Google Ads Transparency',
            metadata: {
              advertiser: advertiserName.trim(),
              verified: verificationStatus === 'Verified',
              creativeId: creativeId,
              advertiserId: advertiserId
            }
          });
          
          adIndex++;
        }
      }
    }
    
    // Fallback: Look for advertiser patterns in the content
    if (ads.length === 0) {
      const lines = content.split('\n').map(line => line.trim()).filter(line => line);
      
      for (let i = 0; i < lines.length - 2; i++) {
        const currentLine = lines[i];
        const nextLine = lines[i + 1];
        const thirdLine = lines[i + 2];
        
        // Look for Google Ads image pattern
        if (currentLine.includes('tpc.googlesyndication.com') && 
            nextLine && nextLine.length > 0 && 
            thirdLine === 'Verified') {
          
          const imageMatch = currentLine.match(/https:\/\/tpc\.googlesyndication\.com\/archive\/simgad\/\d+/);
          const linkMatch = currentLine.match(/https:\/\/adstransparency\.google\.com\/advertiser\/[^\)]+/);
          
          if (imageMatch || linkMatch) {
            ads.push({
              id: `fallback_ad_${Date.now()}_${i}`,
              title: nextLine || 'Google Ads Transparency Ad',
              description: `Verified advertiser on Google Ads Transparency`,
              url: linkMatch ? linkMatch[0] : 'No URL found',
              images: imageMatch ? [imageMatch[0]] : [],
              format: 'Display',
              dateRange: 'Current',
              source: 'Google Ads Transparency Fallback'
            });
          }
        }
      }
    }
    
    // Original fallback logic for other ad formats
    if (ads.length === 0) {
      const blocks = content.split(/\n\s*\n/).filter(block => block.trim().length > 20);
      
      blocks.forEach((block, index) => {
        const urlMatch = block.match(/https?:\/\/[^\s]+/);
        
        if (urlMatch || block.includes('Ad') || block.includes('Sponsored')) {
          const blockLines = block.split('\n').map(line => line.trim()).filter(line => line);
          
          if (blockLines.length >= 2) {
            ads.push({
              id: `text_ad_${Date.now()}_${index}`,
              title: blockLines[0] || 'Extracted from text',
              description: blockLines.slice(1).join(' | '),
              url: urlMatch ? urlMatch[0] : 'No URL found',
              images: [],
              format: 'Text',
              dateRange: this.extractDateRange(block) || 'Unknown',
              source: 'Text extraction'
            });
          }
        }
      });
    }

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