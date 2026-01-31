# Google Ads Transparency Scraper

A web-based tool for scraping and analyzing Google Ads Transparency data using the SerpAPI, with a user-friendly interface.

## Features

- **Web UI**: Simple interface to input Google Ads Transparency URLs
- **Real-time Progress**: Live progress indicators and status updates
- **Control Functions**: Start, stop, and resume scraping operations
- **Data Extraction**: Scrapes advertiser names, creative IDs, images, and formats
- **Pagination**: Automatically handles pagination (up to 100 ads per request)
- **Excel Export**: Download scraped data as Excel files
- **Real-time Updates**: WebSocket-based live updates

## API: SerpAPI

This scraper uses [SerpAPI's Google Ads Transparency Center API](https://serpapi.com/google-ads-transparency-center-api) which provides:
- Structured JSON responses (no HTML parsing needed)
- Up to 100 results per request
- Built-in pagination support
- Higher reliability than web scraping

## Deployment

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

1. Click the "Deploy on Railway" button above
2. Connect your GitHub account and fork this repository
3. Railway will automatically deploy your app
4. Set environment variables in Railway:
   - `NODE_ENV=production`
   - `SERPAPI_API_KEY=your_api_key_here`
5. Access your deployed app at the provided Railway URL

### Local Development

```bash
# Install dependencies
npm install

# Set your SerpAPI key
cp .env.example .env
# Edit .env and add your SERPAPI_API_KEY

# Start the server
npm run start:full
```

Open your browser and navigate to `http://localhost:3000`

## Usage

1. Enter a Google Ads Transparency URL:
   - By domain: `https://adstransparency.google.com/?region=anywhere&domain=example.com`
   - By advertiser: `https://adstransparency.google.com/advertiser/AR17828074650563772417`

2. Click "Start Scraping" and monitor the progress

3. View results and export to Excel when complete

## Example URLs

- `https://adstransparency.google.com/?region=anywhere&domain=buyereviews.com`
- `https://adstransparency.google.com/?region=anywhere&domain=amazon.com`
- `https://adstransparency.google.com/?region=US&domain=walmart.com`

## Requirements

- Node.js 18+
- SerpAPI key (get one at [serpapi.com](https://serpapi.com))

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SERPAPI_API_KEY` | Your SerpAPI API key | Yes |
| `PORT` | Server port (default: 3000) | No |
| `NODE_ENV` | Environment (development/production) | No |

## License

MIT