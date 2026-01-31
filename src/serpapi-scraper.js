const axios = require('axios');
const XLSX = require('xlsx');

class SerpApiAdsScraper {
  constructor(socket) {
    this.socket = socket;
    this.apiKey = process.env.SERPAPI_API_KEY;
    this.isRunning = false;
    this.isPaused = false;
    this.scrapedAds = [];
    this.totalPagesScraped = 0;
  }

  async scrapeTransparencyPage(url) {
    if (!url || !url.includes('adstransparency.google.com')) {
      throw new Error('Invalid Google Ads Transparency URL');
    }

    if (!this.apiKey) {
      throw new Error('SERPAPI_API_KEY environment variable is required');
    }

    this.isRunning = true;
    this.isPaused = false;
    this.scrapedAds = [];
    this.totalPagesScraped = 0;

    try {
      this.socket.emit('status-update', { message: 'Starting SerpAPI scraping...' });

      // Parse the URL to extract search parameters
      const searchParams = this.parseTransparencyUrl(url);

      // Fetch ads using SerpAPI
      await this.fetchAdsFromSerpApi(searchParams);

      this.socket.emit('scraping-complete', {
        ads: this.scrapedAds,
        total: this.scrapedAds.length
      });

    } catch (error) {
      console.error('SerpAPI scraping error:', error);
      this.socket.emit('error', { message: `Scraping failed: ${error.message}` });
      throw error;
    }
  }

  parseTransparencyUrl(url) {
    const urlObj = new URL(url);
    const params = {};

    // Extract domain from URL parameters
    const domain = urlObj.searchParams.get('domain');
    const advertiserId = urlObj.searchParams.get('advertiser_id') ||
                         urlObj.pathname.match(/advertiser\/(AR\d+)/)?.[1];
    const region = urlObj.searchParams.get('region');

    if (advertiserId) {
      params.advertiser_id = advertiserId;
    } else if (domain) {
      params.text = domain;
    } else {
      // Try to extract domain from text parameter or path
      const text = urlObj.searchParams.get('text');
      if (text) {
        params.text = text;
      } else {
        throw new Error('Could not extract domain or advertiser ID from URL');
      }
    }

    // Map region parameter
    if (region && region !== 'anywhere') {
      params.region = this.mapRegion(region);
    }

    return params;
  }

  mapRegion(region) {
    // Map common region codes to SerpAPI format
    const regionMap = {
      'US': '2840',
      'GB': '2826',
      'UK': '2826',
      'DE': '2276',
      'FR': '2250',
      'JP': '2392',
      'CA': '2124',
      'AU': '2036',
      'anywhere': null
    };
    return regionMap[region?.toUpperCase()] || region;
  }

  async fetchAdsFromSerpApi(searchParams) {
    let nextPageToken = null;
    let pageNum = 1;
    const maxPages = 10; // Safety limit

    do {
      if (this.isPaused) {
        await this.waitForResume();
      }

      if (!this.isRunning) {
        break;
      }

      this.socket.emit('status-update', {
        message: `Fetching page ${pageNum}...`
      });

      const params = {
        engine: 'google_ads_transparency_center',
        api_key: this.apiKey,
        num: 100, // Max results per request
        ...searchParams
      };

      if (nextPageToken) {
        params.next_page_token = nextPageToken;
      }

      try {
        const response = await axios.get('https://serpapi.com/search', { params });
        const data = response.data;

        if (data.error) {
          throw new Error(data.error);
        }

        // Process ad creatives
        const adCreatives = data.ad_creatives || [];

        for (const creative of adCreatives) {
          const ad = this.transformAdCreative(creative);
          if (ad && this.isValidAd(ad)) {
            this.scrapedAds.push(ad);
          }
        }

        this.totalPagesScraped = pageNum;

        this.socket.emit('progress-update', {
          adsScraped: this.scrapedAds.length,
          currentPage: pageNum,
          totalPages: data.search_information?.total_results
            ? Math.ceil(data.search_information.total_results / 100)
            : pageNum
        });

        // Check for pagination
        nextPageToken = data.serpapi_pagination?.next_page_token;
        pageNum++;

        // Rate limiting - wait between requests
        if (nextPageToken && this.isRunning) {
          await this.delay(1000);
        }

      } catch (error) {
        if (error.response?.status === 429) {
          this.socket.emit('status-update', {
            message: 'Rate limited, waiting...'
          });
          await this.delay(5000);
          continue;
        }
        throw error;
      }

    } while (nextPageToken && pageNum <= maxPages && this.isRunning);

    this.socket.emit('status-update', {
      message: `Completed! Found ${this.scrapedAds.length} ads`
    });
  }

  transformAdCreative(creative) {
    // Convert SerpAPI format to our standard format
    const firstShown = creative.first_shown
      ? new Date(creative.first_shown * 1000).toLocaleDateString()
      : 'Unknown';
    const lastShown = creative.last_shown
      ? new Date(creative.last_shown * 1000).toLocaleDateString()
      : 'Present';

    return {
      id: creative.ad_creative_id || `serpapi_${Date.now()}_${Math.random()}`,
      title: creative.advertiser || 'Unknown Advertiser',
      description: this.buildDescription(creative),
      url: creative.details_link || '',
      images: creative.image ? [creative.image] : [],
      format: this.mapFormat(creative.format),
      dateRange: `${firstShown} - ${lastShown}`,
      source: 'SerpAPI',
      metadata: {
        advertiserId: creative.advertiser_id,
        creativeId: creative.ad_creative_id,
        advertiser: creative.advertiser,
        format: creative.format,
        firstShown: creative.first_shown,
        lastShown: creative.last_shown
      }
    };
  }

  buildDescription(creative) {
    const parts = [];

    if (creative.advertiser_id) {
      parts.push(`Advertiser ID: ${creative.advertiser_id}`);
    }
    if (creative.ad_creative_id) {
      parts.push(`Creative ID: ${creative.ad_creative_id}`);
    }
    if (creative.format) {
      parts.push(`Format: ${creative.format}`);
    }

    return parts.join(' | ') || 'Google Ads Transparency Ad';
  }

  mapFormat(format) {
    const formatMap = {
      'text': 'Text',
      'image': 'Display',
      'video': 'Video',
      'TEXT': 'Text',
      'IMAGE': 'Display',
      'VIDEO': 'Video'
    };
    return formatMap[format] || format || 'Unknown';
  }

  isValidAd(ad) {
    return ad && (
      (ad.title && ad.title !== 'Unknown Advertiser') ||
      ad.url ||
      ad.images.length > 0
    );
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        'Advertiser': ad.title,
        'Description': ad.description,
        'Details URL': ad.url,
        'Image URL': ad.images.join(', '),
        'Format': ad.format,
        'Date Range': ad.dateRange,
        'Advertiser ID': ad.metadata?.advertiserId || '',
        'Creative ID': ad.metadata?.creativeId || '',
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

module.exports = SerpApiAdsScraper;
