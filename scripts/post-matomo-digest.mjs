#!/usr/bin/env node

/**
 * Generates a weekly Forkcast analytics report using Claude Agent SDK.
 * Claude autonomously queries the Matomo API, explores the codebase and
 * git history, then produces a full formatted report.
 *
 * Set DRY_RUN=true to print the report to stdout instead of posting to Mattermost.
 */

delete process.env.CLAUDECODE;

const DRY_RUN = process.env.DRY_RUN === "true";

const REQUIRED_ENV_VARS = DRY_RUN
  ? ["MATOMO_URL", "MATOMO_TOKEN", "MATOMO_SITE_ID"]
  : ["MATOMO_URL", "MATOMO_TOKEN", "MATOMO_SITE_ID", "MATTERMOST_WEBHOOK_URL"];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function getDateRange() {
  const now = new Date();
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const fmt = (d) => d.toISOString().split("T")[0];
  return { start: fmt(start), end: fmt(end) };
}

function buildPrompt() {
  const { start, end } = getDateRange();
  const matomoUrl = process.env.MATOMO_URL;
  const matomoToken = process.env.MATOMO_TOKEN;
  const siteId = process.env.MATOMO_SITE_ID;

  return `You are an analytics analyst for Forkcast (https://forkcast.org), a React SPA that tracks Ethereum network upgrade progress.

Produce a comprehensive weekly analytics report for ${start} to ${end}.

## Data sources

### Matomo API
Use curl via Bash. Connection details:
- Base URL: ${matomoUrl}/index.php
- Auth token: ${matomoToken}
- Site ID: ${siteId}
- Date range: ${start},${end}

Example: curl -s "${matomoUrl}/index.php?module=API&method=VisitsSummary.get&idSite=${siteId}&period=range&date=${start},${end}&format=JSON&token_auth=${matomoToken}"

Also fetch the previous week for comparison (use period=range with the prior 7-day window).

Useful API methods:
- VisitsSummary.get — visits, unique visitors, pageviews, bounce rate, avg duration
- VisitsSummary.getVisits — for weekly breakdown (use period=day)
- Actions.getPageUrls — top pages (flat=1&filter_limit=30)
- Referrers.getReferrerType — traffic sources
- Referrers.getWebsites — referring websites
- UserCountry.getCountry — visitor countries
- DevicesDetection.getType — device types
- VisitTime.getVisitInformationPerServerTime — visits by hour
- Actions.getEntryPageUrls — landing pages
- VisitorInterest.getNumberOfVisitsPerVisitDuration — session length distribution

### Codebase & Git
Use Read, Glob, Grep, and Bash (git log, git diff) to explore the codebase and recent changes.

## Instructions
1. Fetch key Matomo metrics AND previous week for comparison
2. Explore git history for the period
3. Correlate traffic patterns with code changes
4. Identify data quality issues, engagement patterns, and growth opportunities

## Output format
Produce the FULL report as plain text with ASCII tables. Use this exact structure:

\`\`\`
Forkcast Analytics Report — ${start} to ${end}

Overview

┌────────────────────┬─────────────┐
│       Metric       │    Value    │
├────────────────────┼─────────────┤
│ Visits             │ X,XXX       │
├────────────────────┼─────────────┤
│ Pageviews          │ XX,XXX      │
├────────────────────┼─────────────┤
│ Pages/visit        │ X.X         │
├────────────────────┼─────────────┤
│ Bounce rate        │ XX%         │
├────────────────────┼─────────────┤
│ Avg session        │ Xm XXs      │
├────────────────────┼─────────────┤
│ Unique visitors    │ X,XXX       │
└────────────────────┴─────────────┘

Week-over-Week: +X% visits, +X% pageviews (or however the trend looks)
\`\`\`

Then include numbered **Actionable Insights** — each with supporting data in ASCII tables where relevant. Cover things like:
- Top pages and engagement patterns
- Traffic sources breakdown
- Notable EIPs or upgrade pages drawing attention
- Code changes correlated with traffic
- Data quality issues (e.g., tracking duplication)
- Growth opportunities

End with a **Recommended Actions** section — numbered by impact.

Use ASCII box-drawing characters (┌─┬┐├─┼┤└─┴┘│) for all tables. Use bar charts (█▌) for trends where useful. Keep analysis sharp and actionable — no fluff. Do NOT wrap the output in a code block.`;
}

async function generateReport() {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const prompt = buildPrompt();

  console.log("Generating analytics report...");

  let reportText = "";

  for await (const message of query({
    prompt,
    options: {
      allowedTools: ["Read", "Glob", "Grep", "Bash", "WebFetch"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      maxTurns: 20,
      model: "claude-opus-4-6",
    },
  })) {
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block) {
          reportText = block.text;
        }
      }
    }
  }

  if (!reportText) {
    throw new Error("Report generation returned empty.");
  }

  console.log("Report generated successfully.");
  return reportText;
}

async function postToMattermost(report) {
  const payload = {
    username: "Forkcast Analytics",
    icon_emoji: ":bar_chart:",
    text: "```\n" + report + "\n```",
  };

  console.log("Posting to Mattermost...");
  const response = await fetch(process.env.MATTERMOST_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mattermost webhook failed: ${response.status} — ${body}`);
  }

  console.log("Posted successfully.");
}

async function main() {
  validateEnv();
  const report = await generateReport();

  if (DRY_RUN) {
    console.log("\n" + report);
    return;
  }

  await postToMattermost(report);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
