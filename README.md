# Google Ads Transparency Scraper

A web-based tool for scraping and analyzing Google Ads Transparency data with a user-friendly interface.

## Features

- **Web UI**: Simple interface to input Google Ads Transparency URLs
- **Real-time Progress**: Live progress indicators and status updates
- **Control Functions**: Start, stop, and resume scraping operations
- **Data Extraction**: Scrapes ad titles, descriptions, URLs, images, and formats
- **Pagination**: Automatically handles "Show More" buttons and infinite scroll
- **Excel Export**: Download scraped data as Excel files
- **Real-time Updates**: WebSocket-based live updates

## Deployment

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

1. Click the "Deploy on Railway" button above
2. Connect your GitHub account and fork this repository
3. Railway will automatically deploy your app
4. Set `NODE_ENV=production` in Railway environment variables
5. Access your deployed app at the provided Railway URL

### Local Development

```bash
npm install
npm start
```

Open your browser and navigate to `http://localhost:3000`

3. Enter a Google Ads Transparency URL (e.g., `https://adstransparency.google.com/?region=anywhere&domain=example.com`)

4. Click "Start Scraping" and monitor the progress

5. View results and export to Excel when complete

## Development

```bash
npm run dev
```

## Example URLs

- `https://adstransparency.google.com/?region=anywhere&domain=buyereviews.com`
- `https://adstransparency.google.com/?region=anywhere&domain=example.com`

## Requirements

- Node.js 14+
- Chrome/Chromium browser (for Puppeteer)

## License

MIT