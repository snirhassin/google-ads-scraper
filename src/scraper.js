const puppeteer = require('puppeteer');
const XLSX = require('xlsx');

class AdsScraper {
  constructor(socket) {
    this.socket = socket;
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.isPaused = false;
    this.scrapedAds = [];
    this.totalAdsFound = 0;
  }

  async init() {
    try {
      this.socket.emit('status-update', { message: 'Launching browser...' });
      
      this.browser = await puppeteer.launch({
        headless: process.env.NODE_ENV === 'production' ? 'new' : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ],
        defaultViewport: { width: 1280, height: 800 },
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      });

      this.page = await this.browser.newPage();
      
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      });

      this.socket.emit('status-update', { message: 'Browser ready' });
    } catch (error) {
      throw new Error(`Failed to initialize browser: ${error.message}`);
    }
  }

  async scrapeTransparencyPage(url) {
    if (!url || !url.includes('adstransparency.google.com')) {
      throw new Error('Invalid Google Ads Transparency URL');
    }

    this.isRunning = true;
    this.isPaused = false;
    this.scrapedAds = [];

    try {
      await this.init();
      
      this.socket.emit('status-update', { message: 'Navigating to transparency page...' });
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      await this.page.waitForTimeout(3000);

      this.socket.emit('status-update', { message: 'Analyzing page structure...' });
      
      await this.scrapeAllAds();
      
      this.socket.emit('scraping-complete', {
        ads: this.scrapedAds,
        total: this.scrapedAds.length
      });

    } catch (error) {
      this.socket.emit('error', { message: error.message });
    } finally {
      await this.cleanup();
    }
  }

  async scrapeAllAds() {
    let hasMoreAds = true;
    let pageNumber = 1;

    while (hasMoreAds && this.isRunning) {
      if (this.isPaused) {
        this.socket.emit('status-update', { message: 'Scraping paused...' });
        await this.waitForResume();
      }

      this.socket.emit('status-update', { 
        message: `Scraping page ${pageNumber}...` 
      });

      const adsOnPage = await this.scrapeCurrentPageAds();
      this.scrapedAds.push(...adsOnPage);

      this.socket.emit('progress-update', {
        adsScraped: this.scrapedAds.length,
        currentPage: pageNumber
      });

      hasMoreAds = await this.loadMoreAds();
      pageNumber++;

      if (hasMoreAds) {
        await this.page.waitForTimeout(2000);
      }
    }
  }

  async scrapeCurrentPageAds() {
    try {
      await this.page.waitForSelector('[data-creative-id], .eLNT1d, .commercial-unit-desktop-rhs', { 
        timeout: 10000 
      }).catch(() => {
        console.log('No standard ad selectors found, trying alternative selectors...');
      });

      const ads = await this.page.evaluate(() => {
        const adElements = [];
        
        const selectors = [
          '[data-creative-id]',
          '.eLNT1d',
          '.commercial-unit-desktop-rhs',
          '.ads-ad',
          '.mnr-c',
          '.uEierd',
          '.VqFMTc',
          '.cu-container'
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          adElements.push(...Array.from(elements));
        }

        return Array.from(new Set(adElements)).map((adElement, index) => {
          try {
            const titleElement = adElement.querySelector('h3, .BNeawe, .LC20lb, .ads-creative-headline, [role="heading"]');
            const title = titleElement?.textContent?.trim() || '';

            const descElements = adElement.querySelectorAll('.VwiC3b, .BNeawe, .ads-creative-text, .yXK7lf, p');
            const description = Array.from(descElements)
              .map(el => el.textContent?.trim())
              .filter(text => text && text.length > 10)
              .join(' | ') || '';

            const linkElement = adElement.querySelector('a[href]');
            const url = linkElement?.href || '';

            const imageElements = adElement.querySelectorAll('img');
            const images = Array.from(imageElements)
              .map(img => img.src)
              .filter(src => src && !src.includes('data:image') && src.startsWith('http'));

            const formatIndicators = adElement.textContent || '';
            let adFormat = 'Text';
            if (images.length > 0) adFormat = 'Display';
            if (formatIndicators.includes('Video') || adElement.querySelector('video')) adFormat = 'Video';

            return {
              id: `ad_${Date.now()}_${index}`,
              title: title || 'No title found',
              description: description || 'No description found',
              url: url || 'No URL found',
              images: images,
              format: adFormat,
              dateRange: 'Unknown',
              rawElement: adElement.outerHTML.substring(0, 500)
            };
          } catch (error) {
            console.error('Error extracting ad data:', error);
            return null;
          }
        }).filter(ad => ad && (ad.title !== 'No title found' || ad.description !== 'No description found'));
      });

      console.log(`Found ${ads.length} ads on current page`);
      return ads;
    } catch (error) {
      console.error('Error scraping ads:', error);
      return [];
    }
  }

  async loadMoreAds() {
    try {
      const continueButton = await this.page.$('button[aria-label*="more"], button:contains("Show more"), .VfPpkd-Jh9lGc[aria-label*="more"], [data-ved]:contains("more")');
      
      if (continueButton) {
        this.socket.emit('status-update', { message: 'Loading more ads...' });
        
        await continueButton.click();
        await this.page.waitForTimeout(3000);
        
        await this.page.waitForLoadState?.('networkidle') || this.page.waitForTimeout(2000);
        
        return true;
      }

      const showMoreButtons = await this.page.$$eval('button, a', buttons => {
        return buttons.filter(button => {
          const text = button.textContent?.toLowerCase() || '';
          return text.includes('show more') || 
                 text.includes('load more') || 
                 text.includes('more results') ||
                 text.includes('continue') ||
                 button.getAttribute('aria-label')?.toLowerCase().includes('more');
        });
      });

      if (showMoreButtons.length > 0) {
        await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          const moreButton = buttons.find(button => {
            const text = button.textContent?.toLowerCase() || '';
            return text.includes('show more') || 
                   text.includes('load more') || 
                   text.includes('more results') ||
                   text.includes('continue') ||
                   button.getAttribute('aria-label')?.toLowerCase().includes('more');
          });
          
          if (moreButton) {
            moreButton.click();
            return true;
          }
          return false;
        });
        
        await this.page.waitForTimeout(3000);
        return true;
      }

      const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.page.waitForTimeout(2000);
      
      const newHeight = await this.page.evaluate(() => document.body.scrollHeight);
      
      if (newHeight > currentHeight) {
        this.socket.emit('status-update', { message: 'Loaded more content via scrolling...' });
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error loading more ads:', error);
      return false;
    }
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
        'Scraped At': new Date().toISOString()
      })));

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Ads');
      
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      throw new Error(`Failed to create Excel file: ${error.message}`);
    }
  }

  async cleanup() {
    this.isRunning = false;
    try {
      if (this.page) {
        await this.page.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

module.exports = AdsScraper;