const { ApifyClient } = require('apify-client');

// Vercel Serverless Function for Google Ads Transparency scraping via Apify
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

  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) {
    return res.status(500).json({ error: 'APIFY_API_TOKEN not configured' });
  }

  const client = new ApifyClient({ token: apiToken });

  // Check if this is a poll request for an existing run
  const runId = req.body?.runId;
  if (runId) {
    const includePartialResults = req.body?.includePartialResults || false;
    const offset = req.body?.offset || 0;
    const limit = req.body?.limit || 200;
    return await pollRunStatus(client, runId, res, includePartialResults, offset, limit);
  }

  // Get URL from query params (GET) or body (POST)
  const url = req.method === 'GET'
    ? req.query.url
    : req.body?.url;

  // Max results to fetch
  const maxResults = req.body?.maxResults || 10000;

  if (!url || !url.includes('adstransparency.google.com')) {
    return res.status(400).json({
      error: 'Invalid or missing Google Ads Transparency URL',
      example: 'https://adstransparency.google.com/?region=anywhere&domain=example.com'
    });
  }

  try {
    // Prepare input for the Apify actor
    const input = {
      startUrls: [url],
      maxItems: maxResults,
    };

    console.log('Apify input:', JSON.stringify(input));

    // Start the Actor run WITHOUT waiting (async mode)
    const run = await client.actor('memo23/google-ad-transparency-scraper-cheerio').start(input, {
      timeout: 3600, // 60 minutes max on Apify side
    });

    console.log('Started Apify run:', run.id);

    // Return immediately with run ID - frontend will poll
    return res.status(202).json({
      success: true,
      status: 'RUNNING',
      message: 'Scraping started. Poll with runId to get results.',
      runId: run.id,
      url: url,
      source: 'apify',
      apiVersion: 'apify-v2-async'
    });

  } catch (error) {
    console.error('Apify scraping error:', error);
    return res.status(500).json({
      error: error.message || 'Apify scraping failed',
      details: error.response?.data || null
    });
  }
};

// Poll for run status and get results when complete
async function pollRunStatus(client, runId, res, includePartialResults = false, offset = 0, limit = 200) {
  try {
    const run = await client.run(runId).get();

    if (!run) {
      return res.status(404).json({ error: 'Run not found', runId });
    }

    console.log('Run status:', run.status, 'for', runId, 'stats:', JSON.stringify(run.stats || {}));

    if (run.status === 'RUNNING' || run.status === 'READY') {
      // Still running - return status with optional partial results
      const response = {
        success: true,
        status: run.status,
        runId: runId,
        message: 'Still running...',
        stats: {
          ...run.stats,
          itemsScraped: run.stats?.itemsScraped || 0,
          itemCount: run.stats?.itemCount || 0
        }
      };

      // Fetch partial results if requested and dataset exists
      if (includePartialResults && run.defaultDatasetId) {
        try {
          // First get dataset info for accurate count
          const datasetInfo = await client.dataset(run.defaultDatasetId).get();
          const totalItems = datasetInfo?.itemCount || 0;
          response.total = totalItems;
          response.stats.itemsScraped = totalItems;

          console.log(`Dataset has ${totalItems} items`);

          // Fetch items incrementally using offset/limit
          if (totalItems > 0) {
            const { items } = await client.dataset(run.defaultDatasetId).listItems({ offset, limit });
            if (items && items.length > 0) {
              response.partialAds = items.map(item => transformApifyAd(item));
              console.log(`Returning ${response.partialAds.length} partial results (offset: ${offset}, total: ${totalItems})`);
            }
          }
        } catch (partialError) {
          console.log('Could not fetch partial results:', partialError.message);
        }
      }

      return res.status(200).json(response);
    }

    if (run.status === 'SUCCEEDED' || run.status === 'TIMED-OUT') {
      // Completed (or timed out with partial results) - fetch results
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const ads = items.map(item => transformApifyAd(item));

      return res.status(200).json({
        success: true,
        status: run.status,
        total: ads.length,
        runId: runId,
        source: 'apify',
        apiVersion: 'apify-v2-async',
        ads: ads
      });
    }

    // Failed or aborted
    return res.status(200).json({
      success: false,
      status: run.status,
      runId: runId,
      error: `Run ${run.status}`,
      exitCode: run.exitCode
    });

  } catch (error) {
    console.error('Poll error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to poll run status',
      runId: runId
    });
  }
}

function transformApifyAd(item) {
  // Transform Apify output to match our existing format
  // Apify returns: advertiserId, creativeId, adUrl, archiveImageUrl, format, advertiserName,
  // firstShown, lastShown, adLink, creativeRegions, regionStats, variations

  // Extract image URL from variations or archiveImageUrl
  let imageUrl = item.archiveImageUrl || null;
  if (!imageUrl && item.variations && item.variations.length > 0) {
    const imageVariation = item.variations.find(v => v.format === 'IMAGE');
    if (imageVariation) {
      imageUrl = imageVariation.link;
    }
  }

  // Format dates
  const firstShown = item.firstShown ? new Date(item.firstShown).toLocaleDateString() : 'Unknown';
  const lastShown = item.lastShown ? new Date(item.lastShown).toLocaleDateString() : 'Present';

  return {
    // Identifiers
    id: item.creativeId || `apify_${Date.now()}_${Math.random()}`,
    advertiserId: item.advertiserId || '',
    creativeId: item.creativeId || '',

    // Advertiser info
    advertiser: item.advertiserName || 'Unknown Advertiser',
    advertiserLocation: '',
    advertiserVerified: false,
    adFundedBy: item.advertiserName || '',

    // Ad content (Apify doesn't extract text - will need OCR)
    headline: '',
    title: '',
    text: '',
    description: '',
    callToAction: '',

    // URLs
    destinationUrl: '',
    displayUrl: '',
    visibleLink: '',
    detailsLink: item.adUrl || '',

    // Media
    image: imageUrl,
    imageUrl: imageUrl,
    videoUrl: null,

    // Metadata
    format: item.format || 'Unknown',
    adType: item.format || '',
    dateRange: `${firstShown} - ${lastShown}`,
    firstShown: firstShown,
    lastShown: lastShown,

    // Targeting
    regions: item.creativeRegions || [],
    regionName: item.creativeRegions?.[0] || '',
    regionStats: item.regionStats || [],

    // Variations (multiple ad sizes/formats)
    variations: item.variations || [],

    // Raw data for reference
    rawData: item,
    source: 'apify'
  };
}
