const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        defaultViewport: { width: 1366, height: 768 },
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // ─── SEARCH PAGE ──────────────────────────────────────────────────────
    console.log('SEARCH PAGE...');
    await page.goto('https://www.flipkart.com/search?q=wireless+headphones', {
        waitUntil: 'networkidle2', timeout: 45000
    });
    await new Promise(r => setTimeout(r, 2000));

    // Close login popup if present
    const loginClose = await page.$('button._2KpZ6l._2doB4z, button[class*="close"], ._2P_LDn button');
    if (loginClose) await loginClose.click();

    const searchResult = await page.evaluate(() => {
        const r = {};
        // Count by selector
        const sels = [
            '[data-id]', 'a[href*="/p/itm"]', 'a[href*="/p/"]',
            '._4rR01T', '.s1Q9rs', '.KzDlHZ', '.WKTcLC', '.wjcEIp',
            '.Nx9bqj', '.UOCQB1', '._30jeq3',
        ];
        sels.forEach(s => r[s] = document.querySelectorAll(s).length);

        // Get first product link with /p/ pattern
        const links = Array.from(document.querySelectorAll('a[href*="/p/"]'))
            .filter(a => a.href.includes('/p/itm'))
            .slice(0, 3);
        r.links = links.map(a => ({
            href: a.href.split('?')[0],
            text: a.textContent.trim().substring(0, 80),
            classes: a.className,
        }));

        // Find parent grid item of first link
        if (links[0]) {
            const parent = links[0].closest('[data-id], ._1AtVbE, ._2kHMtA, li, article');
            if (parent) {
                r.parent_tag = parent.tagName;
                r.parent_class = parent.className.substring(0, 100);
                r.parent_data_id = parent.getAttribute('data-id');

                const img = parent.querySelector('img');
                r.img_src = img ? img.src : null;

                const price = parent.querySelector('._30jeq3, .Nx9bqj, ._1_WHN1, [class*="price"]');
                r.price = price ? price.textContent.trim() : null;
                r.price_sel = price ? price.className : null;

                const rating = parent.querySelector('._3LWZlK, [class*="rating"]');
                r.rating = rating ? rating.textContent.trim() : null;
            }
        }

        return r;
    });
    console.log('Search:', JSON.stringify(searchResult, null, 2));

    // ─── PRODUCT PAGE ──────────────────────────────────────────────────────
    const productUrl = 'https://www.flipkart.com/boAt-rockerz-450-bluetooth-on-ear-headphones/p/itmef3a3cac7c1e5';
    console.log('\nPRODUCT PAGE...');
    await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));

    const prodResult = await page.evaluate(() => {
        const r = {};
        // Title
        const titleSels = ['.B_NuCI', '.yhB1nd', '._35KyD6', 'h1', 'span[class*="title"]'];
        titleSels.forEach(s => {
            const el = document.querySelector(s);
            if (el) r['title_' + s] = el.textContent.trim().substring(0, 80);
        });

        // Price
        const priceSels = ['._30jeq3', '.Nx9bqj', '._1_WHN1', '._16Jk6d', '.UOCQB1'];
        priceSels.forEach(s => {
            const el = document.querySelector(s);
            if (el) r['price_' + s] = el.textContent.trim();
        });

        // Rating
        const ratingSels = ['._3LWZlK', '._1lRcqv', '.gUuXy- span', '._23J90q ._3LWZlK'];
        ratingSels.forEach(s => {
            const el = document.querySelector(s);
            if (el) r['rating_' + s] = el.textContent.trim();
        });

        // Spec tables
        const specSels = ['._14cfVK', '._1s_Smc', '.rzVyqX', '._2cM9lP', '._2i8Aeb', '._3k-BhJ', '._3npa3n'];
        specSels.forEach(s => {
            r['spec_count_' + s] = document.querySelectorAll(s).length;
        });

        // Try to get spec rows generically
        const tables = document.querySelectorAll('table');
        r.tables = tables.length;
        if (tables[0]) r.first_table_html = tables[0].innerHTML.substring(0, 400);

        // Also try definition lists or key-value pairs
        const rows = document.querySelectorAll('._3k-BhJ, ._2-riNZ, li._21lJbe, ._3npa3n');
        r.kv_rows = rows.length;
        if (rows[0]) r.first_kv = rows[0].innerHTML.substring(0, 200);

        return r;
    });
    console.log('Product:', JSON.stringify(prodResult, null, 2));

    // Save HTML snippet
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 8000));
    fs.writeFileSync('/tmp/flipkart_product.html', html);
    console.log('\nSaved HTML to /tmp/flipkart_product.html');

    await browser.close();
})().catch(console.error);
