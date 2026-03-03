/**
 * 🔍 Job Scraper for People/HR Leadership Roles
 * 
 * Uses Google Programmable Search Engine (free, 100 queries/day)
 * to find jobs on Ashby & Workable with salary info.
 * 
 * No npm dependencies — uses Node.js built-in https.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

// ============================================================
// CONFIG FROM ENVIRONMENT
// ============================================================

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;
const SEARCH_DELAY_MS = 2000;
const FETCH_DELAY_MS = 1000;

if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
  console.error('❌ Missing environment variables!');
  console.error('   Set GOOGLE_API_KEY and GOOGLE_CSE_ID');
  console.error('   See SETUP.md for instructions.');
  process.exit(1);
}

// ============================================================
// HTTPS HELPERS (zero dependencies)
// ============================================================

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/json',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// ============================================================
// GOOGLE PROGRAMMABLE SEARCH
// ============================================================

async function googleSearch(query, start = 1) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&start=${start}&num=10`;
  
  const response = await httpGet(url);
  
  try {
    const data = JSON.parse(response.body);
    
    if (data.error) {
      console.log(`    ⚠️  API error: ${data.error.message}`);
      return [];
    }
    
    if (!data.items || data.items.length === 0) {
      return [];
    }
    
    return data.items.map(item => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet || '',
    }));
  } catch (e) {
    console.log(`    ⚠️  Parse error: ${e.message}`);
    return [];
  }
}

// ============================================================
// BUILD SEARCH QUERIES
// ============================================================

function buildSearchQueries() {
  const queries = [];

  // Group similar roles to reduce query count
  const roleGroups = [
    { label: 'VP People', terms: '"VP People" OR "VP of People" OR "Vice President People"' },
    { label: 'Head of People', terms: '"Head of People"' },
    { label: 'Chief People Officer', terms: '"Chief People Officer" OR "CPO"' },
    { label: 'People Director', terms: '"People Director" OR "Director of People"' },
    { label: 'People Lead/Manager', terms: '"People Lead" OR "People Manager"' },
    { label: 'People Partner', terms: '"People Partner"' },
    { label: 'People Operations', terms: '"People Operations" OR "People Ops"' },
    { label: 'Head of HR', terms: '"Head of HR" OR "HR Director" OR "VP HR"' },
  ];

  for (const group of roleGroups) {
    for (const platform of config.platforms) {
      // Search with salary indicators
      queries.push({
        query: `${group.terms} site:${platform.domain}`,
        label: `${group.label} on ${platform.name}`,
        platform: platform.name,
      });
    }
  }

  return queries;
}

// ============================================================
// SCRAPE INDIVIDUAL JOB PAGES
// ============================================================

async function scrapeJobPage(url) {
  try {
    const response = await httpGet(url);
    if (response.status !== 200) return null;

    const html = response.body;

    // Extract title from <h1> or <title>
    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/si);
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/si);
    
    let title = '';
    if (h1Match) title = stripHtml(h1Match[1]).trim();
    if (!title && titleMatch) title = stripHtml(titleMatch[1]).split(' - ')[0].trim();

    // Extract company from title tag or meta
    let company = '';
    if (titleMatch) {
      company = extractCompanyFromTitle(stripHtml(titleMatch[1]));
    }
    const metaCompany = html.match(/property="og:site_name"\s+content="([^"]+)"/i);
    if (!company && metaCompany) company = metaCompany[1];

    // Extract location
    let location = '';
    const locPatterns = [
      /data-testid="job-location"[^>]*>(.*?)</si,
      /class="[^"]*location[^"]*"[^>]*>(.*?)</si,
      /data-ui="job-location"[^>]*>(.*?)</si,
    ];
    for (const pat of locPatterns) {
      const m = html.match(pat);
      if (m) { location = stripHtml(m[1]).trim(); break; }
    }

    // Get full text for salary extraction (strip HTML tags)
    const bodyText = stripHtml(html);

    return { title, company, location, bodyText };
  } catch (error) {
    console.log(`    ⚠️  Failed to fetch: ${url.substring(0, 60)}... - ${error.message}`);
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCompanyFromTitle(pageTitle) {
  if (!pageTitle) return '';
  const atMatch = pageTitle.match(/at\s+(.+?)(?:\s*[-|]|$)/i);
  if (atMatch) return atMatch[1].trim();
  const dashParts = pageTitle.split(' - ');
  if (dashParts.length >= 2) return dashParts[dashParts.length - 1].trim();
  return '';
}

// ============================================================
// SALARY EXTRACTION
// ============================================================

function extractSalary(text) {
  if (!text) return null;

  const patterns = [
    // $120,000 - $150,000 or £80k - £100k
    /[\$£€]\s?[\d,]+[kK]?\s*[-–to]+\s*[\$£€]?\s?[\d,]+[kK]?(?:\s*(?:per\s+(?:year|annum)|p\.?a\.?|annually|\/yr|\/year))?/gi,
    // $120,000 per annum
    /[\$£€]\s?[\d,]+[kK]?\+?(?:\s*(?:per\s+(?:year|annum)|p\.?a\.?|annually|\/yr|\/year))/gi,
    // Salary: $120,000
    /(?:salary|compensation|pay)[:\s]+[\$£€]\s?[\d,]+[kK]?/gi,
    // 120,000 - 150,000 GBP/USD
    /[\d,]+[kK]?\s*[-–to]+\s*[\d,]+[kK]?\s*(?:GBP|USD|EUR|AUD|CAD|NZD)/gi,
    // OTE: $200,000
    /(?:OTE|on[- ]target[- ]earnings?)[:\s]*[\$£€]\s?[\d,]+[kK]?/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Filter out tiny amounts (likely not salaries)
      const match = matches[0].trim();
      const numbers = match.match(/[\d,]+/g);
      if (numbers) {
        const firstNum = parseInt(numbers[0].replace(/,/g, ''));
        if (firstNum < 20 && !match.toLowerCase().includes('k')) continue;
      }
      return match;
    }
  }

  return null;
}

// ============================================================
// OUTPUT FORMATTERS
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
// MAIN
// ============================================================

async function main() {
  console.log('🚀 Starting job scraper...\n');
  console.log('🔑 Using Google Programmable Search Engine API\n');
  
  const weekDate = new Date().toISOString().split('T')[0];
  const queries = buildSearchQueries();
  
  console.log(`📋 Built ${queries.length} search queries\n`);

  // Step 1: Search for job URLs
  console.log('🔎 Step 1: Searching for job listings...\n');
  
  const allResults = [];
  let queryCount = 0;

  for (const searchQuery of queries) {
    console.log(`  ${searchQuery.label}...`);
    queryCount++;
    
    const results = await googleSearch(searchQuery.query);
    
    results.forEach(r => {
      allResults.push({
        ...r,
        platform: searchQuery.platform,
      });
    });

    console.log(`    → Found ${results.length} results`);
    
    await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY_MS));
  }

  console.log(`\n📊 API queries used: ${queryCount}/100 daily limit`);
  console.log(`📊 Total results: ${allResults.length}`);

  // Deduplicate by URL
  const seenUrls = new Set();
  const uniqueResults = allResults.filter(r => {
    const clean = r.url.split('?')[0].toLowerCase();
    if (seenUrls.has(clean)) return false;
    seenUrls.add(clean);
    return true;
  });

  console.log(`📊 Unique URLs to check: ${uniqueResults.length}\n`);

  // Step 2: Visit each page and extract salary info
  console.log('📄 Step 2: Checking job pages for salary info...\n');
  
  const allJobs = [];

  for (const result of uniqueResults) {
    console.log(`  Checking: ${result.url.substring(0, 80)}...`);
    
    // First check if salary info is in the Google snippet
    let salary = extractSalary(result.snippet);
    let jobData = null;
    
    if (!salary) {
      // Need to fetch the full page
      jobData = await scrapeJobPage(result.url);
      
      if (jobData && jobData.bodyText) {
        salary = extractSalary(jobData.bodyText);
      }
    }

    const title = (jobData && jobData.title) || result.title.split(' - ')[0].trim() || '';
    const company = (jobData && jobData.company) || extractCompanyFromTitle(result.title) || '';
    const location = (jobData && jobData.location) || '';

    allJobs.push({
      title,
      company,
      salary: salary || null,
      location: location || 'Not specified',
      platform: result.platform,
      url: result.url,
    });

    if (salary) {
      console.log(`    ✅ Salary found: ${salary}`);
    } else {
      console.log(`    ❌ No salary listed`);
    }

    await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS));
  }

  // Split into salary / no-salary
  const jobsWithSalary = allJobs.filter(j => j.salary);
  const jobsWithoutSalary = allJobs.filter(j => !j.salary);

  console.log(`\n✨ Results:`);
  console.log(`   ${jobsWithSalary.length} jobs WITH salary`);
  console.log(`   ${jobsWithoutSalary.length} jobs without salary`);

  // Create output directory
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save CSVs
  if (allJobs.length > 0) {
    const allCsv = generateCSV(allJobs, weekDate);
    fs.writeFileSync(path.join(outputDir, `all-jobs-${weekDate}.csv`), allCsv);
    console.log(`\n📁 All jobs CSV saved`);
  }

  if (jobsWithSalary.length > 0) {
    const salaryCsv = generateCSV(jobsWithSalary, weekDate);
    fs.writeFileSync(path.join(outputDir, `salary-jobs-${weekDate}.csv`), salaryCsv);
    console.log(`📁 Salary jobs CSV saved`);
  }

  // Save LinkedIn post
  if (jobsWithSalary.length > 0) {
    const post = formatLinkedInPost(jobsWithSalary, weekDate);
    fs.writeFileSync(path.join(outputDir, `linkedin-post-${weekDate}.txt`), post);
    
    console.log('\n' + '='.repeat(60));
    console.log('📣 LINKEDIN POST DRAFT:');
    console.log('='.repeat(60) + '\n');
    console.log(post);
  } else if (allJobs.length > 0) {
    console.log('\n⚠️  No salary jobs found, but found roles without salary.');
    console.log('    Check all-jobs CSV for the full list.');
    
    let post = `🔍 People & HR leadership roles this week (w/c ${weekDate})\n\n`;
    post += `Found ${allJobs.length} role${allJobs.length === 1 ? '' : 's'} (salaries not always listed):\n\n`;
    allJobs.slice(0, 15).forEach((job, i) => {
      post += `${i + 1}. ${job.title}`;
      if (job.company) post += ` — ${job.company}`;
      post += `\n   🔗 ${job.url}\n\n`;
    });
    fs.writeFileSync(path.join(outputDir, `linkedin-post-${weekDate}.txt`), post);
  } else {
    console.log('\n⚠️  No matching jobs found this week.');
  }

  // Save summary
  fs.writeFileSync(path.join(outputDir, `summary-${weekDate}.json`), JSON.stringify({
    date: weekDate,
    stats: {
      queriesUsed: queryCount,
      totalResults: allResults.length,
      uniqueUrls: uniqueResults.length,
      withSalary: jobsWithSalary.length,
      withoutSalary: jobsWithoutSalary.length,
    },
    jobsWithSalary,
    allJobs,
  }, null, 2));
  console.log(`📊 Summary saved`);

  return jobsWithSalary;
}

main().catch(console.error);
