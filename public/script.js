class GoogleAdsScraperUI {
  constructor() {
    this.socket = io();
    this.isScrapingActive = false;
    this.scrapedAds = [];
    
    this.initializeElements();
    this.bindEvents();
    this.setupSocketListeners();
  }

  initializeElements() {
    this.urlInput = document.getElementById('transparency-url');
    this.startBtn = document.getElementById('start-btn');
    this.stopBtn = document.getElementById('stop-btn');
    this.resumeBtn = document.getElementById('resume-btn');
    
    this.progressSection = document.querySelector('.progress-section');
    this.progressFill = document.getElementById('progress-fill');
    this.adsScrapedSpan = document.getElementById('ads-scraped');
    this.currentStatusSpan = document.getElementById('current-status');
    
    this.resultsSection = document.querySelector('.results-section');
    this.resultsTableBody = document.getElementById('results-tbody');
    this.exportExcelBtn = document.getElementById('export-excel-btn');
    this.clearResultsBtn = document.getElementById('clear-results-btn');
    
    this.loadingOverlay = document.getElementById('loading-overlay');
  }

  bindEvents() {
    this.startBtn.addEventListener('click', () => this.startScraping());
    this.stopBtn.addEventListener('click', () => this.stopScraping());
    this.resumeBtn.addEventListener('click', () => this.resumeScraping());
    this.exportExcelBtn.addEventListener('click', () => this.exportToExcel());
    this.clearResultsBtn.addEventListener('click', () => this.clearResults());
    
    this.urlInput.addEventListener('input', () => this.validateUrl());
    this.urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && this.isValidUrl()) {
        this.startScraping();
      }
    });
  }

  setupSocketListeners() {
    this.socket.on('status-update', (data) => {
      this.updateStatus(data.message);
    });

    this.socket.on('progress-update', (data) => {
      this.updateProgress(data.adsScraped, data.currentPage);
    });

    this.socket.on('scraping-complete', (data) => {
      this.handleScrapingComplete(data);
    });

    this.socket.on('error', (data) => {
      this.handleError(data.message);
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.handleError('Connection to server lost');
    });
  }

  validateUrl() {
    const url = this.urlInput.value.trim();
    const isValid = this.isValidUrl();
    
    this.urlInput.style.borderColor = isValid || !url ? '#e1e5e9' : '#ff6b6b';
    this.startBtn.disabled = !isValid || this.isScrapingActive;
  }

  isValidUrl() {
    const url = this.urlInput.value.trim();
    return url && url.includes('adstransparency.google.com') && url.startsWith('http');
  }

  startScraping() {
    if (!this.isValidUrl()) {
      this.showError('Please enter a valid Google Ads Transparency URL');
      return;
    }

    const url = this.urlInput.value.trim();
    this.isScrapingActive = true;
    this.scrapedAds = [];
    
    this.updateButtonStates();
    this.showLoadingOverlay('Starting scraper...');
    this.progressSection.style.display = 'block';
    this.resultsSection.style.display = 'none';
    
    this.socket.emit('start-scraping', { url });
  }

  stopScraping() {
    this.socket.emit('stop-scraping');
    this.isScrapingActive = false;
    this.updateButtonStates();
    this.hideLoadingOverlay();
    this.updateStatus('Scraping stopped by user');
  }

  resumeScraping() {
    this.socket.emit('resume-scraping');
    this.updateStatus('Resuming scraping...');
  }

  updateButtonStates() {
    this.startBtn.disabled = this.isScrapingActive || !this.isValidUrl();
    this.stopBtn.disabled = !this.isScrapingActive;
    this.resumeBtn.disabled = !this.isScrapingActive;
  }

  updateStatus(message) {
    this.currentStatusSpan.textContent = message;
    console.log('Status:', message);
  }

  updateProgress(adsScraped, currentPage) {
    this.adsScrapedSpan.textContent = adsScraped;
    
    if (currentPage) {
      this.updateStatus(`Processing page ${currentPage}...`);
    }
    
    this.progressFill.style.width = `${Math.min((adsScraped / 100) * 100, 100)}%`;
  }

  handleScrapingComplete(data) {
    this.isScrapingActive = false;
    this.scrapedAds = data.ads;
    
    this.updateButtonStates();
    this.hideLoadingOverlay();
    this.updateStatus(`Scraping complete! Found ${data.total} ads`);
    
    this.displayResults();
    this.resultsSection.style.display = 'block';
  }

  handleError(message) {
    this.isScrapingActive = false;
    this.updateButtonStates();
    this.hideLoadingOverlay();
    this.showError(message);
  }

  displayResults() {
    this.resultsTableBody.innerHTML = '';
    
    if (this.scrapedAds.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="6" style="text-align: center; color: #666;">No ads found</td>';
      this.resultsTableBody.appendChild(row);
      return;
    }

    this.scrapedAds.forEach((ad, index) => {
      const row = document.createElement('tr');
      
      const imagesHtml = ad.images.length > 0 
        ? `<div class="ad-images">${ad.images.slice(0, 3).map(img => 
            `<img src="${img}" alt="Ad image" onerror="this.style.display='none'">`
          ).join('')}</div>`
        : 'No images';

      row.innerHTML = `
        <td><strong>${this.escapeHtml(ad.title)}</strong></td>
        <td>${this.escapeHtml(ad.description)}</td>
        <td><a href="${ad.url}" target="_blank" rel="noopener">${this.truncateUrl(ad.url)}</a></td>
        <td>${imagesHtml}</td>
        <td><span class="badge badge-${ad.format.toLowerCase()}">${ad.format}</span></td>
        <td>${ad.dateRange}</td>
      `;
      
      this.resultsTableBody.appendChild(row);
    });
  }

  async exportToExcel() {
    if (this.scrapedAds.length === 0) {
      this.showError('No data to export');
      return;
    }

    try {
      this.showLoadingOverlay('Generating Excel file...');
      
      const workbook = this.createWorkbook();
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      
      const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      link.download = `google-ads-scraper-${timestamp}.xlsx`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      this.hideLoadingOverlay();
      this.showSuccess('Excel file downloaded successfully!');
      
    } catch (error) {
      this.hideLoadingOverlay();
      this.showError('Failed to export Excel file: ' + error.message);
    }
  }

  createWorkbook() {
    const ws_data = [
      ['Ad Title', 'Description', 'URL', 'Images', 'Format', 'Date Range', 'Scraped At']
    ];
    
    this.scrapedAds.forEach(ad => {
      ws_data.push([
        ad.title,
        ad.description,
        ad.url,
        ad.images.join(', '),
        ad.format,
        ad.dateRange,
        new Date().toLocaleString()
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scraped Ads');
    
    return wb;
  }

  clearResults() {
    this.scrapedAds = [];
    this.resultsSection.style.display = 'none';
    this.progressSection.style.display = 'none';
    this.adsScrapedSpan.textContent = '0';
    this.progressFill.style.width = '0%';
    this.updateStatus('Ready to start scraping');
  }

  showLoadingOverlay(message) {
    this.loadingOverlay.querySelector('p').textContent = message;
    this.loadingOverlay.style.display = 'flex';
  }

  hideLoadingOverlay() {
    this.loadingOverlay.style.display = 'none';
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      z-index: 1001;
      max-width: 400px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      animation: slideInRight 0.3s ease;
    `;
    
    if (type === 'error') {
      notification.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a52 100%)';
    } else if (type === 'success') {
      notification.style.background = 'linear-gradient(135deg, #6bcf7f 0%, #4fb3d9 100%)';
    } else {
      notification.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 5000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  }
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
  
  .badge {
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }
  
  .badge-text { background: #e3f2fd; color: #1976d2; }
  .badge-display { background: #f3e5f5; color: #7b1fa2; }
  .badge-video { background: #e8f5e8; color: #388e3c; }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
  new GoogleAdsScraperUI();
});