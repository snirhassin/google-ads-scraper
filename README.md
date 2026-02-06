# Google Ads Transparency Scraper - Test Results

## Goal
Test if Apify can extract ad texts from Google Ads Transparency Center WITHOUT needing OCR.

## Target URL
https://adstransparency.google.com/advertiser/AR18082589962938613761?region=US

## CONCLUSION: OCR IS REQUIRED

### Finding
Google Ads Transparency Center renders **ALL ads as pre-rendered images**, including "Text" format ads. The ad text (headlines, descriptions, URLs) is NOT in the DOM.

### Evidence

1. **HTML Analysis**: Searched for key terms in page HTML:
   - "Sponsored" - NOT FOUND
   - "BUYEREVIEWS" - NOT FOUND
   - "Induction Cooktop" - NOT FOUND
   - "10 Best" - NOT FOUND

2. **Image Sources**: Found multiple images from `tpc.googlesyndication.com/archive/simgad/` - these ARE the ad creatives rendered as images

3. **Page Structure**: The visible ad preview card is an image, not DOM elements with text

4. **Format Label**: "Format: Text" only describes the original ad type - it's still rendered as an image for display

### What IS Available Without OCR

| Data | Available | Source |
|------|-----------|--------|
| Advertiser name | ✅ Yes | DOM text |
| Last shown date | ✅ Yes | DOM text |
| Ad format (Text/Image/Video) | ✅ Yes | DOM text |
| Region shown | ✅ Yes | DOM text |
| **Ad headline** | ❌ No | Image only |
| **Ad description** | ❌ No | Image only |
| **Display URL** | ❌ No | Image only |
| **Sitelinks** | ❌ No | Image only |
| **Promo text** | ❌ No | Image only |

### Recommendation for Apify

1. **Keep OCR step** - It's required to extract actual ad content
2. **Image URLs are available** - Can download from `tpc.googlesyndication.com/archive/simgad/{id}`
3. **Metadata is scrapable** - Advertiser name, dates, format, region

### Alternative Approaches

1. **Use Google Ads API** (if available for this data)
2. **Screenshot + OCR** - Take screenshots and run OCR
3. **Image download + Vision AI** - Download ad images and use GPT-4V or similar

## Files

| File | Description |
|------|-------------|
| `scrape-google-ads.js` | Initial scraper - gets ad URLs |
| `scrape-ads-v2.js` | Attempted text extraction |
| `scrape-final.js` | Final attempt at DOM scraping |
| `debug-page.js` | Debug script for page analysis |
| `debug-html.js` | HTML structure analysis |
| `debug-screenshot.png` | Screenshot showing ad preview |
| `debug-full.html` | Full page HTML (2.7MB) |

## Test Run Summary

- **Ads found**: 40-80 per advertiser page
- **Text extractable from DOM**: 0%
- **Ad previews**: Rendered as images
- **OCR requirement**: CONFIRMED

---

**Last Updated:** Feb 2026
**Status:** Testing complete - OCR confirmed required
