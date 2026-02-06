const axios = require('axios');

// Fetch image and convert to base64
async function fetchImageAsBase64(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const base64 = Buffer.from(response.data).toString('base64');
    const contentType = response.headers['content-type'] || 'image/png';
    return { base64, mediaType: contentType };
  } catch (error) {
    console.error('Image fetch error:', error.message);
    return null;
  }
}

// Use Claude's vision to extract text from ad image
async function extractTextWithClaude(imageUrl) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return { error: 'ANTHROPIC_API_KEY not configured' };
  }

  try {
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) {
      return { error: 'Failed to fetch image' };
    }

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-5-haiku-20241022',  // Haiku is 3x faster, 10x cheaper
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageData.mediaType,
              data: imageData.base64
            }
          },
          {
            type: 'text',
            text: `Analyze this Google ad image and extract the following information in JSON format:
{
  "headline": "main headline/title text",
  "description": "body text or description",
  "callToAction": "button text like 'Shop Now', 'Learn More'",
  "visibleUrl": "displayed URL like 'www.example.com'",
  "brandName": "brand or company name if visible",
  "allText": "all text in the ad combined"
}

Only include fields that are clearly visible. Use empty string "" for fields not found. Return ONLY valid JSON, no other text.`
          }
        ]
      }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      timeout: 30000
    });

    if (response.data?.content?.[0]?.text) {
      const text = response.data.content[0].text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { error: 'No JSON found in response', raw: text.slice(0, 200) };
    }
    return { error: 'Empty response from Claude' };
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error('Claude vision error:', errMsg);
    return { error: `Claude API error: ${errMsg}` };
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Batch OCR endpoint - processes a batch of ads
module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  // Expect array of { id, imageUrl } objects
  const ads = req.body?.ads || [];
  const batchSize = 15; // Process 15 at a time (Haiku is fast)

  if (!Array.isArray(ads) || ads.length === 0) {
    return res.status(400).json({ error: 'No ads provided. Expected { ads: [{ id, imageUrl }, ...] }' });
  }

  // Limit batch size to prevent timeout (max ~100 per request with 300s timeout using Haiku)
  const maxBatch = 100;
  const adsToProcess = ads.slice(0, maxBatch);

  const results = [];
  const stats = { attempted: 0, successful: 0, failed: 0 };

  try {
    // Process in parallel batches
    for (let i = 0; i < adsToProcess.length; i += batchSize) {
      const batch = adsToProcess.slice(i, i + batchSize);

      const batchResults = await Promise.all(batch.map(async (ad) => {
        const imageUrl = ad.imageUrl || ad.image;
        if (!imageUrl) {
          return { id: ad.id, error: 'No image URL', success: false };
        }

        stats.attempted++;
        const extracted = await extractTextWithClaude(imageUrl);

        if (extracted && !extracted.error) {
          stats.successful++;
          return {
            id: ad.id,
            success: true,
            data: extracted
          };
        } else {
          stats.failed++;
          return {
            id: ad.id,
            success: false,
            error: extracted?.error || 'Unknown error'
          };
        }
      }));

      results.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < adsToProcess.length) {
        await delay(200);
      }
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      stats: stats,
      results: results
    });

  } catch (error) {
    console.error('Batch OCR error:', error);
    return res.status(500).json({
      error: error.message || 'Batch OCR failed',
      partialResults: results,
      stats: stats
    });
  }
};
