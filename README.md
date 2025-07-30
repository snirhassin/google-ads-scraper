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

## Installation

```bash
npm install
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

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