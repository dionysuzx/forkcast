#!/usr/bin/env node

/**
 * Fetches weekly analytics from Matomo and posts a formatted digest
 * to Mattermost via incoming webhook.
 */

const REQUIRED_ENV_VARS = [
  "MATOMO_URL",
  "MATOMO_TOKEN",
  "MATOMO_SITE_ID",
  "MATTERMOST_WEBHOOK_URL",
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    matomoUrl: process.env.MATOMO_URL,
    matomoToken: process.env.MATOMO_TOKEN,
    siteId: process.env.MATOMO_SITE_ID,
    webhookUrl: process.env.MATTERMOST_WEBHOOK_URL,
  };
}

function getLastWeekRange() {
  const now = new Date();
  // Find last Monday (start of last week)
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7;
  const lastMonday = new Date(now);
  lastMonday.setUTCDate(now.getUTCDate() - daysToLastMonday);
  lastMonday.setUTCHours(0, 0, 0, 0);

  const lastSunday = new Date(lastMonday);
  lastSunday.setUTCDate(lastMonday.getUTCDate() + 6);

  const fmt = (d) => d.toISOString().split("T")[0];
  return { start: fmt(lastMonday), end: fmt(lastSunday) };
}

async function fetchMatomoData({ matomoUrl, matomoToken, siteId }) {
  const { start, end } = getLastWeekRange();
  const period = "range";
  const date = `${start},${end}`;

  const methods = [
    { method: "VisitsSummary.get" },
    { method: "Actions.getPageUrls", params: { flat: 1, filter_limit: 10 } },
    { method: "Referrers.getReferrerType" },
    { method: "AIAgents.get" },
  ];

  const urls = methods.map(({ method, params = {} }) => {
    const sp = new URLSearchParams({
      module: "API",
      method,
      idSite: siteId,
      period,
      date,
      format: "JSON",
      token_auth: matomoToken,
      ...params,
    });
    return `${sp}`;
  });

  const bulkParams = new URLSearchParams();
  bulkParams.set("module", "API");
  bulkParams.set("method", "API.getBulkRequest");
  bulkParams.set("format", "JSON");
  bulkParams.set("token_auth", matomoToken);
  urls.forEach((url, i) => {
    bulkParams.set(`urls[${i}]`, `?${url}`);
  });

  console.log(`Fetching Matomo data for ${start} to ${end}...`);
  const response = await fetch(`${matomoUrl}/index.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bulkParams.toString(),
  });

  if (!response.ok) {
    throw new Error(`Matomo API request failed: ${response.status} ${response.statusText}`);
  }

  const results = await response.json();

  const [visitsSummary, pageUrls, referrers, aiAgents] = results;

  // AIAgents may not exist on all Matomo instances
  const hasAiAgents = aiAgents && !aiAgents.result && !aiAgents.message;

  return {
    visitsSummary,
    pageUrls: Array.isArray(pageUrls) ? pageUrls : [],
    referrers: Array.isArray(referrers) ? referrers : [],
    aiAgents: hasAiAgents ? aiAgents : null,
    weekRange: { start, end },
  };
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function buildGraphUrl(env, { apiModule, apiAction, graphType, period, date, extraParams = {} }) {
  const params = new URLSearchParams({
    module: "API",
    method: "ImageGraph.get",
    idSite: env.siteId,
    apiModule,
    apiAction,
    graphType,
    period,
    date,
    width: "500",
    height: "200",
    token_auth: env.matomoToken,
    ...extraParams,
  });
  return `${env.matomoUrl}/index.php?${params}`;
}

function formatMessage(data, env) {
  const { matomoUrl, siteId } = env;
  const { visitsSummary, pageUrls, referrers, aiAgents, weekRange } = data;
  const dateRange = `${weekRange.start},${weekRange.end}`;

  const header =
    `#### Weekly Digest\n` +
    `**${weekRange.start}** to **${weekRange.end}**  ·  ` +
    `[View in Matomo](${matomoUrl}/index.php?module=CoreHome&action=index&idSite=${siteId}&period=range&date=${dateRange})`;

  const attachments = [];

  // Attachment 1: Visitor Summary
  if (visitsSummary && !visitsSummary.result) {
    attachments.push({
      color: "#2196F3",
      title: "Visitors Summary",
      fields: [
        { short: true, title: "Visits", value: `${visitsSummary.nb_visits ?? 0}` },
        { short: true, title: "Unique Visitors", value: `${visitsSummary.nb_uniq_visitors ?? 0}` },
        { short: true, title: "Pageviews", value: `${visitsSummary.nb_actions ?? 0}` },
        {
          short: true,
          title: "Bounce Rate",
          value: visitsSummary.bounce_rate ?? `${visitsSummary.bounce_count ?? 0}`,
        },
        {
          short: true,
          title: "Avg. Duration",
          value: formatDuration(visitsSummary.avg_time_on_site),
        },
      ],
      image_url: buildGraphUrl(env, {
        apiModule: "VisitsSummary",
        apiAction: "get",
        graphType: "evolution",
        period: "day",
        date: dateRange,
      }),
    });
  }

  // Attachment 2: Top Pages
  if (pageUrls.length > 0) {
    const rows = pageUrls.map(
      (p) =>
        `| ${p.label || "/"} | ${p.nb_visits ?? 0} | ${p.nb_uniq_visitors ?? p.sum_daily_nb_uniq_visitors ?? 0} |`
    );
    const table =
      `| Page | Views | Unique Visitors |\n` +
      `|:-----|------:|----------------:|\n` +
      rows.join("\n");

    attachments.push({
      color: "#4CAF50",
      title: "Top Pages",
      text: table,
      image_url: buildGraphUrl(env, {
        apiModule: "Actions",
        apiAction: "getPageUrls",
        graphType: "horizontalBar",
        period: "range",
        date: dateRange,
        extraParams: { flat: "1", filter_limit: "10" },
      }),
    });
  }

  // Attachment 3: Referrer Breakdown
  if (referrers.length > 0) {
    const fields = referrers.map((r) => ({
      short: true,
      title: r.label || "Unknown",
      value: `${r.nb_visits ?? 0} visits`,
    }));
    attachments.push({
      color: "#FF9800",
      title: "Referrer Breakdown",
      fields,
      image_url: buildGraphUrl(env, {
        apiModule: "Referrers",
        apiAction: "getReferrerType",
        graphType: "pie",
        period: "range",
        date: dateRange,
      }),
    });
  }

  // Attachment 4: AI Chatbots (if available)
  if (aiAgents) {
    const agentList = Array.isArray(aiAgents) ? aiAgents : [aiAgents];
    if (agentList.length > 0 && agentList[0].label) {
      const fields = agentList.map((a) => ({
        short: true,
        title: a.label || "Unknown",
        value: `${a.nb_visits ?? 0} visits`,
      }));
      attachments.push({
        color: "#9C27B0",
        title: "AI Chatbots Overview",
        fields,
      });
    }
  }

  return {
    username: "Forkcast Analytics",
    icon_emoji: ":bar_chart:",
    text: header,
    attachments,
  };
}

async function postToMattermost(webhookUrl, payload) {
  console.log("Posting digest to Mattermost...");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mattermost webhook failed: ${response.status} ${response.statusText} — ${body}`);
  }

  console.log("Digest posted successfully.");
}

async function main() {
  const env = validateEnv();
  const data = await fetchMatomoData(env);
  const payload = formatMessage(data, env);
  await postToMattermost(env.webhookUrl, payload);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
