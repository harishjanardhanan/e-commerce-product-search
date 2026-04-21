const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

async function createBrowser() {
  return await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  const ua = USER_AGENTS[rand(0, USER_AGENTS.length - 1)];
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  });
  // Remove webdriver flags
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });
  return page;
}

// ─── Collect product URLs from search results page ───────────────────────────

async function collectProductUrls(browser, searchUrl, limit = 100) {
  const page = await setupPage(browser);
  const productLinks = new Map(); // asin -> { url, title, price, rating, image }

  // Derive the base domain from the search URL (amazon.in / amazon.com / etc.)
  const baseUrl = new URL(searchUrl);
  const domain = baseUrl.origin;

  let currentUrl = searchUrl;
  let pageNum = 1;

  try {
    while (productLinks.size < limit) {
      console.log(`📄 Scraping search page ${pageNum}: ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(rand(2000, 3500));

      // Check for CAPTCHA
      const isCaptcha = await page.$('form[action="/errors/validateCaptcha"]');
      if (isCaptcha) {
        console.warn('⚠️ CAPTCHA detected on search page');
        break;
      }

      // Extract product cards — use data-component-type for reliable card scoping
      const products = await page.evaluate(() => {
        const results = [];

        // Primary selector: s-search-result cards (organic results only)
        const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
        cards.forEach((card) => {
          const asin = card.getAttribute('data-asin');
          if (!asin || asin === '') return;

          // Title: h2 span is consistently present
          const titleEl = card.querySelector('h2 span, .a-size-medium.a-text-normal, .a-size-base-plus');
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) return;

          // Price
          const priceEl = card.querySelector('.a-price .a-offscreen');
          const price = priceEl ? priceEl.textContent.trim() : 'N/A';

          // Rating — look for the alt text on the star icon
          const ratingEl = card.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt, [aria-label*="stars"] .a-icon-alt');
          const rating = ratingEl ? ratingEl.textContent.trim() : 'N/A';

          // Review count
          const reviewsEl = card.querySelector('.a-size-base.s-underline-text, [aria-label*="ratings"]');
          const reviews = reviewsEl ? (reviewsEl.textContent || reviewsEl.getAttribute('aria-label') || '').trim() : 'N/A';

          // Image
          const imgEl = card.querySelector('img.s-image');
          const image = imgEl ? (imgEl.getAttribute('src') || '') : '';

          results.push({ asin, title, price, rating, reviews, image });
        });
        return results;
      });

      for (const p of products) {
        if (productLinks.size >= limit) break;
        if (!productLinks.has(p.asin)) {
          // Build a clean direct product URL from the ASIN — avoids sspa redirect issues
          const productUrl = `${domain}/dp/${p.asin}`;
          productLinks.set(p.asin, {
            asin: p.asin,
            url: productUrl,
            title: p.title,
            price: p.price,
            rating: p.rating,
            reviews: p.reviews,
            image: p.image,
          });
        }
      }

      console.log(`✅ Collected ${productLinks.size} products so far (page ${pageNum})`);

      if (productLinks.size >= limit) break;

      // Find next page link
      const nextUrl = await page.evaluate(() => {
        const nextBtn = document.querySelector('.s-pagination-next:not(.s-pagination-disabled), a.s-pagination-next');
        if (nextBtn && nextBtn.tagName === 'A') return nextBtn.href;
        return null;
      });

      if (!nextUrl) {
        console.log('No more pages available');
        break;
      }

      currentUrl = nextUrl;
      pageNum++;
      await sleep(rand(2000, 4000));
    }
  } catch (err) {
    console.error('Error collecting product URLs:', err.message);
  } finally {
    await page.close();
  }

  return Array.from(productLinks.values());
}
// ─── Platform detection ─────────────────────────────────────────────────────

function detectPlatform(url) {
  if (url.includes('flipkart.com')) return 'flipkart';
  if (url.includes('amazon.')) return 'amazon';
  return null;
}


async function scrapeProduct(browser, productInfo) {
  const page = await setupPage(browser);
  try {
    await page.goto(productInfo.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(1000, 2500));

    const isCaptcha = await page.$('form[action="/errors/validateCaptcha"]');
    if (isCaptcha) {
      return { ...productInfo, error: 'CAPTCHA', specs: {} };
    }

    const details = await page.evaluate(() => {
      const data = {};

      // Title
      const titleEl = document.querySelector('#productTitle');
      if (titleEl) data.title = titleEl.textContent.trim();

      // Brand
      const brandEl = document.querySelector('#bylineInfo, .po-brand .po-break-word');
      if (brandEl) data.brand = brandEl.textContent.replace(/^(Brand:|Visit the|Store)/, '').trim();

      // Price
      const priceEl = document.querySelector('.a-price.priceToPay .a-offscreen, #corePriceDisplay_desktop_feature_div .a-price .a-offscreen');
      if (priceEl) data.price = priceEl.textContent.trim();

      // Rating
      const ratingEl = document.querySelector('#acrPopover .a-icon-alt');
      if (ratingEl) data.rating = ratingEl.textContent.trim();

      // Review count
      const reviewsEl = document.querySelector('#acrCustomerReviewText');
      if (reviewsEl) data.reviews = reviewsEl.textContent.trim();

      // Availability
      const availEl = document.querySelector('#availability span');
      if (availEl) data.availability = availEl.textContent.trim();

      // Bullet features
      const bullets = [];
      document.querySelectorAll('#feature-bullets li span.a-list-item').forEach((el) => {
        const text = el.textContent.trim();
        if (text) bullets.push(text);
      });
      data.features = bullets;

      // Technical Specifications / Product Details table
      const specs = {};

      // Method 1: tech specs table
      document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr').forEach((row) => {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (th && td) {
          const key = th.textContent.trim();
          const val = td.textContent.trim().replace(/\s+/g, ' ');
          if (key && val) specs[key] = val;
        }
      });

      // Method 2: product details table
      document.querySelectorAll('#productDetails_detailBullets_sections1 tr, #productDetails_db_sections tr').forEach((row) => {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (th && td) {
          const key = th.textContent.trim();
          const val = td.textContent.trim().replace(/\s+/g, ' ');
          if (key && val) specs[key] = val;
        }
      });

      // Method 3: detail bullets list
      document.querySelectorAll('#detailBullets_feature_div li').forEach((li) => {
        const spans = li.querySelectorAll('span');
        if (spans.length >= 2) {
          const key = spans[0].textContent.replace(/[:\u200F\u200E]/g, '').trim();
          const val = spans[1].textContent.trim();
          if (key && val) specs[key] = val;
        }
      });

      // Method 4: glance icons / tech specs widget
      document.querySelectorAll('.a-expander-content tr').forEach((row) => {
        const cols = row.querySelectorAll('td');
        if (cols.length === 2) {
          const key = cols[0].textContent.trim();
          const val = cols[1].textContent.trim();
          if (key && val) specs[key] = val;
        }
      });

      // Additional info table
      document.querySelectorAll('#tech-specs-section tr, .techD tr, #prodDetails tr').forEach((row) => {
        const th = row.querySelector('th, td:first-child');
        const td = row.querySelector('td:last-child');
        if (th && td && th !== td) {
          const key = th.textContent.trim();
          const val = td.textContent.trim().replace(/\s+/g, ' ');
          if (key && val && !specs[key]) specs[key] = val;
        }
      });

      data.specs = specs;

      // Main image
      const imgEl = document.querySelector('#imgTagWrapperId img, #landingImage');
      if (imgEl) data.image = imgEl.getAttribute('src') || imgEl.getAttribute('data-old-hires');

      return data;
    });

    return {
      asin: productInfo.asin,
      url: productInfo.url,
      title: details.title || productInfo.title,
      brand: details.brand || '',
      price: details.price || productInfo.price,
      rating: details.rating || productInfo.rating,
      reviews: details.reviews || productInfo.reviews,
      availability: details.availability || '',
      features: details.features || [],
      specs: details.specs || {},
      image: details.image || productInfo.image,
    };
  } catch (err) {
    console.error(`Error scraping ${productInfo.url}:`, err.message);
    return { ...productInfo, error: err.message, specs: {} };
  } finally {
    await page.close();
  }
}

// ─── Flipkart: collect product URLs ─────────────────────────────────────────

async function collectFlipkartUrls(browser, searchUrl, limit = 100) {
  const page = await setupPage(browser);
  const seen = new Map(); // id -> productInfo
  const baseUrl = new URL(searchUrl);
  const domain = baseUrl.origin;

  let currentUrl = searchUrl;
  let pageNum = 1;

  try {
    while (seen.size < limit) {
      console.log(`📄 [Flipkart] Search page ${pageNum}: ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(rand(2000, 3500));

      // Close login popup if present
      const loginClose = await page.$('button._2KpZ6l._2doB4z, [class*="close"] button, ._3Mkg5 button');
      if (loginClose) { try { await loginClose.click(); await sleep(500); } catch (_) { } }

      const products = await page.evaluate((domain) => {
        const results = [];
        const productLinks = new Set();

        // Find all links pointing to product pages (/p/itm...)
        document.querySelectorAll('a[href*="/p/itm"]').forEach(a => {
          const href = a.href.split('?')[0];
          if (productLinks.has(href)) return;

          // Only pick title links (they have non-empty meaningful text)
          const text = a.textContent.trim();
          if (!text || text.length < 5) return; // skip image-only links

          productLinks.add(href);

          // Walk up to find the card container
          const card = a.closest('[data-id]');
          const id = card ? card.getAttribute('data-id') : href.split('/p/')[1].split('/')[0];

          // Image: look in same card for flixcart images
          const img = card ? card.querySelector('img[src*="flixcart"], img[src*="rukminim"]') : null;
          const image = img ? img.src : '';

          // Price: any element in card containing ₹
          let price = 'N/A';
          if (card) {
            const all = card.querySelectorAll('*');
            for (const el of all) {
              if (el.children.length === 0 && el.textContent.includes('₹')) {
                const t = el.textContent.trim().replace(/\s+/g, ' ');
                if (/^₹[\d,]+/.test(t)) { price = t; break; }
              }
            }
          }

          // Rating
          let rating = 'N/A';
          if (card) {
            const all = card.querySelectorAll('*');
            for (const el of all) {
              if (el.children.length === 0) {
                const t = el.textContent.trim();
                if (/^[1-5](\.[0-9])?$/.test(t)) { rating = t; break; }
              }
            }
          }

          results.push({ id, url: href, title: text, price, rating, image, reviews: 'N/A' });
        });

        return results;
      }, domain);

      for (const p of products) {
        if (seen.size >= limit) break;
        if (!seen.has(p.id)) seen.set(p.id, p);
      }

      console.log(`✅ [Flipkart] ${seen.size} products collected (page ${pageNum})`);
      if (seen.size >= limit) break;

      // Next page
      const nextUrl = await page.evaluate(() => {
        // Flipkart pagination: link containing 'page=' in href and text 'Next'
        const links = Array.from(document.querySelectorAll('a[href*="page="]'));
        const next = links.find(a => /next/i.test(a.textContent) || a.querySelector('[class*="nxt"]'));
        if (next) return next.href;

        // Fallback: find current page number and construct next
        const pageMatch = location.search.match(/page=(\d+)/);
        const cur = pageMatch ? parseInt(pageMatch[1]) : 1;
        // Try URL with incremented page
        return null; // Let the outer loop handle
      });

      if (!nextUrl) {
        // Try building next page URL manually
        const u = new URL(currentUrl);
        const curPage = parseInt(u.searchParams.get('page') || '1');
        u.searchParams.set('page', curPage + 1);
        // Check if current page had products; if sparse, stop
        if (products.length < 5) { console.log('No more pages'); break; }
        currentUrl = u.toString();
      } else {
        currentUrl = nextUrl;
      }

      pageNum++;
      await sleep(rand(2000, 4000));
    }
  } catch (err) {
    console.error('[Flipkart] Error collecting URLs:', err.message);
  } finally {
    await page.close();
  }

  return Array.from(seen.values());
}

// ─── Flipkart: scrape individual product page ────────────────────────────────

async function scrapeFlipkartProduct(browser, productInfo) {
  const page = await setupPage(browser);
  try {
    await page.goto(productInfo.url, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(rand(1500, 3000));

    const details = await page.evaluate(() => {
      const data = {};

      // ── JSON-LD structured data (most reliable, class-independent) ──────────
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of ldScripts) {
        try {
          const json = JSON.parse(s.textContent);
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            if (item['@type'] === 'Product') {
              data.title = data.title || item.name;
              data.brand = data.brand || (item.brand && item.brand.name);
              data.image = data.image || (Array.isArray(item.image) ? item.image[0] : item.image);
              data.description = item.description;
              if (item.offers) {
                const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                data.price = data.price || (offer.price ? '₹' + offer.price : null);
                data.availability = data.availability || (offer.availability || '').split('/').pop();
              }
              if (item.aggregateRating) {
                data.rating = data.rating || String(item.aggregateRating.ratingValue);
                data.reviews = data.reviews || String(item.aggregateRating.reviewCount);
              }
            }
          }
        } catch (_) { }
      }

      // ── Title fallback ──────────────────────────────────────────────────────
      if (!data.title) {
        const el = document.querySelector('.B_NuCI, .yhB1nd, h1, [class*="title"]');
        if (el) data.title = el.textContent.trim();
      }

      // ── Price fallback (any element with ₹ and no children) ────────────────
      if (!data.price) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          if (el.children.length === 0 && el.textContent.includes('₹')) {
            const t = el.textContent.trim();
            if (/^₹[\d,]+/.test(t)) { data.price = t; break; }
          }
        }
      }

      // ── Rating fallback ─────────────────────────────────────────────────────
      if (!data.rating) {
        const el = document.querySelector('[class*="rating"] [class*="_3LWZlK"], ._3LWZlK, [class*="XQDdHH"]');
        if (el) data.rating = el.textContent.trim();
      }

      // ── Specs: try ALL tables on page ───────────────────────────────────────
      const specs = {};
      document.querySelectorAll('table').forEach(tbl => {
        tbl.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const key = cells[0].textContent.trim().replace(/\s+/g, ' ');
            const val = cells[cells.length - 1].textContent.trim().replace(/\s+/g, ' ');
            if (key && val && key !== val && key.length < 80) {
              specs[key] = val;
            }
          }
        });
      });

      // ── Specs: key-value divs/lists (Flipkart uses various structures) ──────
      // Generic: find sibling pairs where first is label-like, second is value
      document.querySelectorAll('li, [class*="specRow"], [class*="spec-"], [class*="_3k-BhJ"]').forEach(el => {
        const children = Array.from(el.children);
        if (children.length >= 2) {
          const key = children[0].textContent.trim().replace(/\s+/g, ' ');
          const val = children[children.length - 1].textContent.trim().replace(/\s+/g, ' ');
          if (key && val && key !== val && key.length < 80 && !specs[key]) {
            specs[key] = val;
          }
        }
      });

      // ── Highlights / bullet features ────────────────────────────────────────
      const features = [];
      document.querySelectorAll('[class*="highlights"] li, [class*="_21Ahn-"] li, ul li').forEach(li => {
        const text = li.textContent.trim();
        if (text && text.length > 5 && text.length < 200) features.push(text);
      });
      data.features = features.slice(0, 15);
      data.specs = specs;

      // ── Image fallback ──────────────────────────────────────────────────────
      if (!data.image) {
        const img = document.querySelector('img[src*="rukminim"], img[src*="flixcart"]');
        if (img) data.image = img.src;
      }

      return data;
    });

    return {
      asin: productInfo.id || productInfo.asin,
      url: productInfo.url,
      title: details.title || productInfo.title,
      brand: details.brand || '',
      price: details.price || productInfo.price,
      rating: details.rating || productInfo.rating,
      reviews: details.reviews || productInfo.reviews,
      availability: details.availability || '',
      features: details.features || [],
      specs: details.specs || {},
      image: details.image || productInfo.image,
    };
  } catch (err) {
    console.error(`[Flipkart] Error scraping ${productInfo.url}:`, err.message);
    return { ...productInfo, error: err.message, specs: {} };
  } finally {
    await page.close();
  }
}


const activeSessions = new Map();

// ─── SSE Streaming endpoint ──────────────────────────────────────────────────

app.get('/api/stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const session = activeSessions.get(sessionId);
  if (!session) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Session not found' })}\n\n`);
    res.end();
    return;
  }

  session.clients.push(res);

  req.on('close', () => {
    session.clients = session.clients.filter((c) => c !== res);
  });
});

function broadcast(sessionId, data) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  session.clients.forEach((c) => {
    try { c.write(payload); } catch (_) { }
  });
}

// ─── Start scan ──────────────────────────────────────────────────────────────

app.post('/api/scan', async (req, res) => {
  const { url, limit = 20 } = req.body;

  const platform = detectPlatform(url || '');
  if (!platform) {
    return res.status(400).json({ error: 'Please provide a valid Amazon or Flipkart search URL' });
  }

  const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  activeSessions.set(sessionId, { clients: [], status: 'starting' });

  res.json({ sessionId });

  (async () => {
    let browser;
    try {
      broadcast(sessionId, { type: 'status', message: 'Launching browser…' });
      browser = await createBrowser();

      broadcast(sessionId, { type: 'status', message: `Collecting product links from ${platform} search results…` });

      const products = platform === 'flipkart'
        ? await collectFlipkartUrls(browser, url, Math.min(limit, 100))
        : await collectProductUrls(browser, url, Math.min(limit, 100));

      broadcast(sessionId, {
        type: 'total',
        total: products.length,
        message: `Found ${products.length} products. Starting detailed scrape…`,
      });

      const CONCURRENCY = platform === 'flipkart' ? 2 : 3; // Flipkart is slower
      let completed = 0;

      for (let i = 0; i < products.length; i += CONCURRENCY) {
        const batch = products.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (p) => {
            const result = platform === 'flipkart'
              ? await scrapeFlipkartProduct(browser, p)
              : await scrapeProduct(browser, p);
            completed++;
            broadcast(sessionId, {
              type: 'product',
              data: result,
              progress: { completed, total: products.length },
            });
          })
        );
        if (i + CONCURRENCY < products.length) {
          await sleep(rand(1500, 2500));
        }
      }

      broadcast(sessionId, { type: 'done', message: `Scan complete! Scraped ${completed} products.` });
    } catch (err) {
      broadcast(sessionId, { type: 'error', message: err.message });
      console.error('Scan error:', err);
    } finally {
      if (browser) await browser.close();
      setTimeout(() => activeSessions.delete(sessionId), 5 * 60 * 1000);
    }
  })();
});

// ─── Start server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Product Scanner running at http://localhost:${PORT}`);
  console.log(`   Supports: Amazon (amazon.com / amazon.in) and Flipkart (flipkart.com)\n`);
});
