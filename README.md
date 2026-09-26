# IPO Radar

Your own website that rebuilds itself every morning at 8:50 AM IST with a report on
Indian IPOs: grey market premium (GMP), subscription, key financials, and an
**Apply / Listing gains only / Wait / Avoid** call for each open and upcoming issue.

It runs free on GitHub: a GitHub Action collects the numbers from several IPO
websites, scores each IPO with a fixed checklist, and publishes the page to
GitHub Pages. No API keys, no server.

## Set it up (about 10 minutes, once)

1. **Create a public repository** on github.com called `ipo-radar`.
   (Free GitHub Pages only works on public repositories. The data is public anyway.)
2. **Upload everything in this folder.** On a Mac, press Cmd + Shift + . in Finder
   first so the hidden `.github` folder shows, then drag all the contents in.
   If the Actions tab stays empty afterwards, use Add file › Create new file,
   name it `.github/workflows/daily.yml`, and paste in that file's contents.
3. **Turn on Pages:** Settings › Pages › under "Build and deployment", set
   Source to **GitHub Actions**.
4. **Let the robot save data:** Settings › Actions › General › Workflow
   permissions › **Read and write permissions** › Save.
5. **Run it once:** Actions tab › "Daily IPO report" › **Run workflow**.
   After about a minute your site is live at
   `https://YOUR-USERNAME.github.io/ipo-radar/`. Bookmark it or add it to your
   phone's home screen.

From then on it updates itself every day. You can press **Run workflow** any
time for a fresh update (for example, in the afternoon of an IPO's last day).

## How the call is made

| Signal | Points |
|---|---|
| GMP 30%+ / 15–30% / 5–15% / below 0 | +3 / +2 / +1 / −2 |
| Institutions (QIB) 10x+ / 2x+ | +2 / +1 |
| Total subscription 20x+ / 5x+ / under 1x on last day | +2 / +1 / −1 |
| Revenue and profit growing / shrinking | +1 / −1 |
| P/E 25 or less / above 40 | +1 / −1 |
| Loss-making | −2 |
| Mostly offer-for-sale, or heavy debt | −1 each |

5+ = Apply · 3–4 = Listing gains only · 1–2 = Wait · 0 or less = Avoid.
SME IPOs need GMP ≥ 20% and 50x subscription before they can be more than "Wait".

## Adding financials for new IPOs (optional)

GMP, subscription and dates are collected automatically. Company financials
are not (no reliable free source), so new IPOs are scored on GMP and demand
only until you add them. To add one, open `data/fundamentals.json` on GitHub,
click the pencil, copy an existing entry and change the numbers.

## Things to know

- **GMP is unofficial.** It's an informal grey-market quote, it differs between
  sites, and it can change fast. The site shows the middle value and the range.
- **The data comes from IPO websites** (IPO Ji, IPO Watch, Investorgain,
  IPO Central, Chittorgarh, IPO Premium). If one changes its layout or blocks
  the robot, the others are still used, and the page shows which sources worked.
  If all of them fail, the page keeps the last good numbers and says so.
- **GitHub's daily timer can run a little late** (sometimes 15–30 minutes).
- **If a repository has no activity for 60 days, GitHub pauses scheduled runs.**
  The daily data save should count as activity, but if it ever pauses, open
  the Actions tab and click **Enable workflow**.
- This is research, not investment advice.

## Files

- `scripts/build.mjs`: collects data, scores, writes the report, builds the page
- `scripts/parse.mjs`: reads tables and dates from the IPO websites
- `site/template.html`: the page design
- `data/`: today's numbers, report history, financials you've added
- `.github/workflows/daily.yml`: the 8:50 AM IST daily run
