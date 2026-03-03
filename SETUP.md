# 🔍 People Jobs Scraper — Setup Guide (v2)

Finds People & HR leadership roles with salaries on Ashby and Workable, automatically every week.

## How It Works

1. Uses **Google Programmable Search Engine** (free, 100 searches/day) to find job listings
2. Visits each job page to check for salary information
3. Outputs a LinkedIn post draft + CSV of results
4. Runs every Tuesday at 1pm GMT via GitHub Actions

---

## Setup (3 parts)

### Part 1: Google Programmable Search Engine (10 mins)

This gives you free, reliable Google searches that won't get blocked.

#### Step 1: Create the Search Engine

1. Go to [programmablesearchengine.google.com](https://programmablesearchengine.google.com)
2. Click **Get started** / **Add** to create a new search engine
3. Fill in:
   - **Name**: "Job Scraper"
   - **What to search**: Select **"Search specific sites or pages"**
   - Add these two sites:
     - `jobs.ashby.io`
     - `apply.workable.com`
4. Click **Create**
5. On the next page, copy your **Search Engine ID** (looks like `a1b2c3d4e5f6g7h8i`) — save this!

#### Step 2: Get an API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project if you don't have one (call it "Job Scraper")
3. Go to **APIs & Services** → **Library**
4. Search for **"Custom Search API"** and click **Enable**
5. Go to **APIs & Services** → **Credentials**
6. Click **+ Create Credentials** → **API Key**
7. Copy the API key — save this!

> **Cost**: Completely free for up to 100 searches per day. The scraper uses ~16 searches per run.

---

### Part 2: GitHub Repository

#### If starting fresh:

1. Go to [github.com](https://github.com) → click **+** → **New repository**
2. Name: `people-jobs-scraper`, set to **Public**, add a README
3. Upload all the project files (index.js, config.json, package.json, etc.)
4. Create `.github/workflows/scrape.yml`:
   - Click **Add file** → **Create new file**
   - Type `.github/workflows/scrape.yml` as the filename
   - Paste the contents and commit

#### If updating from v1:

Replace these files in your repo (pencil icon → select all → paste → commit):
- `index.js`
- `config.json`
- `package.json`
- `.github/workflows/scrape.yml`

You can delete `upload-to-sheets.js` (not needed yet).

---

### Part 3: Add Your API Secrets to GitHub

1. In your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add:

| Name | Value |
|------|-------|
| `GOOGLE_API_KEY` | Your API key from Step 2 above |
| `GOOGLE_CSE_ID` | Your Search Engine ID from Step 1 above |

---

## Test It!

1. Go to **Actions** tab in your repo
2. Click **Weekly Job Scraper** → **Run workflow** → **Run workflow**
3. Should complete in 2-5 minutes
4. Check the logs and download results from the **Artifacts** section

---

## Customising

### Add/remove role titles

Edit `config.json` → `roles` array. These are the job titles searched for.

### Add more ATS platforms

Edit `config.json` → `platforms` array:

```json
{
  "platforms": [
    { "name": "Ashby", "domain": "jobs.ashby.io" },
    { "name": "Workable", "domain": "apply.workable.com" },
    { "name": "Lever", "domain": "jobs.lever.co" },
    { "name": "Greenhouse", "domain": "boards.greenhouse.io" }
  ]
}
```

Then update your Google PSE to include the new domains:
1. Go to [programmablesearchengine.google.com](https://programmablesearchengine.google.com)
2. Click your search engine → **Setup**
3. Add the new domains under "Sites to search"

### Change the schedule

Edit `.github/workflows/scrape.yml`:
```yaml
cron: '0 13 * * 2'    # Tuesday 1pm GMT
cron: '0 13 * * 1,4'  # Monday AND Thursday 1pm GMT
```

---

## Troubleshooting

**"Missing environment variables"** → Check GitHub Secrets are set correctly (Settings → Secrets)

**"API error: quota exceeded"** → You've hit 100 searches/day. Wait until tomorrow or reduce role count in config.json

**0 results found** → Try broadening search terms or adding more platforms to search

**Need help?** → Copy the error from GitHub Actions logs and paste it into Claude!
