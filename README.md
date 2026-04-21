# 🔍 E-Commerce Product Search & Specification Scraper

A powerful web scraping tool that extracts detailed product specifications from Amazon and Flipkart search results with a beautiful real-time streaming UI.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

### 🎯 Core Functionality
- **Multi-Platform Support**: Scrapes both Amazon (amazon.com, amazon.in) and Flipkart (flipkart.com)
- **Bulk Scraping**: Extract up to 100 products from search results in one go
- **Real-Time Streaming**: Live progress updates via Server-Sent Events (SSE)
- **Comprehensive Data**: Captures title, brand, price, rating, reviews, availability, images, and full technical specifications

### 🎨 Advanced UI Features
- **Live Progress Tracking**: Real-time status updates with progress bar
- **Dynamic Table**: Auto-expanding columns as new specifications are discovered
- **Multi-Column Filtering**: Filter by any column with multiple active filters
- **Smart Search**: Global text search across all fields
- **Flexible Sorting**: Sort by any column (price, rating, reviews, specs)
- **CSV Export**: Download filtered results as CSV
- **Product Detail View**: Dedicated page for each product with full specifications
- **Responsive Design**: Modern glassmorphism UI with dark theme

### 🛡️ Anti-Detection Features
- Rotating user agents
- Random delays between requests
- Browser fingerprint masking
- Headless browser automation with Puppeteer
- CAPTCHA detection and handling

## 🚀 Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web server framework
- **Puppeteer** - Headless browser automation
- **CORS** - Cross-origin resource sharing

### Frontend
- **Vanilla JavaScript** - No framework dependencies
- **Server-Sent Events (SSE)** - Real-time streaming
- **CSS3** - Modern styling with glassmorphism effects
- **HTML5** - Semantic markup

## 📦 Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd e-commerce-product-search
```

2. **Install dependencies**
```bash
npm install
```

3. **Start the server**
```bash
npm start
```

4. **Open in browser**
```
http://localhost:3000
```

## 🎮 Usage

### Basic Workflow

1. **Enter Search URL**
   - Paste an Amazon or Flipkart search results URL
   - Example: `https://www.amazon.in/s?k=wireless+headphones`
   - Example: `https://www.flipkart.com/search?q=headphones`

2. **Set Product Limit**
   - Choose how many products to scrape (1-100)
   - Default: 20 products

3. **Start Scan**
   - Click "Start Scan" button
   - Watch real-time progress updates
   - Products appear in table as they're scraped

4. **Filter & Sort Results**
   - Use global search to filter across all columns
   - Add column-specific filters (e.g., Brand = "Sony")
   - Sort by any column (price, rating, etc.)
   - Combine multiple filters for precise results

5. **Export Data**
   - Click "Export CSV" to download results
   - Opens in Excel, Google Sheets, etc.

6. **View Details**
   - Click any row or "Open" button
   - See full product details in dedicated page
   - View all specifications in organized tables

## 🏗️ Architecture

### Server Architecture (`server.js`)

```
┌─────────────────────────────────────────────────┐
│              Express Server (Port 3000)         │
├─────────────────────────────────────────────────┤
│  Static Files (/public)                         │
│  ├─ index.html                                  │
│  ├─ product.html                                │
│  ├─ app.js                                      │
│  └─ style.css                                   │
├─────────────────────────────────────────────────┤
│  API Endpoints                                  │
│  ├─ POST /api/scan                              │
│  │   └─ Initiates scraping session              │
│  └─ GET /api/stream/:sessionId                  │
│      └─ SSE stream for real-time updates        │
├─────────────────────────────────────────────────┤
│  Scraping Engine (Puppeteer)                    │
│  ├─ collectProductUrls() - Amazon               │
│  ├─ collectFlipkartUrls() - Flipkart            │
│  ├─ scrapeProduct() - Amazon details            │
│  └─ scrapeFlipkartProduct() - Flipkart details  │
└─────────────────────────────────────────────────┘
```

### Data Flow

1. **Client** → POST `/api/scan` with search URL
2. **Server** → Returns `sessionId`
3. **Client** → Opens SSE connection to `/api/stream/:sessionId`
4. **Server** → Launches Puppeteer browser
5. **Server** → Scrapes search results (collects product URLs)
6. **Server** → Streams `total` event with product count
7. **Server** → Scrapes each product page concurrently (3 at a time)
8. **Server** → Streams `product` event for each completed scrape
9. **Client** → Updates UI in real-time
10. **Server** → Streams `done` event when complete

### Scraping Strategy

#### Amazon
- **Search Page**: Extracts product cards using `[data-component-type="s-search-result"]`
- **Product Page**: Multiple fallback selectors for robustness
  - Title: `#productTitle`
  - Price: `.a-price.priceToPay .a-offscreen`
  - Rating: `#acrPopover .a-icon-alt`
  - Specs: Multiple table selectors (`#productDetails_techSpec_section_1`, etc.)

#### Flipkart
- **Search Page**: Finds links with `/p/itm` pattern
- **Product Page**: Uses JSON-LD structured data + fallback selectors
  - Structured data: `script[type="application/ld+json"]`
  - Specs: All `<table>` elements on page
  - Dynamic key-value pair detection

## 📡 API Reference

### POST `/api/scan`

Initiates a new scraping session.

**Request Body:**
```json
{
  "url": "https://www.amazon.in/s?k=wireless+headphones",
  "limit": 20
}
```

**Response:**
```json
{
  "sessionId": "abc123xyz"
}
```

### GET `/api/stream/:sessionId`

Server-Sent Events stream for real-time updates.

**Event Types:**

1. **status** - General status message
```json
{
  "type": "status",
  "message": "Launching browser…"
}
```

2. **total** - Total products found
```json
{
  "type": "total",
  "total": 50,
  "message": "Found 50 products. Starting detailed scrape…"
}
```

3. **product** - Individual product data
```json
{
  "type": "product",
  "data": {
    "asin": "B08XYZ123",
    "url": "https://amazon.in/dp/B08XYZ123",
    "title": "Product Name",
    "brand": "Brand Name",
    "price": "₹2,999",
    "rating": "4.5",
    "reviews": "1,234 ratings",
    "availability": "In stock",
    "features": ["Feature 1", "Feature 2"],
    "specs": {
      "Color": "Black",
      "Weight": "250g"
    },
    "image": "https://..."
  },
  "progress": {
    "completed": 5,
    "total": 50
  }
}
```

4. **done** - Scraping complete
```json
{
  "type": "done",
  "message": "Scan complete! Scraped 50 products."
}
```

5. **error** - Error occurred
```json
{
  "type": "error",
  "message": "Error description"
}
```

## 🎨 UI Components

### Main Page (`index.html`)
- **Hero Section**: Search form with URL input and limit selector
- **Progress Section**: Real-time status and progress bar
- **Toolbar**: Search, filters, sort controls, export button
- **Results Table**: Dynamic table with all products and specs
- **Filter Chips**: Visual representation of active filters

### Product Detail Page (`product.html`)
- Full product information
- Organized specification tables
- Feature highlights
- Direct link to original product page

## 🔧 Configuration

### Concurrency Settings
```javascript
// In server.js
const CONCURRENCY = platform === 'flipkart' ? 2 : 3;
```
- Amazon: 3 concurrent requests
- Flipkart: 2 concurrent requests (slower site)

### Delays
```javascript
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(rand(2000, 3500)); // Random delay between pages
```

### User Agents
Rotates between 4 different user agents to avoid detection.

## 🐛 Troubleshooting

### CAPTCHA Detected
- **Symptom**: "CAPTCHA detected" in status
- **Solution**: Reduce scraping speed, increase delays, or use VPN

### No Products Found
- **Symptom**: "Found 0 products"
- **Solution**: 
  - Verify URL is a search results page
  - Check if site structure has changed
  - Try different search query

### Browser Launch Failed
- **Symptom**: "Error launching browser"
- **Solution**:
  - Install Chrome/Chromium
  - Check system resources
  - Try `npm install puppeteer --force`

### Incomplete Specifications
- **Symptom**: Some specs missing
- **Solution**: Site structure varies by product category; some products have fewer specs

## 📝 Development

### Project Structure
```
e-commerce-product-search/
├── server.js           # Main backend server
├── package.json        # Dependencies and scripts
├── diag.js            # Diagnostic/testing script
├── public/
│   ├── index.html     # Main UI
│   ├── product.html   # Product detail page
│   ├── app.js         # Frontend logic
│   └── style.css      # Styling
└── node_modules/      # Dependencies
```

### Running Diagnostics
```bash
node diag.js
```
Tests Flipkart scraping and saves HTML output to `/tmp/flipkart_product.html`.

### Development Mode
```bash
npm run dev
```
Same as `npm start` - runs server on port 3000.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Areas for Improvement
- Add more e-commerce platforms (eBay, Walmart, etc.)
- Implement proxy rotation
- Add database storage for scraped data
- Create API for programmatic access
- Add unit tests
- Implement rate limiting
- Add authentication for multi-user support

## ⚖️ Legal & Ethics

**Important**: This tool is for educational and personal use only.

- Always respect `robots.txt`
- Follow website Terms of Service
- Don't overload servers with requests
- Use responsibly and ethically
- Consider using official APIs when available

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🙏 Acknowledgments

- Built with [Puppeteer](https://pptr.dev/)
- Inspired by the need for comprehensive product comparison
- UI design influenced by modern glassmorphism trends

## 📧 Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Made with ❤️ for better product research**
