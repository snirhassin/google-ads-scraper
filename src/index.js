const puppeteer = require('puppeteer');

class GoogleAdsScraper {
  constructor() {
    this.browser = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async scrape(keyword) {
    if (!this.browser) {
      await this.init();
    }

    const page = await this.browser.newPage();
    
    try {
      // Navigate to Google search with ads
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(keyword)}`);
      
      // Wait for results to load
      await page.waitForSelector('#search', { timeout: 5000 });
      
      // Extract ad data
      const ads = await page.evaluate(() => {
        const adElements = document.querySelectorAll('[data-text-ad]');
        return Array.from(adElements).map(ad => {
          const title = ad.querySelector('h3')?.textContent || '';
          const description = ad.querySelector('.VwiC3b')?.textContent || '';
          const url = ad.querySelector('a')?.href || '';
          
          return {
            title,
            description,
            url,
            keyword: window.location.search.match(/q=([^&]*)/)?.[1] || ''
          };
        });
      });

      return ads;
    } catch (error) {
      console.error('Error scraping ads:', error);
      return [];
    } finally {
      await page.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Example usage
async function main() {
  const scraper = new GoogleAdsScraper();
  
  try {
    const ads = await scraper.scrape('web development services');
    console.log('Found ads:', ads);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = GoogleAdsScraper;