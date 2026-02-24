# 🔍 People Jobs Scraper — Setup Guide

A weekly automated scraper that finds **People & HR leadership roles with salaries shown** on Ashby and Workable, then saves them to Google Sheets and generates a LinkedIn post draft.

---

## How It Works (Plain English)

Every Monday at 8am UTC, GitHub runs your scraper automatically. It:

1. Searches Google for your target roles on Ashby & Workable
2. Visits each job page and checks if a salary is shown
3. Collects matching jobs into a spreadsheet
4. Generates a ready-to-post LinkedIn draft
5. Saves everything to your Google Sheet

**You** then review the results, tweak the LinkedIn post if needed, and hit publish. What used to take an hour+ now takes 5 minutes.

---

## 🚀 Setup (Step by Step)

### Step 1: Create a GitHub Account (skip if you have one)

1. Go to [github.com](https://github.com) and sign up (free)
2. Verify your email address

### Step 2: Create Your Repository

1. Click the **+** button (top right) → **New repository**
2. Name it: `people-jobs-scraper`
3. Set it to **Public** (so GitHub Actions is free)
4. Check ✅ "Add a README file"
5. Click **Create repository**

### Step 3: Upload the Code

1. In your new repo, click **Add file** → **Upload files**
2. Drag and drop ALL the files from this project:
   - `index.js`
   - `config.json`
   - `package.json`
   - `upload-to-sheets.js`
   - `.gitignore`
3. Click **Commit changes**

4. Now create the GitHub Actions folder:
   - Click **Add file** → **Create new file**
   - In the filename box, type: `.github/workflows/scrape.yml`
   - Copy and paste the contents of the `.github/workflows/scrape.yml` file
   - Click **Commit changes**

### Step 4: Set Up Google Sheets (optional but recommended)

This lets results auto-populate in a spreadsheet. Skip this if you just want the CSV/text output.

#### 4a: Create a Google Cloud Service Account

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (call it "Job Scraper")
3. In the left menu, go to **APIs & Services** → **Library**
4. Search for **Google Sheets API** and click **Enable**
5. Go to **APIs & Services** → **Credentials**
6. Click **+ Create Credentials** → **Service Account**
7. Name it "job-scraper-bot" → Click **Done**
8. Click on the service account you just created
9. Go to **Keys** tab → **Add Key** → **Create new key** → **JSON**
10. A JSON file will download — **keep this safe, you'll need it**

#### 4b: Create Your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it "People Jobs Tracker"
3. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
   ```
4. **Share the spreadsheet** with your service account email:
   - Click **Share**
   - Paste the service account email (looks like `job-scraper-bot@your-project.iam.gserviceaccount.com`)
   - Give it **Editor** access
   - Click **Send**

#### 4c: Add Secrets to GitHub

1. In your GitHub repo, go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add these two secrets:

| Name | Value |
|------|-------|
| `GOOGLE_SHEET_ID` | The spreadsheet ID from step 4b |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The **entire contents** of the JSON key file from step 4a |

### Step 5: Test It!

1. In your GitHub repo, go to **Actions** tab
2. Click on **Weekly Job Scraper** in the left sidebar
3. Click **Run workflow** → **Run workflow** (green button)
4. Wait 5-10 minutes for it to complete
5. Click on the run to see the logs and download the output

---

## 📝 Customising Your Searches

### Adding or Removing Roles

Edit `config.json` and update the `roles` array:

```json
{
  "roles": [
    "VP People",
    "Head of People",
    "Your New Role Title Here"
  ]
}
```

### Adding More ATS Platforms

You can add more platforms to `config.json`:

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

> ⚠️ If you add Lever or Greenhouse, the scraper will still try to extract data
> but the page structure might differ. You may need to tweak the scraper functions.

### Changing the Schedule

Edit `.github/workflows/scrape.yml` and change the cron line:

```yaml
schedule:
  - cron: '0 8 * * 1'   # Monday at 8am UTC
  - cron: '0 8 * * 4'   # Add Thursday too for twice-weekly
```

Useful cron patterns:
- `0 8 * * 1` = Every Monday at 8am UTC
- `0 8 * * 1,4` = Monday and Thursday at 8am UTC
- `0 9 * * *` = Every day at 9am UTC

---

## 🔧 Troubleshooting

### "No salary found" for most results
This is normal! Most jobs don't list salaries. The scraper is filtering for the good ones.

### Google rate limiting
If you see errors during Google searches, try:
- Increasing `SEARCH_DELAY_MS` in `index.js` (e.g., from 3000 to 5000)
- Reducing the number of roles in `config.json`

### GitHub Actions not running
- Make sure the repo is **Public** (free Actions minutes)
- Check the Actions tab is enabled in Settings → Actions → General

### Google Sheets not updating
- Verify the service account email has Editor access to your sheet
- Check the secrets are set correctly (no extra spaces)
- Look at the GitHub Actions log for error messages

---

## 💡 Future Improvements You Could Make

- **Add Lever & Greenhouse** support (add scraper functions in index.js)
- **Email notifications** using GitHub Actions + a free email service
- **Slack notifications** to get results in a Slack channel
- **Historical tracking** to spot salary trends over time
- **AI-powered post writing** by adding Claude API to polish the LinkedIn draft
- **Filter by seniority level** to separate VP from Manager roles

---

## 📁 Project Structure

```
people-jobs-scraper/
├── .github/
│   └── workflows/
│       └── scrape.yml          # Automated weekly schedule
├── index.js                     # Main scraper script
├── upload-to-sheets.js          # Google Sheets integration
├── config.json                  # Your search configuration
├── package.json                 # Node.js dependencies
├── .gitignore                   # Files to ignore in git
├── SETUP.md                     # This file!
└── output/                      # Generated each run (not in git)
    ├── jobs-YYYY-MM-DD.csv
    ├── linkedin-post-YYYY-MM-DD.txt
    └── summary-YYYY-MM-DD.json
```

---

## ❓ Need Help?

If you get stuck, copy the error message from GitHub Actions and paste it into Claude — it can usually diagnose and fix the issue quickly!
