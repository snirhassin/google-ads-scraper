const axios = require('axios');

// Vercel Serverless Function for Google Ads Transparency scraping
module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get URL from query params (GET) or body (POST)
  const url = req.method === 'GET'
    ? req.query.url
    : req.body?.url;

  // Option to fetch details (default: true, limit to first 100 for performance)
  const fetchDetails = req.body?.fetchDetails !== false;
  const detailsLimit = req.body?.detailsLimit || 100;

  if (!url || !url.includes('adstransparency.google.com')) {
    return res.status(400).json({
      error: 'Invalid or missing Google Ads Transparency URL',
      example: 'https://adstransparency.google.com/?region=anywhere&domain=example.com'
    });
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'SERPAPI_API_KEY not configured' });
  }

  try {
    const searchParams = parseTransparencyUrl(url);
    const ads = await fetchAdsFromSerpApi(searchParams, apiKey, fetchDetails, detailsLimit);

    return res.status(200).json({
      success: true,
      total: ads.length,
      url: url,
      fetchedDetails: fetchDetails,
      detailsLimit: detailsLimit,
      ads: ads
    });

  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({
      error: error.message || 'Scraping failed',
      details: error.response?.data || null
    });
  }
};

function parseTransparencyUrl(url) {
  const urlObj = new URL(url);
  const params = {};

  // Extract domain or advertiser ID
  const domain = urlObj.searchParams.get('domain');
  const advertiserId = urlObj.searchParams.get('advertiser_id') ||
                       urlObj.pathname.match(/advertiser\/(AR\d+)/)?.[1];
  const region = urlObj.searchParams.get('region');

  if (advertiserId) {
    params.advertiser_id = advertiserId;
  } else if (domain) {
    params.text = domain;
  } else {
    const text = urlObj.searchParams.get('text');
    if (text) {
      params.text = text;
    } else {
      throw new Error('Could not extract domain or advertiser ID from URL');
    }
  }

  // Map region parameter
  if (region && region !== 'anywhere') {
    params.region = mapRegion(region);
  }

  return params;
}

function mapRegion(region) {
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

async function fetchAdsFromSerpApi(searchParams, apiKey, fetchDetails, detailsLimit) {
  const scrapedAds = [];
  let nextPageToken = null;
  let pageNum = 1;
  const maxPages = 5; // Limit for serverless timeout

  do {
    const params = {
      engine: 'google_ads_transparency_center',
      api_key: apiKey,
      num: 100,
      ...searchParams
    };

    if (nextPageToken) {
      params.next_page_token = nextPageToken;
    }

    const response = await axios.get('https://serpapi.com/search', { params });
    const data = response.data;

    if (data.error) {
      throw new Error(data.error);
    }

    // Process ad creatives
    const adCreatives = data.ad_creatives || [];

    for (const creative of adCreatives) {
      const ad = transformAdCreative(creative);
      if (ad && isValidAd(ad)) {
        scrapedAds.push(ad);
      }
    }

    // Check for pagination
    nextPageToken = data.serpapi_pagination?.next_page_token;
    pageNum++;

    // Small delay between requests
    if (nextPageToken && pageNum <= maxPages) {
      await delay(300);
    }

  } while (nextPageToken && pageNum <= maxPages);

  // Fetch details for ads (in parallel batches)
  if (fetchDetails && scrapedAds.length > 0) {
    const adsToFetchDetails = scrapedAds.slice(0, detailsLimit);
    await fetchAdDetails(adsToFetchDetails, apiKey);
  }

  return scrapedAds;
}

async function fetchAdDetails(ads, apiKey) {
  // Process in parallel batches of 10
  const batchSize = 10;

  for (let i = 0; i < ads.length; i += batchSize) {
    const batch = ads.slice(i, i + batchSize);

    await Promise.all(batch.map(async (ad) => {
      try {
        if (!ad.rawData?.serpapi_details_link) return;

        // Append API key to the serpapi_details_link
        const baseUrl = ad.rawData.serpapi_details_link;
        const detailsUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + `api_key=${apiKey}`;

        const response = await axios.get(detailsUrl, { timeout: 10000 });
        const details = response.data;

        if (details.error) return;

        // Store full response for debugging
        ad.detailsApiResponse = details;

        // The details might be in different places depending on the response
        const adDetails = details.ad_creative || details.creative || details || {};

        // Update ad with detailed information
        ad.headline = adDetails.headline || adDetails.title || ad.headline || '';
        ad.text = adDetails.text || adDetails.body_text || ad.text || '';
        ad.description = adDetails.description || adDetails.body || ad.description || '';
        ad.callToAction = adDetails.call_to_action || adDetails.cta || ad.callToAction || '';

        // URLs from details
        ad.destinationUrl = adDetails.destination_url || adDetails.landing_page_url || adDetails.final_url || ad.destinationUrl || '';
        ad.displayUrl = adDetails.display_url || adDetails.visible_url || ad.displayUrl || '';

        // Additional fields from details
        ad.businessName = adDetails.business_name || '';
        ad.advertiserWebsite = adDetails.advertiser_website || '';

        // Media from details
        if (adDetails.images && adDetails.images.length > 0) {
          ad.images = adDetails.images;
          ad.image = ad.image || adDetails.images[0];
        }
        if (adDetails.videos && adDetails.videos.length > 0) {
          ad.videos = adDetails.videos;
          ad.videoUrl = ad.videoUrl || adDetails.videos[0]?.url;
        }

        // Ad variations
        if (adDetails.variations) {
          ad.variations = adDetails.variations;
        }

        // Regions shown
        if (adDetails.regions_shown) {
          ad.regionsShown = adDetails.regions_shown;
        }

        // Store raw details
        ad.rawDetails = adDetails;

      } catch (error) {
        // Silently fail for individual ad details
        console.error(`Failed to fetch details for ad ${ad.id}: ${error.message}`);
      }
    }));

    // Small delay between batches
    if (i + batchSize < ads.length) {
      await delay(200);
    }
  }
}

function transformAdCreative(creative) {
  const firstShown = creative.first_shown
    ? new Date(creative.first_shown * 1000).toLocaleDateString()
    : 'Unknown';
  const lastShown = creative.last_shown
    ? new Date(creative.last_shown * 1000).toLocaleDateString()
    : 'Present';

  return {
    // Identifiers
    id: creative.ad_creative_id || `serpapi_${Date.now()}_${Math.random()}`,
    advertiserId: creative.advertiser_id || '',
    creativeId: creative.ad_creative_id || '',

    // Advertiser info
    advertiser: creative.advertiser || 'Unknown Advertiser',
    advertiserLocation: creative.advertiser_location || '',
    advertiserVerified: creative.advertiser_verified || false,

    // Ad content - will be populated from details API
    headline: creative.headline || creative.title || '',
    text: creative.text || '',
    description: creative.description || '',
    callToAction: creative.call_to_action || '',

    // URLs - will be populated from details API
    destinationUrl: creative.destination_url || creative.landing_page || '',
    displayUrl: creative.display_url || '',
    detailsLink: creative.details_link || '',

    // Media
    image: creative.image || null,
    imageUrl: creative.image_url || creative.image || null,
    videoUrl: creative.video_url || null,

    // Metadata
    format: mapFormat(creative.format),
    adType: creative.ad_type || creative.format || '',
    dateRange: `${firstShown} - ${lastShown}`,
    firstShown: firstShown,
    lastShown: lastShown,
    firstShownTimestamp: creative.first_shown,
    lastShownTimestamp: creative.last_shown,
    totalDaysShown: creative.total_days_shown || null,

    // Targeting
    regions: creative.regions || [],
    targetedRegions: creative.targeted_regions || [],

    // Dimensions
    width: creative.width || null,
    height: creative.height || null,

    // Raw data for reference
    rawData: creative
  };
}

function mapFormat(format) {
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

function isValidAd(ad) {
  return ad && (
    (ad.advertiser && ad.advertiser !== 'Unknown Advertiser') ||
    ad.detailsLink ||
    ad.destinationUrl ||
    ad.image ||
    ad.text ||
    ad.headline
  );
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
