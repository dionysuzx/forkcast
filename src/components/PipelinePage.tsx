import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './ui/Logo';
import ThemeToggle from './ui/ThemeToggle';
import { protocolCalls, type Call } from '../data/calls';
import { fetchUpcomingCalls, type UpcomingCall } from '../utils/github';
import { useMetaTags } from '../hooks/useMetaTags';

const MAPPING_URL = 'https://raw.githubusercontent.com/ethereum/pm/master/.github/ACDbot/meeting_topic_mapping.json';
const MANIFEST_URL = 'https://raw.githubusercontent.com/ethereum/pm/master/.github/ACDbot/artifacts/manifest.json';

const REFRESH_INTERVAL = 150_000; // 2.5 minutes

// Map PM series names to forkcast type names (mirrors sync script)
const SERIES_TO_TYPE: Record<string, string> = {
  glamsterdamrepricings: 'price',
  trustlesslogindex: 'tli',
  pqtransactionsignatures: 'pqts',
  rpcstandards: 'rpc',
  encryptthemempool: 'etm',
  allwalletdevs: 'awd',
  pqinterop: 'pqi',
};

type PipelineStage = 'scheduled' | 'ended' | 'uploaded' | 'assets_ready' | 'synced' | 'live';

interface PipelineCall {
  id: string;
  series: string;
  localType: string;
  number: string;
  date: string;
  startTime?: string;
  stage: PipelineStage;
  youtubeVideoId?: string;
  issueNumber?: number;
  uploadAttempts?: number;
  stuck?: boolean;
  forkcastPath?: string;
  hasOffsets: boolean;
  needsOffsets: boolean;
  inProgress?: boolean;
  githubUrl?: string;
}

const STAGE_ORDER: PipelineStage[] = ['scheduled', 'ended', 'uploaded', 'assets_ready', 'synced', 'live'];

const STAGE_LABELS: Record<PipelineStage, string> = {
  scheduled: 'Scheduled',
  ended: 'Ended',
  uploaded: 'Uploaded',
  assets_ready: 'Assets Ready',
  synced: 'Synced',
  live: 'Live',
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  scheduled: 'bg-slate-400',
  ended: 'bg-amber-400',
  uploaded: 'bg-blue-400',
  assets_ready: 'bg-indigo-400',
  synced: 'bg-emerald-400',
  live: 'bg-green-500',
};

const LIVESTREAMED_TYPES = new Set(['acdc', 'acde', 'acdt']);

function getLocalType(series: string): string {
  return SERIES_TO_TYPE[series] || series;
}

function StageIndicator({ stage, stuck }: { stage: PipelineStage; stuck?: boolean }) {
  const stageIdx = STAGE_ORDER.indexOf(stage);

  return (
    <div className="flex items-center gap-1">
      {STAGE_ORDER.map((s, i) => {
        const reached = i <= stageIdx;
        const isCurrent = i === stageIdx;
        return (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all ${
              i === 0 ? 'w-3' : 'w-3'
            } ${
              stuck && isCurrent
                ? 'bg-red-400 animate-pulse'
                : reached
                ? STAGE_COLORS[s]
                : 'bg-slate-200 dark:bg-slate-700'
            }`}
            title={STAGE_LABELS[s]}
          />
        );
      })}
    </div>
  );
}

const PipelinePage: React.FC = () => {
  const [calls, setCalls] = useState<PipelineCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useMetaTags({
    title: 'Pipeline | Forkcast',
    description: 'Call asset pipeline status',
  });

  const loadPipelineData = useCallback(async () => {
    try {
      // Fetch mapping, manifest, and upcoming calls in parallel
      const [mappingRes, manifestRes, upcomingCalls] = await Promise.all([
        fetch(MAPPING_URL),
        fetch(MANIFEST_URL),
        fetchUpcomingCalls().catch(() => [] as UpcomingCall[]),
      ]);

      if (!mappingRes.ok || !manifestRes.ok) {
        throw new Error('Failed to fetch pipeline data');
      }

      const mapping = await mappingRes.json();
      const manifest = await manifestRes.json();

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Build a set of synced calls from local data
      const syncedPaths = new Set(protocolCalls.map((c: Call) => c.path));
      const syncedCallsByPath = new Map(protocolCalls.map((c: Call) => [c.path, c]));

      // Build manifest lookup: series -> callId -> resources
      const manifestLookup = new Map<string, Set<string>>();
      if (manifest?.series) {
        for (const [series, seriesData] of Object.entries(manifest.series)) {
          const callIds = new Set<string>();
          for (const call of (seriesData as { calls?: { path?: string }[] }).calls || []) {
            const callId = call?.path?.split('/')?.[1];
            if (callId) callIds.add(callId);
          }
          manifestLookup.set(series, callIds);
        }
      }

      const pipelineCalls: PipelineCall[] = [];

      // Process mapping entries
      if (mapping) {
        for (const [series, seriesMapping] of Object.entries(mapping)) {
          const localType = getLocalType(series);
          const calls = (seriesMapping as { calls?: Record<string, unknown> })?.calls;
          if (!calls) continue;

          for (const [callId, callInfo] of Object.entries(calls)) {
            const info = callInfo as {
              start_time?: string;
              youtube_video_id?: string;
              youtube_upload_processed?: boolean;
              transcript_processed?: boolean;
              upload_attempt_count?: number;
              issue_number?: number;
            };

            // Parse date and number from callId (e.g., "2026-02-05_174")
            const sepIndex = callId.lastIndexOf('_');
            if (sepIndex === -1) continue;

            const date = callId.substring(0, sepIndex);
            const number = callId.substring(sepIndex + 1).padStart(3, '0');

            // Filter to last 7 days + next 7 days
            const callDate = new Date(date + 'T00:00:00Z');
            if (callDate < sevenDaysAgo || callDate > sevenDaysAhead) continue;

            const forkcastPath = `${localType}/${number}`;
            const isSynced = syncedPaths.has(forkcastPath);
            const syncedCall = syncedCallsByPath.get(forkcastPath);
            const hasManifestEntry = manifestLookup.get(series)?.has(callId) ?? false;
            const hasVideo = Boolean(info.youtube_video_id);
            const needsOffsets = LIVESTREAMED_TYPES.has(localType);
            const hasOffsets = !needsOffsets || (syncedCall && !syncedCall.pending);
            const uploadAttempts = info.upload_attempt_count || 0;
            const stuck = uploadAttempts > 2 && !hasVideo;

            // Determine stage
            let stage: PipelineStage = 'scheduled';
            if (callDate <= now) stage = 'ended';
            if (hasVideo) stage = 'uploaded';
            if (hasManifestEntry) stage = 'assets_ready';
            if (isSynced) stage = 'synced';
            if (isSynced && hasOffsets) stage = 'live';

            pipelineCalls.push({
              id: `${series}/${callId}`,
              series,
              localType,
              number,
              date,
              startTime: info.start_time,
              stage,
              youtubeVideoId: info.youtube_video_id,
              issueNumber: info.issue_number,
              uploadAttempts,
              stuck,
              forkcastPath: isSynced ? forkcastPath : undefined,
              hasOffsets: Boolean(hasOffsets),
              needsOffsets,
            });
          }
        }
      }

      // Merge upcoming calls from GitHub issues that aren't already in the pipeline
      const existingKeys = new Set(pipelineCalls.map(c => `${c.localType}/${c.number}`));
      const today = now.toISOString().split('T')[0];

      for (const upcoming of upcomingCalls) {
        const key = `${upcoming.type}/${upcoming.number}`;
        if (existingKeys.has(key)) continue;

        const callDate = new Date(upcoming.date + 'T00:00:00Z');
        if (callDate < sevenDaysAgo || callDate > sevenDaysAhead) continue;

        const isToday = upcoming.date === today;
        const isPast = callDate <= now;

        pipelineCalls.push({
          id: `upcoming/${key}`,
          series: upcoming.type,
          localType: upcoming.type,
          number: upcoming.number,
          date: upcoming.date,
          stage: isPast ? 'ended' : 'scheduled',
          issueNumber: upcoming.issueNumber,
          hasOffsets: false,
          needsOffsets: LIVESTREAMED_TYPES.has(upcoming.type),
          inProgress: isToday && isPast,
          githubUrl: upcoming.githubUrl,
        });
        existingKeys.add(key);
      }

      // Flag in-progress calls: today's calls that haven't been uploaded yet
      for (const call of pipelineCalls) {
        if (call.date === today && STAGE_ORDER.indexOf(call.stage) <= STAGE_ORDER.indexOf('ended')) {
          call.inProgress = true;
        }
      }

      // Sort: upcoming first (by date asc), then past (by date desc)
      pipelineCalls.sort((a, b) => {
        const aDate = new Date(a.date);
        const bDate = new Date(b.date);
        const aFuture = aDate > now;
        const bFuture = bDate > now;

        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;
        if (aFuture && bFuture) return aDate.getTime() - bDate.getTime();
        return bDate.getTime() - aDate.getTime();
      });

      setCalls(pipelineCalls);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPipelineData();
    const interval = setInterval(loadPipelineData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadPipelineData]);

  const liveCount = calls.filter(c => c.stage === 'live').length;
  const inProgressCount = calls.filter(c => c.inProgress).length;
  const stuckCount = calls.filter(c => c.stuck).length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6 relative">
          <div className="absolute top-0 right-0">
            <ThemeToggle />
          </div>
          <Logo size="md" className="mb-4" />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Pipeline</h1>
              <Link
                to="/calls"
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                All calls
              </Link>
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {liveCount} live
              {inProgressCount > 0 && (
                <span className="text-purple-500 dark:text-purple-400"> · {inProgressCount} in progress</span>
              )}
              {stuckCount > 0 && (
                <span className="text-red-500 dark:text-red-400"> · {stuckCount} stuck</span>
              )}
              {lastRefresh && (
                <span className="hidden sm:inline"> · updated {lastRefresh.toLocaleTimeString()}</span>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16">
            <p className="text-slate-500 dark:text-slate-400">Loading pipeline data...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={loadPipelineData}
              className="mt-2 text-sm text-red-600 dark:text-red-400 underline"
            >
              Retry
            </button>
          </div>
        ) : calls.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-500 dark:text-slate-400">No calls in the pipeline window</p>
          </div>
        ) : (
          <div className="space-y-2">
            {calls.map((call) => (
              <div
                key={call.id}
                className={`bg-white dark:bg-slate-800 border rounded-lg p-3 transition-all ${
                  call.stuck
                    ? 'border-red-300 dark:border-red-700'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Left: call info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase w-12 flex-shrink-0">
                      {call.localType}
                    </span>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex-shrink-0">
                      #{call.number}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
                      {call.date}
                    </span>
                  </div>

                  {/* Center: stage indicator */}
                  <div className="flex-shrink-0">
                    <StageIndicator stage={call.stage} stuck={call.stuck} />
                  </div>

                  {/* Right: status + links */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      call.stuck
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        : call.inProgress
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : call.stage === 'live'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : call.stage === 'synced' && call.needsOffsets && !call.hasOffsets
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                      {call.stuck
                        ? `Upload failed (${call.uploadAttempts}x)`
                        : call.inProgress
                        ? 'In Progress'
                        : call.stage === 'synced' && call.needsOffsets && !call.hasOffsets
                        ? 'Pending offsets'
                        : STAGE_LABELS[call.stage]}
                    </span>

                    {/* Links */}
                    <div className="flex items-center gap-1">
                      {(call.issueNumber || call.githubUrl) && (
                        <a
                          href={call.issueNumber ? `https://github.com/ethereum/pm/issues/${call.issueNumber}` : call.githubUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                          title="GitHub issue"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
                          </svg>
                        </a>
                      )}
                      {call.youtubeVideoId && (
                        <a
                          href={`https://youtube.com/watch?v=${call.youtubeVideoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-red-500 transition-colors"
                          title="YouTube"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                          </svg>
                        </a>
                      )}
                      {call.forkcastPath && (
                        <Link
                          to={`/calls/${call.forkcastPath}`}
                          className="text-slate-400 hover:text-blue-500 transition-colors"
                          title="View on Forkcast"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          {STAGE_ORDER.map((stage) => (
            <div key={stage} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage]}`} />
              <span>{STAGE_LABELS[stage]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PipelinePage;
