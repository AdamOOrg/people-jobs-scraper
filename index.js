/**
 * 🔍 Job Scraper for People/HR Leadership Roles
 * 
 * Uses SerpApi (free, 100 searches/month) to search Google
 * for jobs on Ashby & Workable with salary info.
 * 
 * No npm dependencies — uses Node.js built-in https.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SEARCH_DELAY_MS = 2000;
const FETCH_DELAY_MS = 1000;

if (!SERPAPI_KEY) {
  console.error('❌ Missing environment variables!');
  console.error('   Set SERPAPI_KEY');
  console.error('   Sign up free at https://serpapi.com');
  process.exit(1);
}

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

async function googleSearch(query) {
  const url = `https://serpapi.com/search.json?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(query)}&num=10&gl=uk&tbs=qdr:w`;
  const response = await httpGet(url);
  try {
    const data = JSON.parse(response.body);
    if (data.error) { console.log(`    ⚠️  API error: ${data.error}`); return []; }
    if (!data.organic_results || data.organic_results.length === 0) return [];
    return data.organic_results.map(item => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet || '',
    }));
  } catch (e) {
    console.log(`    ⚠️  Parse error: ${e.message}`);
    return [];
  }
}

const ALLOWED_TITLES = [
  'people partner',
  'people director',
  'people lead',
  'people manager',
  'people operations',
  'people ops',
  'head of people',
  'vp people',
  'vp of people',
  'vice president people',
  'chief people officer',
  'director of people',
  'head of hr',
  'hr director',
  'vp hr',
  'vp of hr',
  'vice president hr',
  'hrbp',
  'hr business partner',
  'human resources business partner',
  'chief hr officer',
  'chro',
];

function isTitleAllowed(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return ALLOWED_TITLES.some(allowed => lower.includes(allowed));
}

function buildSearchQueries() {
  const queries = [];
  const roleGroups = [
    { label: 'VP People', terms: '"VP People" OR "VP of People" OR "Vice President People"' },
    { label: 'Head of People', terms: '"Head of People"' },
    { label: 'Chief People Officer', terms: '"Chief People Officer"' },
    { label: 'People Director', terms: '"People Director" OR "Director of People"' },
    { label: 'People Lead/Manager', terms: '"People Lead" OR "People Manager"' },
    { label: 'People Partner', terms: '"People Partner"' },
    { label: 'People Operations', terms: '"People Operations Manager" OR "People Operations Lead" OR "People Ops Lead"' },
    { label: 'Head of HR', terms: '"Head of HR" OR "HR Director" OR "VP HR"' },
    { label: 'HR Business Partner', terms: '"HR Business Partner" OR "HRBP"' },
  ];
  for (const group of roleGroups) {
    for (const platform of config.platforms) {
      queries.push({
        query: `${group.terms} site:${platform.domain}`,
        label: `${group.label} on ${platform.name}`,
        platform: platform.name,
      });
    }
  }
  return queries;
}

async function scrapeJobPage(url) {
  try {
    const response = await httpGet(url);
    if (response.status !== 200) return null;
    const html = response.body;

    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/si);
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/si);

    // Use h1 as title — it's the actual job title, not the full page title
    let title = '';
    if (h1Match) title = stripHtml(h1Match[1]).trim();
    // Fall back to page title but only take the first segment before any separator
    if (!title && titleMatch) {
      title = stripHtml(titleMatch[1]).split(/\s*[–\-|]\s*/)[0].trim();
    }
    // Strip gender markers e.g. F/H, H/F, (m/f/d)
    title = title.replace(/\s*[\(\[]?[MFmf]\/[HFhf][\)\]]?\s*$/i, '').trim();

    // Company: prefer og:site_name (reliable), fall back to page title parsing
    const metaCompany = html.match(/property="og:site_name"\s+content="([^"]+)"/i);
    let company = metaCompany ? metaCompany[1] : extractCompanyFromTitle(stripHtml(titleMatch ? titleMatch[1] : ''));

    // Extract location
    let location = '';
    const locPatterns = [
      /data-testid="job-location"[^>]*>(.*?)</si,
      /data-ui="job-location"[^>]*>(.*?)</si,
      /class="[^"]*location[^"]*"[^>]*>(.*?)</si,
      /"jobLocation"[^}]*?"addressLocality"\s*:\s*"([^"]+)"/i,
      /"addressLocality"\s*:\s*"([^"]+)"/i,
      /property="og:locality"\s+content="([^"]+)"/i,
    ];
    for (const pat of locPatterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1].trim().length > 1) { location = stripHtml(m[1]).trim(); break; }
    }

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
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractCompanyFromTitle(pageTitle) {
  if (!pageTitle) return '';
  const atMatch = pageTitle.match(/at\s+(.+?)(?:\s*[-|]|$)/i);
  if (atMatch) return cleanCompany(atMatch[1].trim());
  const dashParts = pageTitle.split(' - ');
  if (dashParts.length >= 2) return cleanCompany(dashParts[dashParts.length - 1].trim());
  return '';
}

function cleanCompany(name) {
  return name
    .replace(/\s*[@|]\s*(Jobs|Careers|Job Board|Apply|Hiring)\s*$/i, '')
    .replace(/\s+(Jobs|Careers|Job Board)$/i, '')
    .trim();
}

function extractSalary(text) {
  if (!text) return null;
  const patterns = [
    /[\$£€]\s?[\d,]+[kK]?\s*[-–to]+\s*[\$£€]?\s?[\d,]+[kK]?(?:\s*(?:per\s+(?:year|annum)|p\.?a\.?|annually|\/yr|\/year))?/gi,
    /[\$£€]\s?[\d,]+[kK]?\+?(?:\s*(?:per\s+(?:year|annum)|p\.?a\.?|annually|\/yr|\/year))/gi,
    /(?:salary|compensation|pay)[:\s]+[\$£€]\s?[\d,]+[kK]?/gi,
    /[\d,]+[kK]?\s*[-–to]+\s*[\d,]+[kK]?\s*(?:GBP|USD|EUR|AUD|CAD|NZD)/gi,
    /(?:OTE|on[- ]target[- ]earnings?)[:\s]*[\$£€]\s?[\d,]+[kK]?/gi,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
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

function formatLinkedInPost(jobs, weekDate) {
  const divider = '───────────';
  let post = `💼 ${jobs.length} new People & HR jobs (WITH SALARIES 🤘) that I've seen across UK, Europe & US this week 👇\n`;
  jobs.forEach((job) => {
    post += `${divider}\n`;
    const company = job.company ? ` @ ${job.company}` : '';
    post += `${job.title}${company}\n`;
    post += `💰 ${job.salary}\n`;
    if (job.location && job.location !== 'Not specified') post += `📍 ${job.location}\n`;
    post += `🔗 ${job.url}\n`;
  });
  post += `${divider}\n`;
  post += `Good luck folks! Please share around if you know someone looking! 🖤`;
  return post;
}

function formatLinkedInHTML(jobs, jobsWithoutSalary, weekDate) {
  const postText = formatLinkedInPost(jobs, weekDate);

  const rows = jobs.map(job => `
    <div class="job">
      <div class="job-title">${job.title}${job.company ? ` &mdash; ${job.company}` : ''}</div>
      <div class="meta">
        <span class="salary">💰 ${job.salary}</span>
        ${job.location && job.location !== 'Not specified' ? `<span class="location">📍 ${job.location}</span>` : ''}
      </div>
      <a class="link" href="${job.url}" target="_blank">${job.url}</a>
    </div>
  `).join('');

  const noSalaryRows = jobsWithoutSalary.map(job => `
    <div class="job no-salary">
      <div class="job-title">${job.title}${job.company ? ` &mdash; ${job.company}` : ''}</div>
      <div class="meta">
        <span class="platform">📋 ${job.platform}</span>
        ${job.location && job.location !== 'Not specified' ? `<span class="location">📍 ${job.location}</span>` : ''}
      </div>
      <a class="link" href="${job.url}" target="_blank">${job.url}</a>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>People and HR Jobs ${weekDate}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; background: #f9f9f9; }
    h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 32px; }
    .job { background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; }
    .job.no-salary { background: #fafafa; border-color: #eee; opacity: 0.85; }
    .job-title { font-weight: 600; font-size: 1rem; margin-bottom: 6px; }
    .meta { display: flex; gap: 16px; font-size: 0.9rem; margin-bottom: 8px; flex-wrap: wrap; }
    .salary { color: #1a7f37; font-weight: 500; }
    .platform { color: #888; font-size: 0.8rem; }
    .location { color: #555; }
    .link { font-size: 0.8rem; color: #0073b1; word-break: break-all; }
    .copy-btn { display: inline-block; margin-bottom: 24px; padding: 10px 20px; background: #0073b1; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
    .copy-btn:hover { background: #005f8e; }
    textarea { width: 100%; height: 400px; font-family: inherit; font-size: 0.85rem; padding: 12px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 12px; resize: vertical; box-sizing: border-box; }
    .section-label { font-weight: 600; margin: 32px 0 12px; font-size: 0.85rem; color: #444; text-transform: uppercase; letter-spacing: 0.05em; }
    .section-note { font-size: 0.8rem; color: #888; margin-top: -8px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>People &amp; HR Leadership Roles with Salaries</h1>
  <div class="subtitle">Week of ${weekDate} &nbsp;&middot;&nbsp; ${jobs.length} with salary &nbsp;&middot;&nbsp; ${jobsWithoutSalary.length} without</div>

  <div class="section-label">LinkedIn Post</div>
  <textarea id="post-text">${postText}</textarea>
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('post-text').value).then(function(){ this.textContent = 'Copied!'; }.bind(this))">Copy to clipboard</button>

  <div class="section-label">Roles with salary ✅</div>
  ${rows}

  <div class="section-label">Also found — no salary listed 👀</div>
  <div class="section-note">Check these manually — salary may be hidden in JS (especially Ashby)</div>
  ${noSalaryRows}
</body>
</html>`;
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

async function main() {
  console.log('🚀 Starting job scraper...\n');
  console.log('🔑 Using SerpApi\n');

  const weekDate = new Date().toISOString().split('T')[0];
  const queries = buildSearchQueries();
  console.log(`📋 Built ${queries.length} search queries\n`);
  console.log('🔎 Step 1: Searching for job listings...\n');

  const allResults = [];
  let queryCount = 0;

  for (const searchQuery of queries) {
    console.log(`  ${searchQuery.label}...`);
    queryCount++;
    const results = await googleSearch(searchQuery.query);
    results.forEach(r => allResults.push({ ...r, platform: searchQuery.platform }));
    console.log(`    → Found ${results.length} results`);
    await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY_MS));
  }

  console.log(`\n📊 API queries used: ${queryCount}`);
  console.log(`📊 Total results: ${allResults.length}`);

  const seenUrls = new Set();
  const uniqueResults = allResults.filter(r => {
    const clean = r.url.split('?')[0].toLowerCase();
    if (seenUrls.has(clean)) return false;
    seenUrls.add(clean);
    return true;
  });

  console.log(`📊 Unique URLs to check: ${uniqueResults.length}\n`);
  console.log('📄 Step 2: Checking job pages for salary info...\n');

  const allJobs = [];

  for (const result of uniqueResults) {
    console.log(`  Checking: ${result.url.substring(0, 80)}...`);

    try {
      let salary = extractSalary(result.snippet);
      let jobData = null;

      if (!salary) {
        jobData = await scrapeJobPage(result.url);
        if (jobData && jobData.bodyText) {
          salary = extractSalary(jobData.bodyText);
        }
      }

      const rawTitle = (jobData && jobData.title) || result.title || '';
      const title = rawTitle.split(/\s*[–\-|]\s*/)[0].trim();
      const company = (jobData && jobData.company) || extractCompanyFromTitle(result.title) || '';
      const location = (jobData && jobData.location) || '';

      if (!isTitleAllowed(title)) {
        console.log(`    🚫 Filtered out (title not relevant): ${title}`);
      } else {
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
      }
    } catch (err) {
      console.log(`    ⚠️  Skipped (${err.message})`);
    }

    await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS));
  }

  const jobsWithSalary = allJobs.filter(j => j.salary);
  const jobsWithoutSalary = allJobs.filter(j => !j.salary);

  console.log(`\n✨ Results:`);
  console.log(`   ${jobsWithSalary.length} jobs WITH salary`);
  console.log(`   ${jobsWithoutSalary.length} jobs without salary`);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (allJobs.length > 0) {
    fs.writeFileSync(path.join(outputDir, `all-jobs-${weekDate}.csv`), generateCSV(allJobs, weekDate));
    console.log(`\n📁 All jobs CSV saved`);
  }

  if (jobsWithSalary.length > 0) {
    fs.writeFileSync(path.join(outputDir, `salary-jobs-${weekDate}.csv`), generateCSV(jobsWithSalary, weekDate));
    console.log(`📁 Salary jobs CSV saved`);

    const post = formatLinkedInPost(jobsWithSalary, weekDate);
    fs.writeFileSync(path.join(outputDir, `linkedin-post-${weekDate}.txt`), post);

    const html = formatLinkedInHTML(jobsWithSalary, jobsWithoutSalary, weekDate);
    fs.writeFileSync(path.join(outputDir, `linkedin-post-${weekDate}.html`), html);

    console.log('\n' + '='.repeat(60));
    console.log('📣 LINKEDIN POST DRAFT:');
    console.log('='.repeat(60) + '\n');
    console.log(post);
  } else if (allJobs.length > 0) {
    console.log('\n⚠️  No salary jobs found. Check all-jobs CSV.');
    let post = `People & HR leadership roles this week (w/c ${weekDate})\n\n`;
    allJobs.slice(0, 15).forEach((job) => {
      post += `${job.title}${job.company ? ` — ${job.company}` : ''}\n🔗 ${job.url}\n\n`;
    });
    fs.writeFileSync(path.join(outputDir, `linkedin-post-${weekDate}.txt`), post);
  } else {
    console.log('\n⚠️  No matching jobs found this week.');
  }

  fs.writeFileSync(path.join(outputDir, `summary-${weekDate}.json`), JSON.stringify({
    date: weekDate,
    stats: { queriesUsed: queryCount, totalResults: allResults.length, uniqueUrls: uniqueResults.length, withSalary: jobsWithSalary.length, withoutSalary: jobsWithoutSalary.length },
    jobsWithSalary,
    allJobs,
  }, null, 2));
  console.log(`📊 Summary saved`);
}

main().catch(console.error);
