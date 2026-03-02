/**
 * 🔍 Job Scraper for People/HR Leadership Roles
 * 
 * Searches Ashby & Workable ATS platforms for roles with salaries shown.
 * Outputs results to CSV (for Google Sheets) and a LinkedIn post draft.
 * 
 * Runs weekly via GitHub Actions.
 */

const puppeteer = require('puppeteer-core');

// ============================================================
// BROWSER LAUNCH HELPER
// ============================================================

function findChromePath() {
  const fs = require('fs');
  const paths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  
  throw new Error('Chrome not found! Install Google Chrome or set CHROME_PATH environment variable.');
}

const CHROME_PATH = process.env.CHROME_PATH || findChromePath();
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

// ============================================================
// CONFIGURATION
// ============================================================

const SEARCH_DELAY_MS = 3000;
const PAGE_LOAD_TIMEOUT = 15000;
const MAX_RESULTS_PER_QUERY = 20;

// ============================================================
// SEARCH QUERIES BUILDER
// ============================================================

function buildSearchQueries() {
  const queries = [];

  for (const role of config.roles) {
    for (const platform of config.platforms) {
      const siteFilter = `site:${platform.domain}`;
      const salaryTerms = config.salaryIndicators.join(' OR ');
      queries.push({
        query: `"${role}" (${salaryTerms}) ${siteFilter}`,
        role: role,
        platform: platform.name,
      });
    }
  }

  return queries;
}

// ============================================================
// GOOGLE SEARCH VIA PUPPETEER
// ============================================================

async function searchGoogle(browser, query) {
  const page = await browser.newPage();
  
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const results = [];

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${MAX_RESULTS_PER_QUERY}`;
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT });

    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll('div#search a[href]');
      const urls = [];
      anchors.forEach(a => {
        const href = a.href;
        if (href && !href.includes('google.com') && !href.includes('webcache')) {
          urls.push(href);
        }
      });
      return [...new Set(urls)];
    });

    results.push(...links);
  } catch (error) {
    console.log(`⚠️  Search failed for query: ${query.substring(0, 60)}... - ${error.message}`);
  } finally {
    await page.close();
  }

  return results;
}

// ============================================================
// ATS PAGE SCRAPERS
// ============================================================

async function scrapeAshbyJob(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT });
    await page.waitForSelector('body', { timeout: 5000 });
    
    const jobData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : '';
      };

      const title = getText('h1') || getText('[data-testid="job-title"]') || '';
      const bodyText = document.body.innerText || '';
      
      const company = getText('[data-testid="company-name"]') 
        || getText('.ashby-job-posting-company-name')
        || (document.title ? document.title.split(' - ').pop()?.split(' at ').pop()?.trim() : '')
        || '';

      const location = getText('[data-testid="job-location"]')
        || getText('.ashby-job-posting-location')
        || '';

      return { title, company, location, bodyText };
    });

    return jobData;
  } catch (error) {
    console.log(`⚠️  Failed to scrape Ashby page: ${url} - ${error.message}`);
    return null;
  }
}

async function scrapeWorkableJob(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT });
    await page.waitForSelector('body', { timeout: 5000 });

    const jobData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : '';
      };

      const title = getText('h1') || getText('[data-ui="job-title"]') || '';
      const bodyText = document.body.innerText || '';
      
      const company = getText('[data-ui="company-name"]')
        || getText('.company-name')
        || (document.title ? document.title.split(' - ').pop()?.split(' at ').pop()?.trim() : '')
        || '';

      const location = getText('[data-ui="job-location"]')
        || getText('.location')
        || '';

      return { title, company, location, bodyText };
    });

    return jobData;
  } catch (error) {
    console.log(`⚠️  Failed to scrape Workable page: ${url} - ${error.message}`);
    return null;
  }
}

async function scrapeJobPage(page, url) {
  if (url.includes('ashby.io') || url.includes('ashbyhq.com')) {
    return await scrapeAshbyJob(page, url);
  } else if (url.includes('workable.com') || url.includes('apply.workable')) {
    return await scrapeWorkableJob(page, url);
  }
  return null;
}

// ============================================================
// SALARY EXTRACTION
// ============================================================

function extractSalary(text) {
  if (!text) return null;

  const patterns = [
    /[\$£€]\s?[\d,]+[kK]?\s*[-–to]+\s*[\$£€]?\s?[\d,]+[kK]?(?:\s*(?:per\s+(?:year|annum)|p\.?a\.?|annually|\/yr|\/year))?/gi,
    /[\$£€]\s?[\d,]+[kK]?\+?(?:\s*(?:per\s+(?:year|annum)|p\.?a\.?|annually|\/yr|\/year))/gi,
    /(?:salary|compensation|pay|comp)[:\s]+[\$£€]\s?[\d,]+[kK]?/gi,
    /[\d,]+[kK]?\s*[-–to]+\s*[\d,]+[kK]?\s*(?:GBP|USD|EUR|AUD|CAD|NZD)/gi,
    /(?:OTE|on[- ]target[- ]earnings?)[:\s]*[\$£€]\s?[\d,]+[kK]?/gi,
    /(?:base)[:\s]*[\$£€]\s?[\d,]+[kK]?/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0].trim();
    }
  }

  return null;
}

// ============================================================
// LINKEDIN POST FORMATTER
// ============================================================

function formatLinkedInPost(jobs, weekDate) {
  let post = `🔍 This week's People & HR leadership roles with salaries (w/c ${weekDate})\n\n`;
  post += `Found ${jobs.length} role${jobs.length === 1 ? '' : 's'} with transparent pay:\n\n`;

  jobs.forEach((job, index) => {
    post += `${index + 1}. ${job.title}`;
    if (job.company) post += ` — ${job.company}`;
    post += `\n`;
    post += `   💰 ${job.salary}\n`;
    if (job.location) post += `   📍 ${job.location}\n`;
    post += `   🔗 ${job.url}\n\n`;
  });

  post += `---\n`;
  post += `♻️ Repost to help someone in your network find their next role.\n`;
  post += `💬 Know of other roles with salaries shown? Drop them in the comments!\n\n`;
  post += `#SalaryTransparency #PeopleLeadership #HRJobs #Hiring`;

  return post;
}

// ============================================================
// CSV OUTPUT
// ============================================================

function generateCSV(jobs, weekDate) {
  const headers = ['Date Found', 'Title', 'Company', 'Salary', 'Location', 'Platform', 'URL'];
  const rows = jobs.map(job => [
    weekDate,
    `"${(job.title || '').replace(/"/g, '""')}"`,
    `"${(job.company || '').replace(/"/g, '""')}"`,
    `"${(job.salary || '').replace(/"/g, '""')}"`,
    `"${(job.location || '').replace(/"/g, '""')}"`,
    `"${(job.platform || '').replace(/"/g, '""')}"`,
    job.url,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ============================================================
// DEDUPLICATION
// ============================================================

function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const cleanUrl = job.url.split('?')[0].toLowerCase();
    if (seen.has(cleanUrl)) return false;
    seen.add(cleanUrl);
    return true;
  });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🚀 Starting job scraper...\n');
  
  const weekDate = new Date().toISOString().split('T')[0];
  const queries = buildSearchQueries();
  
  console.log(`📋 Built ${queries.length} search queries across ${config.platforms.length} platforms\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const allJobUrls = [];

  console.log('🔎 Step 1: Searching Google for job listings...\n');
  
  for (const searchQuery of queries) {
    console.log(`  Searching: "${searchQuery.role}" on ${searchQuery.platform}...`);
    
    const urls = await searchGoogle(browser, searchQuery.query);
    
    urls.forEach(url => {
      allJobUrls.push({
        url,
        searchRole: searchQuery.role,
        platform: searchQuery.platform,
      });
    });

    console.log(`  → Found ${urls.length} links`);
    
    await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY_MS));
  }

  console.log(`\n📊 Total URLs collected: ${allJobUrls.length}`);

  const uniqueUrls = [];
  const seenUrls = new Set();
  for (const item of allJobUrls) {
    const clean = item.url.split('?')[0].toLowerCase();
    if (!seenUrls.has(clean)) {
      seenUrls.add(clean);
      uniqueUrls.push(item);
    }
  }

  console.log(`📊 Unique URLs to scrape: ${uniqueUrls.length}\n`);

  console.log('📄 Step 2: Scraping job pages...\n');
  
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const allJobs = [];

  for (const item of uniqueUrls) {
    console.log(`  Scraping: ${item.url.substring(0, 80)}...`);
    
    const jobData = await scrapeJobPage(page, item.url);
    
    if (jobData && jobData.bodyText) {
      const salary = extractSalary(jobData.bodyText);
      
      if (salary) {
        allJobs.push({
          title: jobData.title || item.searchRole,
          company: jobData.company || 'Unknown',
          salary: salary,
          location: jobData.location || 'Not specified',
          platform: item.platform,
          url: item.url,
        });
        console.log(`  ✅ Found salary: ${salary}`);
      } else {
        console.log(`  ❌ No salary found`);
      }
    } else {
      console.log(`  ❌ Could not extract page data`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await page.close();
  await browser.close();

  const finalJobs = deduplicateJobs(allJobs);
  
  console.log(`\n✨ Final results: ${finalJobs.length} jobs with salaries\n`);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const csv = generateCSV(finalJobs, weekDate);
  const csvPath = path.join(outputDir, `jobs-${weekDate}.csv`);
  fs.writeFileSync(csvPath, csv);
  console.log(`📁 CSV saved: ${csvPath}`);

  const linkedInPost = formatLinkedInPost(finalJobs, weekDate);
  const postPath = path.join(outputDir, `linkedin-post-${weekDate}.txt`);
  fs.writeFileSync(postPath, linkedInPost);
  console.log(`📝 LinkedIn post draft saved: ${postPath}`);

  console.log('\n' + '='.repeat(60));
  console.log('📣 LINKEDIN POST DRAFT:');
  console.log('='.repeat(60) + '\n');
  console.log(linkedInPost);

  const summaryPath = path.join(outputDir, `summary-${weekDate}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify({ date: weekDate, jobs: finalJobs }, null, 2));
  console.log(`\n📊 Summary JSON saved: ${summaryPath}`);

  return finalJobs;
}

main().catch(console.error);
