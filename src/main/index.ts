import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, powerMonitor, powerSaveBlocker, screen, shell, Notification } from 'electron';
import { execFile, spawn } from 'node:child_process';
import {
  rmSync, existsSync, readFileSync, readdirSync, statSync, cpSync, writeFileSync,
  unlinkSync, mkdirSync, renameSync, createWriteStream, copyFileSync, lstatSync,
  readlinkSync, symlinkSync, watch as watchFs
} from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { join, resolve, sep, basename, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { request as httpsRequest } from 'node:https';
import { PtyManager, type ProcessLaunch, type SpawnOptions } from './pty';
import { resolveCommand as resolveCliCommand, isSafeCommandName, userShellPath } from './shellEnv';
import { buildPtyEnv } from './ptyEnv';
import {
  apiKeyShapeOk, checkAnthropicKey, claudeInstallScript, claudeMissingScript, ENGINE_INSTALL_PTY, ENGINE_SIGNIN_PTY,
  claudeAuthStatusCommand, findClaudeFast, isEngineSetupPty, makeClaudeAuthReader, makeNoticeCoalescer, readEngineSetupStatus,
  shouldStartInstall, type EngineSetupStatus, type KeyCheckFetch
} from './engineSetup';
import { setHiddenClaudeAuthEnv } from './hiddenClaude';
import { initAutoUpdater, abortPendingRestart } from './updater';
import { RealtimeFloorWatcher } from './realtimeFloorWatcher';
import {
  readConfig, damagedConfigCopy, writeConfig, setAgentTokenCap, resetConfig, onConfigWritten, ensureHarnessHome, ensureClaudePermissionsAccepted, approveClaudeApiKey,
  modelForRole, OPS_STANDUP_MISSION, OPS_STANDUP_BUILT_IN_BODIES, OPS_STANDUP_FOCUS, OPS_STANDUP_BUILT_IN_FOCUSES, HEARTBEAT_MISSION, COMPACT_MAINTENANCE_MISSION, type HarnessConfig, type ScheduledMission
} from './config';
import { terminalLaunches } from './terminalAtFolder';
import { listDir, readFileText, readFileBinary, writeFileText, statAbs, expandTilde, askFileVerdict, askFileRootsFor, resolveAskFileRoots, opensAsFolder, readAskFile, type AskFileAgent } from './fs';
import { answerMessages, cardConversation, mergeHumanQA, MICHAEL_ID, raiserOf } from '../shared/askMeRouting';
import { FIRST_TASK_EDITED_MAX, firstTaskCard, firstTaskCardFromText } from '../shared/firstTask';
import { answerKey, catchUpRequests, ownerWorkOrder } from '../shared/ownerRequests';
import {
  agentMcpDir, legacyMdMailMcpPath, mdMailMcpPath, privateRoot
} from '../shared/agentPrivatePaths';
import { normalizeWeekly, weeklyDelayMs } from '../shared/weeklySchedule';
import { normalizeTimes, timesDelayMs } from '../shared/scheduleTimes';
import {
  armPlan, firePayload, upsertMission, deleteMission, setMissionEnabled, pauseMissionsOf,
  migrateMissions, clampIntervals, buildScheduleRequest, applyScheduleRequest, missionsFor, fileScheduleRequest, foldScheduleRequests,
  requestSummary, whenWords, cleanFocus, scheduledJobsBlock,
  type ScheduleRequest
} from '../shared/missions';
import { MICHAEL_WORK_STYLE } from '../shared/michaelWorkStyle';
import {
  getBranch, getStatus, getLog, getBranches, getAheadBehind, isRepo, getDiff, mainRepoRoot,
  addWorktree, removeWorktree, worktreeHasUnintegratedWork, worktreeIsGcSafe,
  getLogGraph, getCommitFiles, getFileAtRev, compareRefs, listWorktrees, checkoutRef
} from './git';
import { linkWorktreeDeps, unlinkWorktreeDeps } from './worktreeDeps';
import { HiveManager, type AgentMeta, type HiveMessage, type HiveTask } from './hive';
import { HookServer, type PlanSignal } from './hooks';
import { OfficeBreak, type OfficeBreakState } from './officeBreak';
import { heldByBreak } from '../shared/officeBreak';
import { loadBundledPacks, packsResourceDir } from './packs';
import { businessFolderRoot, ensureFolder, safeFolderName } from './agentFolders';
import { CircuitBreaker, type BreakerInput } from './breaker';
import type { UsageProvider } from './usage';
import { MemoryManager } from './memory';
import { KnowledgeManager } from './knowledge';
import { MemoryTidy } from './memoryTidy';
import { checkDistinct, readJobProfile } from './hireCheck';
import { checkFocusArea, convertWorkStyle, readConvertRequest, readFocusCheckRequest, readSuggestRequest, suggestWorkStyle } from './workStyleConvert';
import { SafeClearer, type SafeClearDeps } from './safeClearer';
import { PersistStore } from './db';
import { readAgentUsage, readContextTokens, seedSessionTranscript, resolveSessionCwd } from './transcript';
import { listIssues, listCIRuns } from './github';
import { SlackWebhookServer, SlackReplyServer, postSlackReply, type SlackEventFile } from './slack';
import {
  WebhookServer,
  type WebhookDispatch, type WebhookEndpointRef, type WebhookInbound, type WebhookTaskStatus
} from './webhook';
import {
  classifyInboundKind, isAutoAllowed,
  AUTO_COMPACT_WINDOW_TOKENS, DEFAULT_CONTEXT_TRIGGER, DEFAULT_ORG_TRIGGER, DEFAULT_TRIGGER_MODE, DEFAULT_WEBHOOK_SCHEMA,
  type ContextRule, type ContextTriggerConfig, type InboundKind, type OrgTriggerConfig,
  type TriggerHistoryEntry, type TriggerMode, type WebhookTrigger
} from '../shared/triggers';
import {
  appendTriggerHistory, clearTriggerHistory, listTriggerHistory, updateTriggerHistory
} from './triggerHistory';
import { transcribeWithGroq, DEFAULT_GROQ_MODEL } from './freeflow';
import { registerRealtimeIpc } from './realtime';
import { registerRealtimeActionIpc } from './realtimeActions';
import { initCompletionWatcher } from './realtimeCompletionWatcher';
import type { TaskCard, InboxMessage } from './realtimeCompletionWatcher';
import { TelemetryCollector } from './telemetry';
import { CostLedgerTotals } from './costLifetime';
import { analytics, isRendererMessageSurface } from './analytics';
import type { SpawnFailReason } from './analytics';
import { IntegrationBroker } from './integrationBroker';
import * as integrations from './integrations';
import { MailService, handleMailRequest, saveMailbox, removeMailbox, setAgentCapabilities, setSendOnly, type AddMailboxInput } from './mail';
import { MailApprovals } from './mailApprovals';
import { standingFitCheck } from './standingCheck';
import { terminalOverflowEvent } from '../shared/terminalOverflow';
import { PROVIDER_PRESETS, grantPaused, hasMailTools, mailAccess, mailboxAddress, secretRefForMailbox, sendOnlyGrant, sendingFor, sendingMode, sendingWords, type SendingMode } from '../shared/mailboxes';
import { levelFor } from '../shared/agentDefinition';
import { claudeBinFor, readClaudeMcpList } from './claudeMcpList';
import { connectorCarryOver, isEmailCalendarKey, isQuickBooksKey, renamedKeys, spawnConnectorPlan, usableConnectors, type SpawnConnectorPlan } from '../shared/claudeConnectors';
import { quickbooksAccessToSave } from '../shared/quickbooks';
import { emailCalendarAllowed } from '../shared/mcpCatalog';
import { validateBaseUrl, buildAuthHeaders, resolveUpstreamUrl, secretRefFor, INTEGRATION_TEMPLATES } from '../shared/integrations';
import { RosterStore } from './roster';
import { buildWorkerLaunch } from './workerLaunch';
import { ControlRegistry } from './control';
import { WorkerWakeWatchdog, type WorkerWakeFacts } from './workerWake';
import { inboxNudgeText } from '../shared/hiveNudge';
import { resolveGodName } from '../shared/godIdentity';
import { COLLECT_USAGE_STATS, SHOW_DELIVERY_SWITCH, SHOW_VOICE, SHOW_SLACK } from '../shared/buildFeatures';
import { fetchHireManifest, readHireManifestFiles } from './hire';
import { parseHireDeepLink, type HireManifest } from '../shared/hire';
import { ClosingTimeController } from './closingTime';
import {
  argsWithAutoModeFlag,
  inferAgentProvider,
  isClaudeProvider,
  nonInteractiveEnvForProvider,
  providerPreset,
  installInfoForProvider,
  type AgentProvider
} from '../shared/agentProvider';
import { buildMissingCliScript, chooseInstallRung } from './cliInstall';
import { detectNodeVersion, nodeIsUsable, resolveNodeInstaller } from './nodeInstall';
import { toolCatalog, type ToolStatus } from '../shared/toolCatalog';
import { listLocalSkills, loadCatalog, installSkill, uninstallSkill, type LocalSkill } from './skills';
import { loadHero } from './hero';
import { loadModelCatalog } from './modelCatalog';
import { claudeCliVersion } from './claudeCliVersion';
import { ALLOW_TEMP_WORKERS } from '../shared/buildFeatures';
import { APP_NAME, APP_DATA_DIR, APP_URL_SCHEME } from '../shared/appName';
import { homeFolderStatus, homeReadyAtLaunch } from './homeFolder';
import { backfillOfficeRecord, findOffice, folderLayoutFor, isUsableTeamFolder, syncOfficeRecord } from './officeFile';
import { folderPolicy, type AgentFolderPolicy, type FolderLayout } from '../shared/folderAccess';
import { legacyBusinessFolder, touchesOffice } from '../shared/officeRecord';
import { cleanCompanyProfile, companyProfileContext } from '../shared/companyProfile';
import { scheduledRunBody } from '../shared/scheduleMessage';
import { OFFICE_OPEN_SUBJECT, officeClosedInLog, officeOpenBody } from '../shared/officeOpen';
import { CLAUDE_MODEL_CLI_FLOOR, modelForCli } from '../shared/modelCliFloor';
import { cliUpdateStatus, type CliUpdateStatus } from '../shared/cliUpdate';
import {
  CODEX_REMOTE_SOCKET_RELATIVE,
  codexRemoteAliasPath,
  codexRemoteEndpoint,
  codexRemoteSocketFits,
  withCodexRemoteArgs
} from '../shared/codexRemote';
import { restartApp } from './restart';
import { PromptSubmits, confirmSubmit } from '../shared/submitConfirm';

const isDev = !!process.env.ELECTRON_RENDERER_URL;

// The name in the menu bar (and About / Hide / Quit) is the app's name. Pin the
// data folder FIRST: Electron derives userData from the app name, so renaming
// without the pin would open on an empty folder, as if freshly installed.
app.setPath('userData', join(app.getPath('appData'), APP_DATA_DIR));
app.setName(APP_NAME);

// Keep the main process alive on an unexpected throw/rejection. The harness is a
// multi-agent supervisor — a single stray throw (e.g. node-pty's ConPTY console
// helper choking when a fast-exiting agent CLI's console is already gone) must
// NOT take the whole app and every running agent down with it. Log and continue
// rather than letting the default handler exit the process.
// (Restored during the #71 merge — the PR's rebase dropped these handlers.)
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection (kept alive):', reason);
});

const ptyManager = new PtyManager();

function runCodexDaemonCommand(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 20_000
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolveResult) => {
    let settled = false;
    let stderr = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      resolveResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    let timer: NodeJS.Timeout;
    const finish = (result: { ok: boolean; error?: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 8_000) stderr += String(chunk);
    });
    child.once('error', (e) => finish({ ok: false, error: e.message }));
    child.once('exit', (code) => {
      finish(code === 0
        ? { ok: true }
        : { ok: false, error: stderr.trim() || `Codex exited with code ${code ?? 'unknown'}` });
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish({ ok: false, error: `Codex daemon command timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });
}

/** Start/enable one managed remote-control daemon for this isolated Codex home,
 * then point the TUI at its app-server socket. Failure is non-fatal: the worker
 * still starts as a normal local Codex session. */
async function enableCodexRemoteForSpawn(
  opts: SpawnOptions & { hive?: AgentMeta },
  agentId: string
): Promise<boolean> {
  if (process.platform === 'win32') return false;
  const realHome = opts.env?.CODEX_HOME;
  if (!realHome) return false;
  try {
    const alias = codexRemoteAliasPath(realHome, agentId);
    // Bail before touching the filesystem if even the short alias would exceed
    // sun_path — the daemon would start and then die on bind, and the warning
    // below names the real reason instead of a generic readiness timeout.
    if (!codexRemoteSocketFits(alias)) {
      console.warn('[codex-remote] socket path exceeds sun_path; starting local TUI:', alias);
      return false;
    }
    const aliasRoot = dirname(alias);
    mkdirSync(aliasRoot, { recursive: true });
    if (existsSync(alias)) {
      const st = lstatSync(alias);
      if (!st.isSymbolicLink() || resolve(dirname(alias), readlinkSync(alias)) !== resolve(realHome)) {
        console.warn('[codex-remote] short home alias is occupied; starting local TUI:', alias);
        return false;
      }
    } else {
      symlinkSync(realHome, alias, 'dir');
    }

    const socket = join(alias, CODEX_REMOTE_SOCKET_RELATIVE);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.env ?? {}),
      CODEX_HOME: alias
    };
    // shellEnv's resolver mirrors PtyManager's (which is private + returns
    // {path, found}); the daemon just needs the best executable path.
    const executable = resolveCliCommand(opts.command);
    const started = await runCodexDaemonCommand(
      executable,
      ['app-server', 'daemon', 'start'],
      env
    );
    if (!started.ok) {
      console.warn('[codex-remote] daemon start failed; starting local TUI:', started.error);
      return false;
    }
    const enabled = await runCodexDaemonCommand(
      executable,
      ['app-server', 'daemon', 'enable-remote-control'],
      env
    );
    if (!enabled.ok) {
      console.warn('[codex-remote] enable failed; starting local TUI:', enabled.error);
      return false;
    }
    if (!existsSync(socket)) {
      console.warn('[codex-remote] daemon returned without a control socket; starting local TUI');
      return false;
    }
    opts.env = { ...(opts.env ?? {}), CODEX_HOME: alias };
    opts.args = withCodexRemoteArgs(opts.args ?? [], codexRemoteEndpoint(alias));
    return true;
  } catch (e) {
    console.warn('[codex-remote] setup failed; starting local TUI:',
      e instanceof Error ? e.message : e);
    return false;
  }
}
/** Live PTY id → its hive agent id, recorded at spawn. The pty:kill handler only
 *  gets the PTY id, so this lets a closed tab archive the right registry agent. */
const ptyToAgent = new Map<string, string>();
/** Live Claude PTY id → the binary it ran and the Claude Code version it started
 *  on. Claude Code updates itself on disk, but a running agent keeps its version
 *  until restarted; comparing the two drives the "close the office and reopen"
 *  notice (src/shared/cliUpdate.ts). */
const ptyCli = new Map<string, { bin: string; started: string }>();
let lastCliUpdate: CliUpdateStatus | null = null;
/** Re-read the installed version and tell the renderer when the answer changes.
 *  The probe is cached per binary + mtime, so this is cheap to call often. */
let cliUpdateRun = 0;
async function refreshCliUpdate(): Promise<void> {
  // A slow probe (a cache miss) must not land after a newer refresh and put
  // back an agent that has since exited: only the latest run reports.
  const run = ++cliUpdateRun;
  const agents = await Promise.all([...ptyCli.values()].map(async (p) => ({
    started: p.started,
    installed: await claudeCliVersion(p.bin)
  })));
  if (run !== cliUpdateRun) return;
  const next = cliUpdateStatus(agents);
  if (JSON.stringify(next) === JSON.stringify(lastCliUpdate)) return;
  lastCliUpdate = next;
  try { liveWebContents()?.send('cliUpdate:status', next); } catch { /* window tore down */ }
}
// Claude Code's own updater runs in the background, so poll for it.
setInterval(() => { void refreshCliUpdate(); }, 10 * 60_000).unref();
ipcMain.handle('cliUpdate:current', () => lastCliUpdate);
/** PTY id → the spawn it should auto restart-and-continue into once a first-time
 *  CLI install finishes. The missing-CLI short-circuit runs the engine's installer
 *  in this PTY; when it exits cleanly the exit handler re-runs the SAME spawn (with
 *  install disabled) so the freshly-installed CLI launches in the SAME pty/window —
 *  no user click. Cleared the moment it's consumed, so it can never loop installs. */
const pendingInstallRelaunch = new Map<string, { opts: AgentSpawnOptions; owner: Electron.WebContents | null; bin: string; rung: string }>();
const hive = new HiveManager(
  () => readConfig().harnessHome,
  (channel, payload) => {
    const wc = liveWebContents();
    if (!wc) return false;
    try { wc.send(channel, payload); return true; } catch { return false; }
  }
);
// #7C — operator control state (pause/gate/steer/halt), read by the HookServer
// when deciding hook returns.
const control = new ControlRegistry();
// Stage 7A — the live observability tap. Receives Claude Code's first-party OTel
// over loopback OTLP/JSON and exposes the locked usage-provider seam. resolveCwd
// lets the transcript fallback find an agent's cwd from the hive registry.
const telemetry = new TelemetryCollector({
  emit: (channel, payload) => { try { liveWebContents()?.send(channel, payload); } catch { /* window tore down */ } },
  resolveCwd: (agentId) => hive.registry().agents[agentId]?.cwd ?? null,
  // D11: scopes the transcript fallback to this agent's own session instead of
  // summing every transcript in a (routinely shared) cwd.
  resolveSessionId: (agentId) => hive.lastSession(agentId),
  resolveCodexHome: (agentId) => hive.codexHome(agentId)
});
// Usage provider (Seam 1) — the INTEGRATION swap: Oscar's telemetry collector (#7)
// IS the provider, replacing Lane A's interim StubUsageProvider. Same
// getAgentUsage(agentId) pull seam, so the breaker + cost ledger consumers are
// untouched; telemetry has a transcript fallback built in, so it works before any
// live OTel arrives.
const usageProvider: UsageProvider = telemetry;
// Circuit breaker (Lane A #6.6b) — the REAL policy (replaces Lane C's interim
// glue). POLICY only; the heartbeat beat feeds it signals (via usageProvider) +
// enforces its decisions. Config read live so a settings change applies next beat.
const breaker = new CircuitBreaker(() => {
  const c = readConfig();
  return { ...(c.circuitBreaker ?? {}), costCapUsd: c.costCapUsd, costCapTokens: c.costCapTokens, agentTokenCaps: c.agentTokenCaps };
});
// Always-on beats (decoupled from the optional heartbeat): the live fleet snapshot
// Michael reads + the breaker beat, so guardrails + monitoring work even when the
// heartbeat mission is disabled (it ships off).
let fleetTimer: ReturnType<typeof setInterval> | null = null;
let breakerBeatTimer: ReturnType<typeof setInterval> | null = null;
// Feed the breaker's api_error-storm trip from Oscar's OTel api_error spans —
// Jim's one breaker input with no on-branch source (telemetry.onApiError seam).
telemetry.onApiError((agentId) => breaker.recordError(agentId));
// Shared roster on disk — created early so HookServer can re-read standing goals
// on every UserPromptSubmit (Edit Agent saves land here via persistAgents).
const roster = new RosterStore(() => readConfig().harnessHome);
/**
 * Whether a member is on the team now, for Send only grants
 * (docs/designs/shared-mailboxes.md, EV1): in the roster's `agents`, or in
 * `restorable` (the app moves every member there at launch until it respawns
 * them). Archived (closed by the owner) or deleted counts as gone. The hive
 * registry's `archived` flag only means "no live terminal", and it keeps
 * deleted members, so it is not used. With no roster to read, everyone the
 * config names counts, as before.
 */
function memberPresent(agentId: string): boolean {
  const snap = roster.read();
  if (!snap) return true;
  const has = (list: unknown[]): boolean => Array.isArray(list) && list.some((e) => !!e && typeof e === 'object' && (e as { id?: unknown }).id === agentId);
  return has(snap.agents) || has(snap.restorable);
}

function standingGoalFromRoster(agentId: string): string | null {
  const snap = roster.read();
  if (!snap || !Array.isArray(snap.agents)) return null;
  for (const entry of snap.agents) {
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as { id?: unknown; goal?: unknown };
    if (a.id !== agentId) continue;
    return typeof a.goal === 'string' && a.goal.trim() ? a.goal.trim() : null;
  }
  return null;
}

/** The Work style an agent's sessions get (docs/designs/schedule-focus-areas.md):
 *  its own, or Michael's default (F6), followed by its scheduled jobs by name
 *  and time. A job's focus is not here: it comes with that job's run (FA2). */
function standingGoalFor(agentId: string): string | null {
  let godId = 'god';
  try { godId = hive.registry().godId || 'god'; } catch { /* no hive yet */ }
  const own = standingGoalFromRoster(agentId) ?? (agentId === godId ? MICHAEL_WORK_STYLE : null);
  let jobs: string | null = null;
  try { jobs = scheduledJobsBlock(readConfig().missions ?? [], agentId, godId); } catch { /* no config yet */ }
  const parts = [own, jobs].filter((x): x is string => !!x);
  return parts.length ? parts.join('\n\n') : null;
}
// Worker inbox-wake watchdog (#151): finds idle workers with undrained inbox mail
// and types the same guarded nudge the renderer would have (so a throttled
// background window can't leave a worker parked on an unread inbox forever).
// HookServer feeds it the hook stream so a permission/HITL prompt blocks nudges.
const workerWake = new WorkerWakeWatchdog();
// When each agent last accepted a prompt, so a typed nudge can confirm it
// landed (shared/submitConfirm.ts).
const promptSubmits = new PromptSubmits();
// HookServer needs BOTH: Oscar's control registry (HITL pause/gate/steer/halt via
// hook returns) AND Jim's breaker (feed recordToolUse on each PostToolUse).
const hookServer = new HookServer(
  hive,
  () => liveWebContents(),
  () => readConfig(),
  control,
  breaker,
  standingGoalFor,
  (agentId, event, message) => {
    workerWake.noteHook(agentId, event, message);
    safeClearer.noteHook(agentId, event, message);
    if (agentId && event === 'UserPromptSubmit') promptSubmits.note(agentId);
    if (agentId && (event === 'Notification' || event === 'PermissionRequest')) promptSubmits.noteAttention(agentId);
  },
  () => ({ ...knowledge.agentAccess(), meaning: meaningSearch() }),
  companyProfileForAgents,
  (agentId) => agentHasBooksRead(agentId),
  memberPresent,
  (signal) => onPlanSignal(signal)
);
const memory = new MemoryManager(
  () => readConfig().harnessHome,
  () => { const c = readConfig(); return { enabled: c.semanticMemory !== false, model: c.embeddingModel ?? 'minilm' }; },
  // Company knowledge, indexed into the palace for searching by meaning.
  () => knowledge.meaningMirror()
);
/** The company profile as every agent reads it (src/shared/companyProfile.ts).
 *  The industry is the owner's own words when no business type fit, else the
 *  business type's name. Read fresh on each hook, so an edit in Settings
 *  reaches running agents on their next message. */
const packInfoCache = new Map<string, { displayName?: string; briefing?: string }>();
/** The office's business pack: its display name and Michael's briefing. Packs
 *  are read from disk and the hook runs on every prompt, so it's remembered. */
function businessPackInfo(businessType: string | undefined): { displayName?: string; briefing?: string } {
  if (!businessType) return {};
  if (!packInfoCache.has(businessType)) {
    try {
      const pack = loadBundledPacks({ packsDir }).packs.find((x) => x.pack.businessType === businessType)?.pack;
      packInfoCache.set(businessType, { displayName: pack?.displayName, briefing: pack?.briefing });
    } catch { return {}; }
  }
  return packInfoCache.get(businessType) ?? {};
}
function companyProfileForAgents(): string | null {
  const cfg = readConfig();
  const industry = businessPackInfo(cfg.businessType).displayName;
  return companyProfileContext({ name: cfg.businessName, industry }, cleanCompanyProfile(cfg.companyProfile));
}

/** MemPalace, for agents to search company knowledge by meaning: only when it's
 *  installed and on, and company knowledge is on. */
function meaningSearch(): { bin: string; palace: string } | undefined {
  const bin = memory.bin();
  const palace = memory.palacePath();
  return memory.active() && knowledge.active() && bin && palace ? { bin, palace } : undefined;
}
// Company knowledge: file-backed store + agent CLI (default ON).
const knowledge = new KnowledgeManager();
// Keeps each agent's memory index useful (owner, 2026-09-25): agents add notes
// to memory/inbox.md and this turns them into itemised changes on Haiku, in
// the background. It replaces the old whole-file condenser (reflect.ts).
const memoryTidy = new MemoryTidy(
  () => readConfig().harnessHome,
  () => readConfig().defaultCommand ?? 'claude',
  () => memory.env(),
  () => isFloorQuiet(300_000),
  (id) => hive.registry().agents[id]?.name ?? id,
  (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }
);
// Durable harness state (SQLite, main process). Phase A: window bounds (kv) +
// net-new command history. Opened in whenReady, closed in the teardown blocks.
const persist = new PersistStore();
/** The PRIMARY window — the one running the hive/god orchestration and the sink
 *  for process-global timer events (missions, breaker, Slack ingestion). It is
 *  the most-recently-focused live window, so global events follow the user.
 *  Additional "floor" windows are tracked in `allWindows` below. */
let mainWindow: BrowserWindow | null = null;
/** Every open window (primary + floors). A registry, not a single handle, so
 *  multi-window lifecycle (focus tracking, quit fan-out) is correct. */
const allWindows = new Set<BrowserWindow>();

/** When true, skip the quit interceptor (user already confirmed). */
let allowQuit = false;

/** Agents spawned with `isolate: true` get a dedicated git worktree; this maps
 *  the agent/pty id → the worktree path so we can tear it down on kill. */
const worktreePaths = new Map<string, string>();
/** id → the original repo cwd the worktree was created from (needed to run
 *  `git worktree remove` from the parent tree, not the worktree itself). */
const worktreeOrigins = new Map<string, string>();

/** A live god-triggered ephemeral worker, tracked from spawn to teardown. */
interface WorkerRec {
  workerId: string;       // == the PTY id == hive agent id (`worker-<reqId>`)
  reqId: string;          // the spawn-request id
  name?: string;          // display name (for the worker tab)
  slack?: { channel: string; thread_ts: string };
  baseBranch: string;     // the branch its worktree was cut from (for ahead-of-base)
  spawnedAt: number;      // epoch ms
  releasing?: boolean;    // kill issued; awaiting teardownPty (skip re-processing)
  /** Per-worker TOTAL-token cap from the spawn-request (overrides the config
   *  default). 0/undefined = no per-request cap. P4 plumbing — unlimited today. */
  tokenCap?: number;
}
/** Live ephemeral workers by id. Populated by the spawn-request watcher; consulted
 *  by teardownPty so a finished/crashed/reaped worker's worktree is PRESERVED (not
 *  force-removed) when it holds unintegrated work — god is the sole integrator. */
const liveWorkers = new Map<string, WorkerRec>();

/** The loopback secret broker (Phase 2). Workers reach registered integrations through
 *  it without ever seeing a credential. getRecord/getSecret are injected so the broker
 *  stays electron-free + unit-testable. Started in bootstrapHiveServices; each worker is
 *  granted a per-worker capability token at spawn (revoked in teardownPty). */
/** Mailboxes (docs/designs/multi-mailbox.md). One IMAP connection per mailbox,
 *  shared by every agent that may use it; passwords stay in the secret store. */
const mailService = new MailService({
  getConfig: () => readConfig(),
  getPassword: (id) => integrations.getSecret(secretRefForMailbox(id)),
  markStatus: (id, status, reason) => markMailboxStatus(id, status, reason),
  journalPath: join(app.getPath('userData'), 'mail-send-journal.json')
});

/** MB-7: a mailbox that stops accepting its password is marked "needs you" in
 *  Settings and raises one Ask me card; a later success clears both. */
function markMailboxStatus(id: string, status: 'connected' | 'needs-attention', reason?: string): void {
  const cfg = readConfig();
  const list = cfg.mailboxes ?? [];
  const rec = list.find((m) => m.id === id);
  if (!rec || (rec.status === status && rec.statusReason === reason)) return;
  writeConfig({ mailboxes: list.map((m) => (m.id === id ? { ...m, status, statusReason: status === 'needs-attention' ? reason : undefined, updatedAt: Date.now() } : m)) });
  const cardId = `mailbox-attention-${id}`;
  try {
    if (status === 'needs-attention') {
      const card = {
        id: cardId,
        title: `${rec.address} needs you`,
        status: 'blocked' as const,
        dependsOn: [],
        priority: 1,
        createdAt: new Date().toISOString(),
        humanQA: [{ q: `**${rec.address} stopped working: ${reason ?? 'the mail server refused the password'}**\n\nOpen Settings, Connections, Mailboxes and choose Fix to enter a new app password.`, askedAt: new Date().toISOString(), raisedBy: 'god' }]
      };
      if (!hive.addTask(card)) hive.patchTask(cardId, { status: 'blocked', humanQA: card.humanQA });
    } else if (rec.status === 'needs-attention') {
      closeMailboxCard(id, `${rec.address} is connected again.`);
    }
  } catch (e) { console.error('[mail] ask me card:', e); }
}

/** Close a mailbox's "needs you" Ask me card (MB-7), if one is open. */
function closeMailboxCard(id: string, result: string): void {
  const cardId = `mailbox-attention-${id}`;
  try {
    // A card already done keeps the result it closed with.
    const ledger = hive.tasks() as { tasks?: HiveTask[] };
    const open = (Array.isArray(ledger?.tasks) ? ledger.tasks : []).some((t) => t?.id === cardId && t.status !== 'done');
    if (open) hive.patchTask(cardId, { status: 'done', result });
  } catch (e) { console.error('[mail] ask me card:', e); }
}

/** Send on approval (docs/designs/send-on-approval.md): proposals the owner
 *  decides on Ask me, kept out of the hive so agents can't change them. */
const mailApprovals = new MailApprovals({
  path: join(app.getPath('userData'), 'mail-proposals.json'),
  send: (msg) => { if (!hive.enabled()) return false; hive.send(msg, 'mail'); return true; },
  remember: (agentId, line) => { hive.rememberOwnerNote(agentId, line); },
  // Only Michael notifies the owner (docs/designs/michael-only-notifications.md).
  toast: (body) => ownerToast(michaelName(), body),
  agentName: (id) => { try { return hive.registry().agents[id]?.name?.trim() || id; } catch { return id; } },
  godId: () => hiveGodId(),
  changed: () => { try { liveWebContents()?.send('mailProposals:updated'); } catch { /* window gone */ } },
  // The late sweep asks Michael only about emails that can go now (a paused
  // or ended grant can't).
  canSend: (agentId, mailbox, proposalId) => memberPresent(agentId) && mailAccess(readConfig(), agentId, mailbox, 'send', proposalId, { present: memberPresent }).ok
});

/** Does an email fit a standing approval: a separate quick model decides, never the agent. */
const standingFit = standingFitCheck({
  // An empty folder only the app writes, never the office folder agents work
  // in, so no CLAUDE.md or project settings an agent left can sway the check.
  cwd: () => {
    const dir = join(app.getPath('userData'), 'standing-check');
    mkdirSync(dir, { recursive: true });
    // Trusted up front, as agent folders are at spawn, so the check never
    // stops on Claude Code's "trust this folder" question.
    try { ensureClaudePermissionsAccepted(dir); } catch { /* the check fails closed */ }
    return dir;
  },
  command: () => readConfig().defaultCommand ?? 'claude',
  env: () => memory.env(),
  log: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }
});

const integrationBroker = new IntegrationBroker({
  getRecord: integrations.getRecord,
  getSecret: integrations.getSecret,
  mail: (agentId, op, body) => handleMailRequest(mailService, { getConfig: () => readConfig(), audit: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }, proposals: mailApprovals, fitCheck: standingFit, present: memberPresent, log: (line) => console.log(line) }, agentId, op, body)
});

/** Absolute path to the bundled md-mail MCP server (same resolution as the
 *  Slack helper below). */
function mdMailScriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'md-mail-mcp.cjs') : join(app.getAppPath(), 'resources', 'md-mail-mcp.cjs');
}

/** Delete this agent's md-mail MCP file from the private dir and the legacy
 *  hive path (#63). Best-effort; missing files are fine. */
function removeMdMailMcp(agentId: string | undefined): void {
  if (!agentId || !/^[\w.-]+$/.test(agentId)) return;
  const home = readConfig().harnessHome ? expandTilde(readConfig().harnessHome!) : null;
  const root = hive.root();
  if (home) {
    try { unlinkSync(mdMailMcpPath(home, agentId)); } catch { /* gone */ }
    try { rmSync(agentMcpDir(home, agentId), { recursive: true, force: true }); } catch { /* gone */ }
  }
  if (root) {
    try { unlinkSync(legacyMdMailMcpPath(root, agentId)); } catch { /* gone */ }
  }
}

/**
 * Drop private/agent-mcp folders for agents that have no live PTY (#63 orphan
 * sweep). A crash can leave a token file behind after revoke; startup clears it.
 */
function sweepOrphanAgentMcp(): void {
  const home = readConfig().harnessHome ? expandTilde(readConfig().harnessHome!) : null;
  if (!home) return;
  const root = join(privateRoot(home), 'agent-mcp');
  if (!existsSync(root)) return;
  const live = new Set<string>();
  for (const aid of ptyToAgent.values()) live.add(aid);
  try {
    for (const id of readdirSync(root)) {
      if (live.has(id)) continue;
      try { rmSync(join(root, id), { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  } catch (e) { console.error('[mail] orphan agent-mcp sweep:', e); }
  // Legacy leftovers under hive/agents/<id>/md-mail.mcp.json
  const hiveRoot = hive.root();
  if (!hiveRoot) return;
  try {
    const agents = join(hiveRoot, 'agents');
    if (!existsSync(agents)) return;
    for (const id of readdirSync(agents)) {
      if (live.has(id)) continue;
      try { unlinkSync(legacyMdMailMcpPath(hiveRoot, id)); } catch { /* none */ }
    }
  } catch { /* best-effort */ }
}

const mailAdmin = {
  getConfig: () => readConfig(),
  saveConfig: (patch: Partial<HarnessConfig>) => { writeConfig(patch); },
  setSecret: (ref: string, value: string) => integrations.setSecret(ref, value),
  deleteSecret: (ref: string) => integrations.deleteSecret(ref),
  endGrant: (agentId: string, mailbox: string, reason: string) => mailApprovals.endGrant(agentId, mailbox, reason),
  cancelFor: (agentId: string, mailbox: string, reason: string) => { mailApprovals.cancel({ agentId, mailbox }, reason); },
  sendingChanged: (agentId: string, mailbox: string, address: string, sending: SendingMode, handBack: boolean) => mailApprovals.sendingChanged(agentId, mailbox, address, sending, handBack),
  present: memberPresent,
  canStoreSecrets: () => integrations.canStoreSecrets()
};

/**
 * Send only grants on a mailbox nobody on the team reads are paused (S3, D10).
 * Michael hears once, after the pause has lasted PAUSE_NOTICE_MS, so the app's
 * launch and a hire in flight never set it off (EV1). Runs on the 5 minute sweep.
 */
function noticePausedGrants(): void {
  if (!hive.enabled()) return;
  const cfg = readConfig();
  const paused: string[] = [];
  for (const agentId of Object.keys(cfg.agentCapabilities ?? {})) {
    const g = sendOnlyGrant(cfg, agentId);
    // A grant of a member off the team does nothing, so it is nobody's news.
    if (!g || !memberPresent(agentId)) continue;
    if (grantPaused(cfg, g.mailbox, memberPresent)) paused.push(`${agentId}\u0000${g.mailbox}`);
  }
  for (const key of mailApprovals.pausedDue(paused)) {
    const [agentId, mailbox] = key.split('\u0000');
    const address = mailboxAddress(cfg, mailbox);
    let name = agentId;
    try { name = hive.registry().agents[agentId]?.name?.trim() || agentId; } catch { /* no hive */ }
    hive.send({
      to: hiveGodId(), act: 'inform',
      subject: `Paused: nobody reads ${address}`,
      body: `${name} sends only from ${address}, but nobody on the team reads it now, so its replies would go unanswered. ${name}'s email from there is on hold until someone does: the owner can give ${address} to a team member on their Access tab, or remove ${name}'s Send only access there.`
    }, 'mail');
  }
}

/** BYOK backend model-providers whose API keys the non-Claude CLI engines
 *  (OpenCode/Crush/pi/qwen) read from standard env vars. Keys are stored
 *  WRITE-ONLY in the same encrypted secret broker as integrations, under
 *  `apikey:<backend>`, and materialized MAIN-ONLY at spawn (never over IPC). */
const BACKEND_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY'
};
const providerKeyRef = (backend: string): string => `apikey:${backend}`;

/** Claude's sign in for the team when the owner chose an API key in Get Michael
 *  ready (docs/designs/get-michael-ready.md): ANTHROPIC_API_KEY from the secret
 *  store, read main only at start. Empty for a Claude account. */
function claudeAuthEnv(): Record<string, string> {
  if (readConfig().claudeAuth !== 'apiKey') return {};
  const key = integrations.getSecret(providerKeyRef('anthropic'));
  return key ? { ANTHROPIC_API_KEY: key } : {};
}

/** A worker worktree that teardown PRESERVED because it held unintegrated work.
 *  Tracked so the GC sweep can reclaim it (+ its scratch dir) once the work lands
 *  in base or the worktree is removed by hand — see gcPreservedWorktrees(). */
interface PreservedWorktree {
  workerId: string;
  wtPath: string;
  origCwd: string;        // the parent repo to run `git worktree remove` from
  baseBranch: string;     // re-checked against this for "integrated yet?"
  scratchDir: string | null; // HIVE_ROOT/agents/<workerId> — removed alongside the worktree
  slack?: { channel: string; thread_ts: string };
  preservedAt: number;    // epoch ms
}
/** Preserved worker worktrees awaiting integration, keyed by worktree path. The GC
 *  sweep drains this: an entry is removed (worktree + scratch GC'd) only when the
 *  work is provably integrated, or when the worktree is already gone from disk. */
const preservedWorktrees = new Map<string, PreservedWorktree>();

/**
 * Tear down everything tied to a PTY id: archive its hive agent, remove its
 * isolated git worktree, and drop the bookkeeping-map entries. Runs on BOTH an
 * explicit `pty:kill` AND a natural PTY exit (the child finished, crashed, or
 * was killed externally) — without this the agent stays "active" (broadcasts
 * keep mailing a dead inbox), the worktree orphans (plus a dangling `git
 * worktree` registration in the user's real repo), and the maps leak an entry
 * per dead PTY.
 *
 * Idempotent: guarded on map presence and the already-idempotent
 * `hive.setArchived`, so a double call is a harmless no-op. NOTE: an explicit
 * `ptyManager.kill()` does NOT reach here via onExit — kill() deletes the
 * session synchronously, so node-pty's later async exit callback fails the
 * session-identity guard and is swallowed. Every kill site must therefore call
 * teardownPty itself right after the kill (all of them do). Best-effort — every
 * step is wrapped so a teardown error can never crash the caller (an IPC
 * handler or node-pty's onExit).
 */
function teardownPty(id: string): void {
  // Ephemeral-worker flag, read BEFORE the cleanup below deletes the entry. All
  // worker deaths (done-release, idle/token reap, manual stop, crash) funnel
  // through here, so this is the one place their floor card gets archived
  // (workers card via the hive:agentSpawned broadcast in processSpawnRequest).
  // pty id == worker id == agent id for workers.
  const wasWorker = liveWorkers.has(id);
  const agentId = ptyToAgent.get(id);
  // 0) Drop the md-mail MCP file that holds this agent's broker token (#63),
  //    then revoke this id's broker capability (if any). File first so a sibling
  //    cannot read a live path after revoke races a slow delete. Idempotent +
  //    harmless for a non-worker PTY; ensures a dead worker's token can never
  //    reach an integration.
  try { removeMdMailMcp(agentId ?? id); } catch { /* best-effort */ }
  try { integrationBroker.revoke(id); } catch { /* best-effort */ }
  // 1) Archive the agent — retained + flagged; only live-PTY agents are active.
  if (ptyCli.delete(id)) void refreshCliUpdate();
  connectorPlans.delete(id);
  if (agentId) {
    ptyToAgent.delete(id);
    // Drop watchdog state so a dead agent can't get nudged or leak its grace.
    try { workerWake.forget(agentId, id); } catch { /* best-effort */ }
    // Drop breaker state so a dead agent can't leak/zombie a tripped level.
    try { breaker.forget(agentId); } catch { /* best-effort */ }
    // A replacement using this id needs a new usage counter, not the dead PTY's.
    try { telemetry.forgetAgent(agentId); } catch { /* best-effort */ }
    // W1 — kill this agent's proxy-bridge sidecar (qwen), if any, so a dead
    // PTY never leaves an orphan loopback listener. No-op for non-proxy agents.
    try { hive.stopProxyBridge(agentId); } catch (e) { console.error('[hive] stopProxyBridge failed:', e); }
    if (hive.enabled()) {
      try { hive.setArchived(agentId, true); } catch (e) { console.error('[hive] setArchived failed:', e); }
    }
  }
  // 2) Remove the isolated worktree, if any. Non-blocking; errors are logged.
  const wtPath = worktreePaths.get(id);
  if (wtPath) {
    const origCwd = worktreeOrigins.get(id) ?? wtPath;
    worktreePaths.delete(id);
    worktreeOrigins.delete(id);
    // Ephemeral workers get a SAFETY-GATED teardown: never auto-remove a worktree
    // that holds unintegrated work. This sits INSIDE teardownPty so it covers ALL
    // teardown routes — a worker that finished (controller kill), crashed, or was
    // idle-reaped all land here. Normal agents keep the immediate force-remove.
    const worker = liveWorkers.get(id);
    if (worker) {
      liveWorkers.delete(id);
      void finalizeWorkerWorktree(wtPath, origCwd, worker);
    } else {
      void removeWorktree(origCwd, wtPath)
        .then(r => { if (!r.ok) console.error('[worktree] removeWorktree failed:', r.error); })
        .catch(e => console.error('[worktree] removeWorktree threw:', e));
    }
  }
  // A worker whose isolation failed (non-repo cwd) has no worktree to gate above —
  // still clear its tracking entry so the controller stops watching a dead PTY.
  if (liveWorkers.has(id)) liveWorkers.delete(id);
  // Archive the dead worker's floor card (mirrors killAgent's voice-kill path;
  // the renderer's archiveAgent is a no-op if the card is already gone). NOT
  // done for regular agents: their kill flows already manage their own card.
  if (wasWorker) {
    try { liveWebContents()?.send('hive:agentArchived', { id }); } catch { /* window torn down */ }
  }
  // A terminal that ends during closing time leaves the dialog's list at once.
  // Best-effort: a failure here must never break the teardown.
  try { if (agentId) closingTime.refresh(agentId); } catch (e) { console.error('[closing-time] refresh:', e); }
  syncKeepAwake();
}

/** Send an inform to the god agent (the human's proxy). The ephemeral-worker
 *  controller uses this to surface every terminal failure AND to carry the Slack
 *  {channel,thread_ts} so god can post a 'couldn't complete' reply — closing the
 *  Slack loop (the success path is the worker replying in-thread itself). */
function informGod(subject: string, body: string, slack?: { channel: string; thread_ts: string }): void {
  try {
    const slackLine = slack
      // The bundled-node launcher, spelled as an ABSOLUTE PATH — NOT bare `node`
      // (absent from the PATH of any machine whose node comes from nvm) and NOT
      // `$HIVE_NODE` (POSIX-only: cmd.exe/PowerShell expand it to nothing, so the
      // whole reply command was dead on Windows).
      ? `\n\n[SLACK] Close the loop — post a reply to channel ${slack.channel} thread ${slack.thread_ts} via:\n  "${hive.nodeCommand()}" "${slackReplyScriptPath()}" --channel ${slack.channel} --thread ${slack.thread_ts} --text "<your message>"`
      : '';
    hive.send({ to: 'god', act: 'inform', subject, body: body + slackLine }, 'ephemeral-worker');
  } catch (e) {
    console.error('[worker] informGod failed:', e);
  }
}

/** Gated worktree teardown for an ephemeral worker: remove it ONLY when it holds no
 *  unintegrated work; otherwise leave it (and its branch) in place and ping god, the
 *  sole integrator. Async + best-effort; on any uncertainty it KEEPS the worktree
 *  (fail-safe — never auto-discard possibly-valuable work). */
async function finalizeWorkerWorktree(wtPath: string, origCwd: string, worker: WorkerRec): Promise<void> {
  try {
    const deps = await unlinkWorktreeDeps(origCwd, wtPath);
    if (!deps.ok) console.error('[worktree] dependency unlink failed:', deps.error);
    const work = await worktreeHasUnintegratedWork(wtPath, worker.baseBranch);
    if (work.keep) {
      console.warn(`[worker] PRESERVING worktree with unintegrated work: ${wtPath} (${work.detail})`);
      // Track it so the GC sweep can reclaim it (+ scratch dir) once integrated —
      // the worker is gone from liveWorkers by now, so its identity lives here.
      preservedWorktrees.set(wtPath, {
        workerId: worker.workerId, wtPath, origCwd, baseBranch: worker.baseBranch,
        scratchDir: workerScratchDir(worker.workerId), slack: worker.slack, preservedAt: Date.now()
      });
      informGod(
        `[worker worktree preserved] ${worker.workerId}`,
        `Ephemeral worker ${worker.workerId} ended but its worktree holds unintegrated work, so it was NOT auto-removed (you are the sole integrator).\n`
        + `Worktree: ${wtPath}\nBranch: ${work.branch}\nState: ${work.detail}\n`
        + `Review/merge it — it will be auto-reclaimed once its work lands in ${worker.baseBranch}, or remove it now with: git -C "${origCwd}" worktree remove "${wtPath}"`,
        worker.slack
      );
      return;
    }
    const r = await removeWorktree(origCwd, wtPath);
    if (!r.ok) { console.error('[worker] removeWorktree failed:', r.error); return; }
    // Worktree is gone (clean/integrated at teardown), but DEFER its scratch-dir
    // cleanup to the throttled GC sweep rather than deleting it synchronously here:
    // HIVE_ROOT/agents/<id> holds the worker's memory.md and the MemPalace miner
    // ingests it asynchronously, so an immediate delete can beat the miner and
    // permanently lose the worker's durable notes from the shared palace. Register
    // it (its worktree path is now absent) so the sweep's path-gone branch reclaims
    // the scratch after a window — same throttled path the preserved case uses.
    preservedWorktrees.set(wtPath, {
      workerId: worker.workerId, wtPath, origCwd, baseBranch: worker.baseBranch,
      scratchDir: workerScratchDir(worker.workerId), slack: worker.slack, preservedAt: Date.now()
    });
  } catch (e) {
    console.error('[worker] finalizeWorkerWorktree threw (worktree left in place):', e);
  }
}

/** The hive scratch dir for a worker (its inbox/outbox/memory): HIVE_ROOT/agents/<id>.
 *  Null when there's no hive root. */
function workerScratchDir(workerId: string): string | null {
  const root = hive.root();
  return root ? join(root, 'agents', workerId) : null;
}

/** Best-effort removal of a worker's scratch (hive agent) dir. Guarded to ONLY ever
 *  delete a path that resolves to exactly HIVE_ROOT/agents/<workerId> and never a
 *  still-live worker — so a crafted/mismatched id can't escape the agents root. */
function removeWorkerScratch(workerId: string): void {
  if (liveWorkers.has(workerId)) return; // never wipe a live worker's mailbox
  const dir = workerScratchDir(workerId);
  const root = hive.root();
  if (!dir || !root) return;
  const agentsRoot = join(root, 'agents');
  // Path-safety: the resolved dir must sit directly under agents/ with basename == id.
  if (resolve(dir) !== join(resolve(agentsRoot), basename(dir)) || basename(dir) !== workerId) return;
  try { rmSync(dir, { recursive: true, force: true }); }
  catch (e) { console.error('[worker] removeWorkerScratch failed:', e); }
}
// A natural PTY exit must run the same teardown as an explicit kill — EXCEPT when
// the PTY was the missing-CLI installer: a clean exit there means the engine CLI was
// just installed, so auto restart-and-continue by re-running the SAME spawn into the
// SAME pty/window (no user click). Every engine but Claude, which Get Michael ready
// installs where the owner can see it (engineSetup.ts). Idempotent by construction: the
// relaunch carries `noAutoInstall`, so the installer can never fire (let alone loop) a
// second time — a binary that's somehow still missing just spawns and exits normally.
ptyManager.setExitHandler((id, exitCode, info) => {
  // The Get Michael ready terminals (engineSetup.ts): the step re-reads where
  // Claude stands. They are not agents, so nothing else applies.
  if (isEngineSetupPty(id)) {
    // The next sign in read starts after this, never joining an older one.
    claudeAuth.invalidate();
    if (id === ENGINE_INSTALL_PTY) {
      analytics.track('agent_install_finished', { provider: 'claude', rung: 'native', outcome: claudePathFast() ? 'agent_launched' : 'install_failed' });
    }
    try { liveWebContents()?.send('engineSetup:changed', { id, exitCode: exitCode ?? null }); } catch { /* window gone */ }
    return;
  }
  // Record an ABNORMAL death before teardown — teardownPty drops the
  // pty->agent mapping, so after it runs we can no longer say WHOSE process
  // died. Only abnormal exits are recorded (recordAgentExit returns early on a
  // clean one), so this adds no noise to a normal archive.
  try {
    const dyingAgent = ptyToAgent.get(id);
    if (dyingAgent) {
      hive.recordAgentExit(dyingAgent, {
        exitCode,
        signal: info?.signal,
        tail: info?.tail,
        command: info?.command
      });
    }
  } catch (e) { console.error('[pty] recordAgentExit failed:', e); }

  const pending = pendingInstallRelaunch.get(id);
  if (pending) {
    pendingInstallRelaunch.delete(id);
    // Activation funnel: did the auto-installer actually complete? A non-zero exit
    // is the Linux-installer-cannot-finish-unattended signal that used to be silent.
    const provider = pending.opts.provider ?? inferAgentProvider(pending.opts.command, undefined);
    if (exitCode === 0) {
      analytics.track('agent_install_finished', { provider, rung: pending.rung, outcome: 'agent_launched' });
      // Re-arm the renderer's pooled terminal (clear the "process exited" line +
      // re-enable input) so the freshly-spawned CLI paints onto a clean, typeable
      // grid, then re-run the normal spawn — which now finds the installed binary.
      const wc = (pending.owner && !pending.owner.isDestroyed()) ? pending.owner : liveWebContents();
      try { wc?.send(`pty:relaunch:${id}`); } catch { /* window gone */ }
      void spawnAgentCore({ ...pending.opts, noAutoInstall: true }, pending.owner);
      return; // an install PTY has no agent/worktree to tear down
    }
    // Non-zero exit = install failed; leave its honest manual-fix message on screen.
    analytics.track('agent_install_finished', { provider, rung: pending.rung, outcome: 'install_failed' });
  }
  teardownPty(id);
});

/** Keep the system from suspending the harness while agents are running.
 *  Windows Modern Standby suspends desktop apps (and their child `claude`
 *  processes!) shortly after the display sleeps/locks — the whole hive froze
 *  mid-turn until unlock. `prevent-app-suspension` blocks exactly that while
 *  still letting the display turn off and the session lock. Held only while at
 *  least one PTY is alive, so an idle harness doesn't pin a laptop awake.
 *
 *  Opt-in `config.strongKeepalive` escalates to `prevent-display-sleep`, which on
 *  macOS ALSO blocks true system sleep (lid-close/idle) so timers & PTYs keep
 *  firing on time while away — at a battery cost. The default ('prevent-app-
 *  suspension') still lets the Mac truly sleep; we survive that and catch up once
 *  on resume (see onSystemResume). Re-evaluated on every call so toggling the
 *  flag while agents run swaps the blocker mode live. */
type KeepAwakeMode = 'prevent-app-suspension' | 'prevent-display-sleep';
let keepAwakeId: number | null = null;
let keepAwakeMode: KeepAwakeMode | null = null;
function syncKeepAwake(): void {
  const live = ptyManager.list().length > 0;
  const desired: KeepAwakeMode | null = live
    ? (readConfig().strongKeepalive ? 'prevent-display-sleep' : 'prevent-app-suspension')
    : null;
  if (desired === keepAwakeMode) return; // no change — avoid stop/start churn + log spam
  // Tear down the current blocker (mode change, or going idle with no agents).
  if (keepAwakeId !== null) {
    try { if (powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId); } catch { /* noop */ }
    keepAwakeId = null;
  }
  keepAwakeMode = desired;
  if (desired) {
    keepAwakeId = powerSaveBlocker.start(desired);
    console.log(`[power] keep-awake ON (${desired}) — agents running`);
  } else {
    console.log('[power] keep-awake off — no agents');
  }
}

/** A mission's live scheduler handles: the initial `setTimeout` that waits out
 *  the time remaining until its next due fire, and the steady `setInterval`
 *  armed once it has fired. Both are tracked so shutdown can clear whichever is
 *  pending. */
interface MissionTimer {
  timeout?: NodeJS.Timeout;
  interval?: NodeJS.Timeout;
}

/** Active scheduler timers keyed by mission id. */
const missionTimers = new Map<string, MissionTimer>();

/** Clear and forget every armed mission timer (both the setTimeout and the
 *  setInterval handle). Safe to call from syncMissions and from shutdown
 *  teardown so a tick never fires into half-torn-down services. */
function clearMissionTimers(): void {
  for (const t of missionTimers.values()) {
    if (t.timeout) clearTimeout(t.timeout);
    if (t.interval) clearInterval(t.interval);
  }
  missionTimers.clear();
}

/** Send one schedule run to its agent and stamp lastFiredAt. A 'compact'
 *  maintenance mission carries no dispatch (firePayload is null), so only the
 *  stamp happens. */
function sendMission(m: ScheduledMission): void {
  const payload = firePayload(m);
  if (payload && hive.enabled()) {
    hive.send({ to: payload.to, act: 'inform', subject: payload.subject, body: payload.body }, 'scheduler');
  }
  // No compaction here: that is Claude Code's own auto compact now, with its
  // window set per agent at spawn (AUTO_COMPACT_WINDOW_TOKENS).
  const current = readConfig().missions ?? [];
  const next = current.map((x) =>
    x.id === m.id ? { ...x, lastFiredAt: Date.now() } : x
  );
  writeConfig({ missions: next });
  // Let the SCHEDULES panel refresh its "last fired" without a reload (#2.3).
  try { liveWebContents()?.send('missions:updated'); } catch { /* window gone */ }
}

/** Rebuild the scheduler from persisted config: clear every existing timer,
 *  then arm each enabled mission honoring its lastFiredAt — a setTimeout for the
 *  time remaining until its next due fire, which then settles into a steady
 *  interval. Each tick dispatches the mission to its target agent and stamps
 *  lastFiredAt back into config. Called on boot (after the router starts) and
 *  after every missions:save. */
function syncMissions(): void {
  clearMissionTimers();
  const missions = readConfig().missions ?? [];
  for (const m of missions) {
    // Every decision (skip, heartbeat, weekly, interval and its first wait) is
    // armPlan's, in shared/missions.ts, where test/missions.test.cjs pins it.
    const plan = armPlan(m, Date.now(), { standupId: OPS_STANDUP_MISSION.id, standupFiredThisLaunch });
    if (plan.type === 'skip') continue;
    // Heartbeat (Lane A #1) opts out of the fixed setInterval and self-reschedules
    // with an adaptive cadence. Registered into the same missionTimers map so
    // clearMissionTimers() tears it down identically on quit/reset.
    if (plan.type === 'heartbeat') { armHeartbeat(m); continue; }
    const fire = (): void => {
      try {
        // Runs as configured, a break included (owner): the job lands in the
        // inbox, and the break only holds the nudge that delivers it.
        sendMission(m);
      } catch (e) {
        console.error('[scheduler] mission', m.id, e);
      }
    };
    const entry: MissionTimer = {};
    if (plan.type === 'weekly' || plan.type === 'times') {
      // Weekly self-reschedules: there is no steady interval to settle into,
      // because the gap between two slots varies (Fri to Mon is not Mon to Wed,
      // and the week the clocks change is not 168 hours long).
      //
      // `justFired` is a spin guard, not a nicety. weeklyDelayMs returns 0 for a
      // slot that was missed and not yet run, and it learns "already run" from
      // the persisted lastFiredAt — so if fire()'s writeConfig ever failed, the
      // next computation would return 0 again, forever. Passing `now` as the
      // last-fired floor after a fire makes the catch-up branch unreachable, so
      // the worst case is a lost stamp rather than a hot loop.
      const rearm = (justFired: boolean): void => {
        const now = Date.now();
        const persisted = (readConfig().missions ?? []).find((x) => x.id === m.id)?.lastFiredAt ?? 0;
        const floor = justFired ? Math.max(persisted, now) : persisted;
        // Several "when" lines re-arm the same way (src/shared/scheduleTimes.ts).
        const delay = plan.type === 'times' ? timesDelayMs(plan.times, now, floor) : weeklyDelayMs(plan.weekly, now, floor);
        if (delay === null) return;
        entry.timeout = setTimeout(() => { fire(); rearm(true); }, delay);
      };
      rearm(false);
      missionTimers.set(m.id, entry);
      continue;
    }
    // Interval: wait what remains until the next due fire, then settle into a
    // steady interval. The standup waits a full interval until the office opens
    // (standupOnOfficeOpen sends the launch one), so it isn't sent twice.
    entry.timeout = setTimeout(() => {
      fire();
      entry.interval = setInterval(fire, plan.everyMs);
    }, plan.firstDelayMs);
    missionTimers.set(m.id, entry);
  }
}

// ─── Context trigger (auto-compact / auto-clear own their own timers) ────────
// Compaction used to ride on a mission (`compact-maintenance`), which meant the
// operator had TWO competing controls for one behaviour — a schedule with an
// interval and a trigger with a cadence. The mission is retired (see the
// retirement migration in ensureDefaultMissions); these timers are the single
// remaining source of scheduled context maintenance.
//
// Main owns only the CADENCE. The pressure gate (`minContextPct`) needs each
// agent's live context usage, which only the renderer has, so the whole rule
// rides along in the event and the renderer decides which agents actually get
// the command. That split is why the payload carries the rule rather than a bare
// "go" signal.

/** Timers for the two halves, keyed by action. Same two-phase shape as
 *  `missionTimers` (a setTimeout for the remaining time, then a steady interval)
 *  so a partially-elapsed cadence survives a re-arm. */
const contextTimers = new Map<'compact' | 'clear', MissionTimer>();

/** `ContextRule` has no `lastFiredAt` (unlike `ScheduledMission`), so the last-run
 *  instants live in the durable kv store instead. Without them every re-arm —
 *  boot, a settings edit, a wake from sleep — would restart a 2h cadence from
 *  zero, and an operator who edits the rule twice a day would never see it fire. */
const CONTEXT_LAST_RUN_KV_KEY = 'triggers.context.lastRun';
let contextLastRun: Record<string, number> | null = null;

function contextRunMap(): Record<string, number> {
  if (!contextLastRun) {
    try { contextLastRun = persist.getKv<Record<string, number>>(CONTEXT_LAST_RUN_KV_KEY) ?? {}; }
    catch { contextLastRun = {}; }
  }
  return contextLastRun;
}

/** Clear and forget both context timers (setTimeout + setInterval handles). */
function clearContextTimers(): void {
  for (const t of contextTimers.values()) {
    if (t.timeout) clearTimeout(t.timeout);
    if (t.interval) clearInterval(t.interval);
  }
  contextTimers.clear();
}

function syncContextTriggers(): void {
  // Nothing runs on a clock any more. Compaction is Claude Code's own
  // (AUTO_COMPACT_WINDOW_TOKENS), and a conversation is cleared only after a
  // finished, handed-off task (safeClearer.ts), never on a timer (owner,
  // 2026-09-25). Kept so older callers (boot, settings, wake) still stop any
  // timer a previous version armed.
  clearContextTimers();
}

/** Startup migration (#57/#58): archive every agent entry that is `archived:false`
 *  but has NO live PTY. This runs in bootstrapHiveServices, BEFORE the renderer can
 *  respawn anything, so at this point NO agent owns a PTY — every `archived:false`
 *  entry is therefore a stale carry-over from a prior session that quit/crashed
 *  WITHOUT archiving (e.g. the pre-acc13a3 'assistant' Dwight entry). Left as-is
 *  they have no live PTY, so the breaker beat steers them and the steer bounces to
 *  GOD as a requires_reply GOD can't clear → inbox flood.
 *
 *  "No live PTY" = ptyForAgent(id) === undefined (ptyToAgent is populated only at
 *  spawn and pruned on teardown). God is never archived. A user's real agents are
 *  unaffected: the "restore team" flow respawns them through ensureAgent, which
 *  re-clears `archived` — restorability does not depend on the archived flag. */
function archiveOrphanedAgents(): void {
  if (!hive.enabled()) return;
  try {
    const reg = hive.registry();
    for (const [id, a] of Object.entries(reg.agents)) {
      if (a.archived) continue;
      if (id === reg.godId) continue;        // god is never archived
      if (ptyForAgent(id)) continue;         // has a live PTY → genuinely active
      hive.setArchived(id, true);            // stale archived:false orphan → archive
      console.log('[migration] archived orphaned agent (no live PTY):', id);
    }
  } catch (e) {
    console.error('[migration] archiveOrphanedAgents failed:', e);
  }
}

/** The standup fires every time the office opens (owner, 2026-09-25): once per
 *  launch, as soon as Michael is up, including a brand-new office right after
 *  setup. The hourly timer then restarts from this fire, so the next one comes an
 *  hour later. Only when the standup is on and runs on an interval; a standup the
 *  owner moved to weekly slots or timing lines keeps to its slots. Michael
 *  starting again later in the same launch doesn't fire it again. */
let standupFiredThisLaunch = false;

/** Office open (src/shared/officeOpen.ts): read once per launch from the log,
 *  then each agent is told as it starts. Per agent, not a broadcast, because
 *  at launch every team member is archived until its terminal spawns and a
 *  broadcast skips archived agents. */
let officeClosedAtLaunch: boolean | null = null;
const toldOfficeOpen = new Set<string>();
function tellOfficeOpen(agentId: string): void {
  try {
    if (!hive.enabled()) return;
    if (officeClosedAtLaunch === null) officeClosedAtLaunch = officeClosedInLog(hive.logTail(5000));
    if (!officeClosedAtLaunch || toldOfficeOpen.has(agentId)) return;
    const a = hive.registry().agents[agentId];
    if (!a || a.isAssistant) return;
    toldOfficeOpen.add(agentId);
    hive.send({ to: agentId, act: 'inform', subject: OFFICE_OPEN_SUBJECT, body: officeOpenBody() }, 'human');
  } catch (e) {
    console.error('[office-open]', e);
  }
}
/** Once a launch, when Michael starts (docs/designs/card-lifecycle.md section
 *  5): an answer the owner gave through Ask me on a card not yet done whose
 *  request never reached Michael (a send that failed, the app quitting) is sent
 *  to him now. Only answers the app recorded count, word for word; an answer
 *  already on a card before the app kept that record is not relayed as the
 *  owner's, and Michael sees that card on his Blocked with nothing asked list
 *  (security review, ship 2026-10-03). */
let ownerCatchUpDone = false;
function catchUpOwnerAnswers(): void {
  if (ownerCatchUpDone || !hive.enabled()) return;
  try {
    const recorded = new Set(readConfig().ownerAnswerKeys ?? []);
    for (const m of catchUpRequests(hive.ownerAnswersWithoutRequest(), recorded, hive.registry().agents, answerDigest)) {
      hive.send({ to: m.to, act: m.act, subject: m.subject, body: m.body, conversation: m.conversation, requires_reply: true }, 'human');
    }
    hive.refreshOwnerRequests();
    // Done only once the sweep finished: a failure retries on the next call,
    // and an answer already re-sent has its request now, so it is not sent
    // twice (Codex adversarial review, 2026-10-05).
    ownerCatchUpDone = true;
  } catch (e) {
    console.error('[owner answers catch-up]', e);
  }
}

function standupOnOfficeOpen(): void {
  if (standupFiredThisLaunch || !hive.enabled()) return;
  const m = (readConfig().missions ?? []).find((x) => x.id === OPS_STANDUP_MISSION.id);
  if (!m || !m.enabled || normalizeTimes(m.times) || normalizeWeekly(m.weekly) || !(m.intervalMs > 0)) return;
  standupFiredThisLaunch = true;
  try {
    hive.send({ to: m.to, act: 'inform', subject: m.label, body: scheduledRunBody(m.label, m.body, m.focus) }, 'scheduler');
    const next = (readConfig().missions ?? []).map((x) => (x.id === m.id ? { ...x, lastFiredAt: Date.now() } : x));
    writeConfig({ missions: next });
    try { liveWebContents()?.send('missions:updated'); } catch { /* window gone */ }
    syncMissions();
  } catch (e) {
    console.error('[scheduler] standup on open', e);
  }
}

/** One-time: schedules move to per-agent ownership. Every "everyone" row becomes
 *  Michael's relay job and every row gets a creator (migrateMissions). Nothing is
 *  paused: `archived` is set for every agent without a terminal at boot, so it
 *  says nothing about what the owner wants (eng review R1). */
function migrateMissionOwners(): void {
  // Every load, before the one-time part: cap intervals the timer can't hold.
  const clamped = clampIntervals(readConfig().missions ?? []);
  if (clamped.changed) writeConfig({ missions: clamped.missions });
  const cfg = readConfig();
  if (cfg.missionsOwnersMigrated) return;
  const { missions, changed } = migrateMissions(cfg.missions ?? []);
  writeConfig(changed ? { missions, missionsOwnersMigrated: true } : { missionsOwnersMigrated: true });
}

/** The god agent's id in the hive, for ownership checks ('god' before the hive is up). */
function hiveGodId(): string {
  try { return hive.registry().godId ?? 'god'; } catch { return 'god'; }
}

/** Pause the agent's schedules and flag it closed by the owner. */
function closeAgentByOwner(id: string): { ok: boolean; paused: number } {
  let paused = 0;
  const res = applyMissions((list) => {
    const r = pauseMissionsOf(list, id, hiveGodId());
    paused = r.paused;
    return r.missions;
  });
  try { hive.setClosedByOwner(id, true); } catch (e) { console.error('[hive] setClosedByOwner failed:', e); }
  return { ok: res.ok, paused };
}

/**
 * An agent asked (from its outbox) about one of its schedules. Office
 * management is Michael's (owner, 2026-09-27): a team member's request goes to
 * him to approve or decline, and he passes it to the owner in ASK ME only when
 * the facts can't settle it, sources conflict, or it is sensitive. Michael's
 * own changes apply at once. The return text is the scheduler's reply to the
 * asking agent.
 */
function receiveScheduleRequest(actor: string, payload: unknown, why = ''): string {
  const cfg = readConfig();
  const godId = hiveGodId();
  const op = payload && typeof payload === 'object' ? (payload as { op?: unknown }).op : undefined;
  // Michael deciding a team member's request.
  if (actor === godId && (op === 'approve' || op === 'decline' || op === 'ask-owner' || op === 'pending')) {
    return michaelDecides(payload as { op: string; request?: unknown; note?: unknown });
  }
  // "list" is a question, not a change: answer it directly with the ids an
  // update, pause, resume or delete request needs.
  if (op === 'list') {
    const mine = missionsFor(cfg.missions ?? [], actor, godId);
    return mine.length === 0
      ? 'You have no schedules.'
      : ['Your schedules (id: job):', ...mine.map((m) => `${m.id}: ${m.label}, ${whenWords(m)}${m.enabled ? '' : ' (paused)'}`)].join('\n');
  }
  const built = buildScheduleRequest(actor, payload, cfg.missions ?? [], godId, Date.now(), `sr_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`, why);
  if (!built.ok) return `Schedule request not sent: ${built.reason}`;
  // Michael's own schedules: he manages the office, so the change applies now.
  if (actor === godId) {
    let refused = '';
    const res = applyMissions((list) => {
      const applied = applyScheduleRequest(built.request, list, `m_${Date.now().toString(36)}`);
      if (!applied.ok) { refused = applied.error; return null; }
      return applied.missions.map((m) => (m.id === applied.missionId ? { ...m, approvedBy: 'michael' as const } : m));
    });
    if (refused || !res.ok) return `Schedule not changed: ${refused || (!res.ok ? res.error : '')}.`;
    return `Done: ${requestSummary(built.request, cfg.missions ?? [])}.`;
  }
  // A request about a job this agent already has waiting joins it as one
  // (owner, 2026-09-27).
  const before = cfg.scheduleRequests ?? [];
  const filed = fileScheduleRequest(before, built.request, cfg.missions ?? []);
  const joined = filed.length === before.length;
  const request = filed.find((r) => r.id === built.request.id) ?? built.request;
  writeConfig({ scheduleRequests: filed.map((r) => (r.id === request.id ? { ...r, sentToMichael: true, sentToMichaelAt: Date.now() } : r)) });
  try { liveWebContents()?.send('scheduleRequests:updated'); } catch { /* window gone */ }
  tellMichaelAboutRequest(request, cfg.missions ?? []);
  return joined
    ? 'This joins or replaces your earlier request about the same job, and Michael decides it as one. Nothing changes until he does; you will get a message either way.'
    : 'Sent to Michael to decide. Nothing changes until he does; you will get a message either way.';
}

/** Michael hears about a team member's request, with how to decide it. */
function tellMichaelAboutRequest(req: ScheduleRequest, missions: ScheduledMission[]): void {
  if (!hive.enabled()) return;
  let name = req.agentId;
  try { name = hive.registry().agents[req.agentId]?.name?.trim() || name; } catch { /* keep the id */ }
  hive.send({
    to: hiveGodId(), act: 'request',
    subject: `Schedule request from ${name}`,
    body: [
      `${name} asks to ${requestSummary(req, missions)}.${req.reason ? ` Why: ${req.reason}` : ''}`,
      `Request id: ${req.id}. You decide it: send the scheduler {"op": "approve", "request": "${req.id}"} or {"op": "decline", "request": "${req.id}", "note": "why"}.`,
      `Pass it to the owner only when the facts can't settle it, sources conflict, or it is sensitive: {"op": "ask-owner", "request": "${req.id}", "note": "what you can't settle"}.`
    ].join('\n')
  }, 'scheduler');
}

/** How long Michael has to decide a request before it goes to the owner. */
const MICHAEL_DECIDES_WITHIN_MS = 12 * 60 * 60 * 1000;

/**
 * Keep every waiting schedule request moving: one Michael hasn't heard about
 * (filed before he decided them) is offered to him once, and one he hasn't
 * decided within MICHAEL_DECIDES_WITHIN_MS goes to the owner in ASK ME, so no
 * request is stranded (pre-landing review, 2026-09-27). Runs at launch and
 * every half hour.
 */
function sweepScheduleRequests(now = Date.now()): void {
  const cfg = readConfig();
  const before = cfg.scheduleRequests ?? [];
  const pending = foldScheduleRequests(before, cfg.missions ?? []);
  const fresh = pending.filter((r) => !r.escalated && !r.sentToMichael);
  const overdue = pending.filter((r) => !r.escalated && r.sentToMichael && now - (r.sentToMichaelAt ?? r.createdAt) > MICHAEL_DECIDES_WITHIN_MS);
  if (!fresh.length && !overdue.length) {
    if (pending.length !== before.length) writeConfig({ scheduleRequests: pending });
    return;
  }
  for (const r of fresh) tellMichaelAboutRequest(r, cfg.missions ?? []);
  const note = `${michaelName()} did not decide this within 12 hours.`;
  writeConfig({
    scheduleRequests: pending.map((r) => {
      if (fresh.includes(r)) return { ...r, sentToMichael: true, sentToMichaelAt: now };
      if (overdue.includes(r)) return { ...r, escalated: true, escalation: note };
      return r;
    })
  });
  try { liveWebContents()?.send('scheduleRequests:updated'); } catch { /* window gone */ }
  if (overdue.length) ownerToast(michaelName(), `${overdue.length === 1 ? 'A schedule change needs' : `${overdue.length} schedule changes need`} you in ASK ME.`);
}
let scheduleSweepTimer: NodeJS.Timeout | null = null;

/** Michael's answer to a request: approve, decline, pass it to the owner, or
 *  list what is waiting. */
function michaelDecides(p: { op: string; request?: unknown; note?: unknown }): string {
  const cfg = readConfig();
  const pending = cfg.scheduleRequests ?? [];
  if (p.op === 'pending') {
    const open = pending.filter((r) => !r.escalated);
    return open.length
      ? ['Schedule requests waiting for you (id: request):', ...open.map((r) => `${r.id}: ${requestSummary(r, cfg.missions ?? [])}`)].join('\n')
      : 'No schedule requests are waiting for you.';
  }
  const id = typeof p.request === 'string' ? p.request : '';
  const note = typeof p.note === 'string' ? p.note.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  const req = pending.find((r) => r.id === id);
  if (!req) return 'No waiting request has that id: it may have been decided, or joined with a newer one. Send {"op": "pending"} to see what is waiting.';
  // Once it is with the owner it is theirs to decide.
  if (req.escalated) return 'That request is with the owner in ASK ME now; you will hear when they decide.';
  if (p.op === 'ask-owner') {
    if (!note) return 'Add a "note" saying what you can\'t settle, for the owner\'s card.';
    writeConfig({ scheduleRequests: pending.map((r) => (r.id === id ? { ...r, escalated: true, escalation: note } : r)) });
    try { liveWebContents()?.send('scheduleRequests:updated'); } catch { /* window gone */ }
    let name = 'A team member';
    try { name = hive.registry().agents[req.agentId]?.name?.trim() || name; } catch { /* keep the fallback */ }
    // Only Michael notifies the owner (docs/designs/michael-only-notifications.md).
    ownerToast(michaelName(), `${name}'s schedule change needs you in ASK ME.`);
    return 'Passed to the owner in ASK ME. You will hear when they decide.';
  }
  const res = decideScheduleRequest(id, p.op === 'approve', 'michael', note);
  if (!res.ok) {
    return res.error === 'stale'
      ? 'That schedule changed since the request was made, so it can\'t be applied. Decline it and ask the team member to send a new one.'
      : `Not applied: ${res.error}.`;
  }
  return p.op === 'approve' ? 'Approved and in place.' : 'Declined. Nothing changed.';
}

/** A request was approved or declined, by Michael or by the owner in ASK ME.
 *  Approval applies exactly that one change; a request whose schedule changed
 *  since it was asked is refused. The asking agent is told either way. */
function decideScheduleRequest(id: string, approve: boolean, by: 'owner' | 'michael' = 'owner', note = ''): { ok: true } | { ok: false; error: string } {
  const cfg = readConfig();
  const req = (cfg.scheduleRequests ?? []).find((r) => r.id === id);
  if (!req) return { ok: false, error: 'not found' };
  // Name the schedule before the change: after an approved delete it's gone.
  const described = requestSummary(req, cfg.missions ?? []);
  if (approve) {
    let refused = '';
    // Apply against the list as it is when written (applyMissions reads it fresh).
    const res = applyMissions((list) => {
      const applied = applyScheduleRequest(req, list, `m_${Date.now().toString(36)}`);
      if (!applied.ok) { refused = applied.error; return null; }
      return applied.missions.map((m) => (m.id === applied.missionId ? { ...m, approvedBy: by } : m));
    });
    if (refused) return { ok: false, error: refused };
    if (!res.ok) return res;
  }
  writeConfig({ scheduleRequests: (readConfig().scheduleRequests ?? []).filter((r) => r.id !== id) });
  try { liveWebContents()?.send('scheduleRequests:updated'); } catch { /* window gone */ }
  if (hive.enabled()) {
    const who = by === 'michael' ? michaelName() : 'The owner';
    hive.send({
      to: req.agentId, act: 'inform',
      subject: approve ? 'Schedule change approved' : 'Schedule change declined',
      body: `${who} ${approve ? 'approved' : 'declined'}: ${described}. ${approve ? 'It is in place now.' : 'Nothing changed.'}${note ? ` Note: ${note}` : ''}`
    }, 'scheduler');
    // The owner decided one Michael passed on: he hears the outcome too.
    if (by === 'owner' && req.escalated) {
      hive.send({ to: hiveGodId(), act: 'inform', subject: `Owner ${approve ? 'approved' : 'declined'} a schedule change`, body: `${described}.` }, 'scheduler');
    }
  }
  return { ok: true };
}



/** One-time migration: ensure the built-in hourly ops standup exists for installs
 *  that predate it. Guarded by `opsStandupSeeded` so a user who later deletes the
 *  mission doesn't get it re-added on every boot. Stamps lastFiredAt = now so the
 *  interval timer doesn't also fire it at launch: the launch standup is sent
 *  once Michael is up (standupOnOfficeOpen). */
function ensureDefaultMissions(): void {
  const cfg = readConfig();
  if (!cfg.opsStandupSeeded) {
    const missions = cfg.missions ?? [];
    const has = missions.some((m) => m.id === OPS_STANDUP_MISSION.id);
    writeConfig({
      missions: has ? missions : [...missions, { ...OPS_STANDUP_MISSION, lastFiredAt: Date.now() }],
      opsStandupSeeded: true
    });
  }
  // Seed the built-in heartbeat (Lane A #1) once. Shipped DISABLED, so it just
  // appears in the SCHEDULES panel for the user to turn on; lastFiredAt = now so
  // it doesn't fire on the very first launch after a user enables it.
  const cfg2 = readConfig();
  if (!cfg2.heartbeatSeeded) {
    const missions = cfg2.missions ?? [];
    const has = missions.some((m) => m.id === HEARTBEAT_MISSION.id);
    writeConfig({
      missions: has ? missions : [...missions, { ...HEARTBEAT_MISSION, lastFiredAt: Date.now() }],
      heartbeatSeeded: true
    });
  }

  // maint-1 RETIREMENT: `compact-maintenance` is no longer a mission. Scheduled
  // compaction is now the CONTEXT TRIGGER's job, so the operator has exactly one
  // control (a cadence + a pressure gate + an editable message) instead of two
  // that could disagree — a mission saying "hourly" while the trigger said "2h"
  // was a real, unresolvable conflict.
  //
  // The carry-over preserves the operator's decisions: whether compaction was ON
  // and how often. It runs at most once per install, and its guard is the
  // mission's own ABSENCE — nothing seeds `compact-maintenance` any more, so once
  // this has removed it there is nothing left to carry and a later hand-edit of
  // the trigger can never be clobbered. That keeps the `*Seeded` convention's
  // promise (exactly once, ever) without a config flag that would only ever be
  // read here; `compactMaintenanceSeeded` is left set so nothing re-seeds it.
  const cfg3 = readConfig();
  const missions3 = cfg3.missions ?? [];
  const retiring = missions3.find((m) => m.id === COMPACT_MAINTENANCE_MISSION.id);
  if (retiring) {
    const current = cfg3.contextTrigger ?? DEFAULT_CONTEXT_TRIGGER;
    writeConfig({
      missions: missions3.filter((m) => m.id !== COMPACT_MAINTENANCE_MISSION.id),
      contextTrigger: {
        ...current,
        compact: {
          ...current.compact,
          enabled: retiring.enabled,
          // A hand-tuned interval is a decision; only a missing/absurd one falls
          // back to whatever the trigger already carries.
          everyMs: retiring.intervalMs > 0 ? retiring.intervalMs : current.compact.everyMs
        }
      },
      compactMaintenanceSeeded: true
    });
    // …and its elapsed time, so retiring the mission mid-cycle doesn't restart a
    // 2h cadence from zero (the timers honour last-run exactly as arming did).
    if (typeof retiring.lastFiredAt === 'number' && retiring.lastFiredAt > 0) {
      const map = contextRunMap();
      map.compact = retiring.lastFiredAt;
      try { persist.setKv(CONTEXT_LAST_RUN_KV_KEY, map); } catch { /* DB best-effort */ }
    }
    console.log('[triggers] retired the compact-maintenance mission into contextTrigger.compact',
      `(enabled: ${retiring.enabled}, everyMs: ${retiring.intervalMs})`);
  }

  // autoCompact RETIREMENT: the flag above was only ever half-removed. Retiring
  // `compact-maintenance` left `autoCompact: true` sitting on the ops standup, so
  // a default install still asked for compaction on TWO cadences — hourly from the
  // standup, 2-hourly from the trigger — which is precisely the disagreement that
  // retirement claims to have ended. (config.ts even documented a migration that
  // strips this; it did not exist.)
  //
  // Strip it wherever it survives. This is a pure de-duplication, not a behaviour
  // change: contextTrigger.compact still runs, still on the user's own cadence and
  // pressure gate, and it is what actually performed every one of these
  // compactions already — both paths have called the context trigger since Triggers
  // landed. Idempotent, so it costs one no-op scan per boot once clean.
  const cfg4 = readConfig();
  const missions4 = cfg4.missions ?? [];
  if (missions4.some((m) => m.autoCompact)) {
    writeConfig({
      missions: missions4.map(({ autoCompact, ...rest }) => {
        void autoCompact;
        return rest;
      })
    });
    console.log('[triggers] dropped the legacy per-mission autoCompact flag —',
      'contextTrigger.compact is now the only schedule that compacts');
  }

  // The standup used to tell Michael each agent would be asked to summarise and
  // compact. Agents get no instructions about compaction (owner, 2026-09-25), so
  // an office still carrying that exact text gets the current one. Text the
  // owner edited is theirs and stays. Idempotent.
  const cfg5 = readConfig();
  const missions5 = cfg5.missions ?? [];
  if (missions5.some((m) => m.id === OPS_STANDUP_MISSION.id && OPS_STANDUP_BUILT_IN_BODIES.includes(m.body))) {
    writeConfig({
      missions: missions5.map((m) =>
        m.id === OPS_STANDUP_MISSION.id && OPS_STANDUP_BUILT_IN_BODIES.includes(m.body) ? { ...m, body: OPS_STANDUP_MISSION.body } : m)
    });
  }
  // The standup's focus area (schedule-focus-areas.md F6), in one pass. Once,
  // for offices made before focus areas, a standup with no focus and no prompt
  // of the owner's gets the built-in one; and a standup still carrying an
  // earlier built-in focus word for word gets the current one. The owner's own
  // text is never replaced.
  const cfg6 = readConfig();
  const seed = !cfg6.standupFocusSeeded;
  const standupFocus = (m: ScheduledMission): ScheduledMission => {
    if (m.id !== OPS_STANDUP_MISSION.id) return m;
    if (seed && !m.focus && !(m.body ?? '').trim()) return { ...m, focus: OPS_STANDUP_FOCUS };
    return m.focus && OPS_STANDUP_BUILT_IN_FOCUSES.includes(m.focus) ? { ...m, focus: OPS_STANDUP_FOCUS } : m;
  };
  const before = cfg6.missions ?? [];
  const after = before.map(standupFocus);
  if (seed || after.some((m, i) => m !== before[i])) {
    writeConfig({ missions: after, ...(seed ? { standupFocusSeeded: true } : {}) });
  }
}

// ─── Heartbeat (Lane A #1) + circuit-breaker beat (#6.6b) ────────────────────

/** Is the floor quiet? Derived ONLY from signals the main process owns or can
 *  stat — log.jsonl mtime (the master signal: every routed msg/drain/spawn/task
 *  append touches it), each agent's inbox + outbox/.sent mtimes, and every live
 *  PTY's lastOutputAt (an agent printing/thinking counts as activity). Crucially
 *  NOT registry.status, which is written 'idle' once at spawn and never
 *  transitions in main — reading it would see the floor quiet forever. */
function isFloorQuiet(thresholdMs: number): boolean {
  const root = hive.root();
  if (!root) return false;
  const times: number[] = [];
  const pushMtime = (p: string): void => { try { times.push(statSync(p).mtimeMs); } catch { /* missing */ } };
  pushMtime(join(root, 'log.jsonl'));
  const agentsDir = join(root, 'agents');
  if (existsSync(agentsDir)) {
    for (const id of readdirSync(agentsDir)) {
      pushMtime(join(agentsDir, id, 'inbox'));
      pushMtime(join(agentsDir, id, 'outbox', '.sent'));
    }
  }
  for (const t of ptyManager.list()) times.push(t.lastOutputAt);
  if (times.length === 0) return false; // nothing to judge → don't fire
  return Date.now() - Math.max(...times) > thresholdMs;
}

/** Newest coordination-file mtime for one agent (inbox + inbox/.done, outbox +
 *  outbox/.sent, memory.md) — FILES only, deliberately excluding PTY output, so
 *  "no-progress" means "not coordinating" even while the agent is busy printing
 *  tokens. inbox/.done and the outbox dir count because handling mail (moving a
 *  message to .done, drafting an outbox message) IS coordination — without them
 *  an inbox-ack turn reads as no-progress (issue #109's second trigger). */
function lastCoordinationAt(agentId: string): number {
  const root = hive.root();
  if (!root) return 0;
  const times: number[] = [0];
  const pushMtime = (p: string): void => { try { times.push(statSync(p).mtimeMs); } catch { /* missing */ } };
  const dir = join(root, 'agents', agentId);
  pushMtime(join(dir, 'inbox'));
  pushMtime(join(dir, 'inbox', '.done'));
  pushMtime(join(dir, 'outbox'));
  pushMtime(join(dir, 'outbox', '.sent'));
  pushMtime(join(dir, 'memory.md'));
  return Math.max(...times);
}

/** Newest mtime of the agent's OWN WORKING DIRECTORY — the work
 *  `lastCoordinationAt` cannot see. 0 when there is nothing to read.
 *
 *  Provider neutral by construction: `cwd` is the agent's registry entry, the
 *  same field every supported CLI is spawned into, and none of the paths below
 *  is specific to any one of them. An agent whose `cwd` is not a git checkout
 *  simply falls back to the directory's own mtime; an agent with no `cwd` at
 *  all returns 0 and behaves exactly as it does today.
 *
 *  Cheap by construction: a handful of `stat` calls on fixed paths, never a
 *  directory walk. This runs for every agent on every beat, and a working
 *  directory can hold hundreds of thousands of files. Git is what makes it
 *  affordable — each of these is rewritten by ordinary work:
 *
 *    cwd                  a file or directory added or removed at the top level
 *    .git/index           any `git add`, `git status`, `git checkout`
 *    .git/logs/HEAD       the reflog: commit, checkout, reset, merge, rebase
 *    .git/FETCH_HEAD      fetch and pull
 *    .git/packed-refs     and `.git/refs/remotes`: a push updating a tracking ref
 *
 *  Its honest limit: editing a file deep in the tree while running no git
 *  command moves none of these. That case is already covered by the breaker's
 *  own distinct-tool clock, so the two signals are complementary rather than
 *  redundant — this one exists for the window where tool events do not reach
 *  the breaker but the work is unmistakably real.
 */
function lastWorkAt(agentId: string): number {
  const cwd = hive.registry().agents[agentId]?.cwd;
  if (!cwd) return 0;
  const times: number[] = [0];
  const pushMtime = (p: string): void => { try { times.push(statSync(p).mtimeMs); } catch { /* missing */ } };
  pushMtime(cwd);
  const git = join(cwd, '.git');
  pushMtime(join(git, 'index'));
  pushMtime(join(git, 'logs', 'HEAD'));
  pushMtime(join(git, 'FETCH_HEAD'));
  pushMtime(join(git, 'refs', 'remotes'));
  pushMtime(join(git, 'packed-refs'));
  return Math.max(...times);
}

/** PTY id owning a given agent id, or undefined. */
function ptyForAgent(agentId: string): string | undefined {
  for (const [ptyId, a] of ptyToAgent) if (a === agentId) return ptyId;
  return undefined;
}

/** "Stuck" = some worker's PTY is actively printing (recent output) while its
 *  coordination files have gone stale — working-but-not-coordinating. Tightens
 *  the heartbeat cadence so we notice a wedged agent sooner. */
function looksStuck(windowMs: number): boolean {
  const reg = hive.registry();
  const now = Date.now();
  for (const [id, a] of Object.entries(reg.agents)) {
    if (a.archived || id === reg.godId) continue;
    const ptyId = ptyForAgent(id);
    if (!ptyId) continue;
    const idle = ptyManager.idleFor(ptyId) ?? Infinity;
    if (idle < 15_000 && now - lastCoordinationAt(id) > windowMs) return true;
  }
  return false;
}

/** Bounded digest for god — paths + counts, never full files (reference-passing,
 *  #6.2). A few hundred tokens at most. */
function buildHeartbeatDigest(quietMs: number, actionable = 0): string {
  const reg = hive.registry();
  const active = Object.entries(reg.agents).filter(([id, a]) => !a.archived && id !== reg.godId);
  const names = active.map(([, a]) => a.name).join(', ') || '—';
  const boardHead = hive.board().split('\n').slice(0, 10).join('\n').trim();
  const log = hive.logTail(8).map((e) => { try { return JSON.stringify(e); } catch { return ''; } }).filter(Boolean).join('\n');
  const withInbox = active.filter(([id]) => hive.inbox(id).length > 0).map(([, a]) => a.name);
  // When real agent/human mail is waiting, lead with an explicit call-to-action
  // instead of the "quiet" line — this beat fired BECAUSE of unread actionable
  // inbox, not because the floor went quiet, and god must read it now.
  const header = actionable > 0
    ? `Floor heartbeat — ${actionable} actionable inbox message(s) awaiting you (worker/human mail). Drain your inbox NOW and act on them.`
    : `Floor heartbeat — quiet ~${Math.round(quietMs / 60000)}m.`;
  return [
    header,
    `Active agents (${active.length}): ${names}.`,
    withInbox.length ? `Undrained inbox: ${withInbox.join(', ')}.` : 'No undrained inboxes.',
    '',
    'Board (head):',
    boardHead || '(empty)',
    '',
    'Recent log:',
    log || '(none)',
    '',
    'Re-engage anyone stalled or blocked and keep the board accurate — or rest if the work is genuinely done.'
  ].join('\n');
}

/** Senders whose mail is the scheduler's OWN noise (heartbeat beats, ops-standup
 *  via 'scheduler', breaker steers, generic 'system') — never a reason to wake
 *  god. Everything else (a worker agent id, 'webhook', a human reply) is real
 *  mail god must act on. Kept narrow so any future real sender counts by default. */
const SYSTEM_SENDERS = new Set(['heartbeat', 'scheduler', 'breaker', 'system']);

/** Count of UNREAD actionable messages in god's inbox — real agent/human mail,
 *  excluding the scheduler's own beats. Drives an inbox-aware re-engage so a
 *  worker's reply (or a human answer) doesn't sit unread while the floor is busy:
 *  the floor-quiet gate alone misses that case — any active agent keeps the floor
 *  "loud", so god was never re-engaged until everything else went idle. */
function godActionableInboxCount(): number {
  try {
    const godId = hive.registry().godId;
    if (!godId) return 0;
    return hive.inbox(godId).filter((m) => !SYSTEM_SENDERS.has(m.from)).length;
  } catch { return 0; }
}

/** Re-engage a quiet floor: drop a durable digest into god's inbox. We never
 *  type directly into god's PTY here — if he's busy that would jam mid-step. The
 *  inbox message is delivered by the renderer's busy-aware inbox-wake (it nudges
 *  god to read his inbox only once he's idle), so the heartbeat defers around a
 *  working god instead of interrupting him. */
function reengageGod(digest: string): void {
  if (!hive.enabled()) return;
  hive.send({ to: 'god', act: 'request', subject: 'Heartbeat', body: digest }, 'heartbeat');
}

/** Michael's name as the owner knows it (he can be renamed), for toast titles. */
function michaelName(): string {
  try {
    const reg = hive.registry();
    return resolveGodName(reg.agents[reg.godId ?? 'god']?.name);
  } catch {
    return resolveGodName(undefined);
  }
}

/** A native toast for the owner: Michael's word (a breaker stop, a schedule
 *  request) or an app warning, gated on the notifications setting. */
function ownerToast(title: string, body: string): void {
  if (!readConfig().notifications) return;
  try { if (Notification.isSupported()) new Notification({ title, body }).show(); }
  catch { /* unsupported platform */ }
}

// ─── Office break (issue 124) ────────────────────────────────────────────────
// The Claude plan reached its usage limit: the office says so and stops typing
// into Claude terminals, and starts again by itself. Schedules still run on
// time; their jobs wait in the inboxes until the break ends.
// The state and its steps are OfficeBreak's (src/main/officeBreak.ts).
const OFFICE_BREAK_KV_KEY = 'office.break';
const officeBreak = new OfficeBreak({
  load: () => persist.getKv<OfficeBreakState>(OFFICE_BREAK_KV_KEY) ?? null,
  save: (state) => persist.setKv(OFFICE_BREAK_KV_KEY, state)
});
let officeBreakTimer: ReturnType<typeof setTimeout> | null = null;

function breakClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function publishOfficeBreak(): void {
  try { liveWebContents()?.send('office:break', officeBreak.view()); } catch { /* window gone */ }
}

function armOfficeBreak(): void {
  if (officeBreakTimer) clearTimeout(officeBreakTimer);
  officeBreakTimer = null;
  const s = officeBreak.current();
  if (!s) return;
  officeBreakTimer = setTimeout(runOfficeBreakTick, Math.max(1_000, s.due - Date.now()));
  officeBreakTimer.unref?.();
}

/** Team member names for Michael, his own id left out. */
function cutOffNames(ids: string[]): string {
  const reg = hive.registry();
  return ids.filter((id) => id !== reg.godId).map((id) => reg.agents[id]?.name ?? id).join(', ');
}

function onPlanSignal(signal: PlanSignal): void {
  if (!onClaudePlan(signal.agentId)) return;
  if (signal.kind === 'limits') {
    if (officeBreak.noteRateLimits(signal.rateLimits)) { armOfficeBreak(); publishOfficeBreak(); }
    return;
  }
  if (signal.kind === 'prompt') { officeBreak.promptSubmitted(signal.agentId); return; }
  if (signal.kind === 'turn') {
    const ended = officeBreak.turnFinished(signal.agentId);
    if (ended) endOfficeBreak(ended);
    return;
  }
  const step = officeBreak.limitReached(signal.agentId);
  const view = officeBreak.view();
  try { hive.appendLog({ kind: 'office-break', step, agentId: signal.agentId, until: view?.until ?? null }); } catch { /* best-effort */ }
  if (step === 'started') {
    ownerToast(michaelName(), view?.until
      ? `The office is on a break. Your Claude plan reached its limit. Work starts again around ${breakClock(view.until)}.`
      : 'The office is on a break. Your Claude plan reached its limit. Work starts again when it resets.');
  }
  armOfficeBreak();
  publishOfficeBreak();
}

/** Whether the agent runs on the Claude plan, whatever the break state. */
function onClaudePlan(agentId: string): boolean {
  try { return (hive.registry().agents[agentId]?.provider ?? 'claude') === 'claude'; } catch { return true; }
}

function runOfficeBreakTick(): void {
  officeBreakTimer = null;
  const r = officeBreak.tick();
  if (!r) { armOfficeBreak(); return; }
  if (r.step === 'over') { endOfficeBreak(r.ended); return; }
  // The reset time has passed: delivery is open again, and Michael's turn on
  // this message shows whether the plan answers.
  const cut = cutOffNames(officeBreak.current()?.cutOff ?? []);
  try {
    if (hive.enabled()) {
      hive.send({
        to: 'god', act: 'inform', subject: 'Usage limit reset',
        body: `The Claude plan's usage limit should have reset, so the office's break may be over. Carry on with what was waiting.${cut ? ` ${cut} stopped mid task when the limit was reached; they are told to carry on once a turn goes through.` : ''}`
      }, 'system');
    }
    hive.appendLog({ kind: 'office-break', step: 'check' });
  } catch (e) { console.error('[office break] check', e); }
  armOfficeBreak();
  publishOfficeBreak();
}

/** The plan answers again: tell the team members who were cut off to carry on
 *  (Michael first), and tell the owner. Schedules were never held: their runs
 *  waited in the inboxes, whose delivery opens again now. */
function endOfficeBreak(ended: OfficeBreakState): void {
  if (officeBreakTimer) clearTimeout(officeBreakTimer);
  officeBreakTimer = null;
  try {
    const reg = hive.registry();
    const godId = reg.godId ?? 'god';
    const cutOff = [...ended.cutOff].sort((a, b) => (a === godId ? -1 : b === godId ? 1 : 0));
    if (hive.enabled()) {
      for (const id of cutOff) {
        hive.send({
          to: id, act: 'inform', subject: 'Usage limit reset',
          body: 'The Claude plan\'s usage limit has reset. Continue the task you were working on when it was reached; do not repeat work that is already done.'
        }, 'system');
      }
    }
    hive.appendLog({ kind: 'office-break', step: 'over', cutOff: cutOff.length });
  } catch (e) { console.error('[office break] end', e); }
  ownerToast(michaelName(), 'The break is over. The team is back at work.');
  publishOfficeBreak();
}

ipcMain.handle('office:breakView', () => officeBreak.view());

/** One circuit-breaker beat: pull a fresh usage sample per active agent, append
 *  it to the durable cost ledger (the SOLE durable cost store), tick the breaker,
 *  emit each BreakerState on control:breakerState (Seam 2), and enforce any
 *  escalation. God is in the LEDGER (cost visibility) but NOT the breaker inputs
 *  (the heartbeat manages god; we never auto-steer/kill the orchestrator). */
function runBreakerBeat(progressWindowMs: number): void {
  if (!hive.enabled()) return;
  const reg = hive.registry();
  const now = Date.now();
  const inputs: BreakerInput[] = [];
  for (const [id, a] of Object.entries(reg.agents)) {
    if (a.archived) continue;
    // #57/#58: skip assistant + orphaned shells. The breaker must only evaluate
    // live, real agents. An assistant entry (e.g. the pre-acc13a3 headless
    // 'Dwight') or any orphaned entry left archived:false with NO live PTY would
    // otherwise be steered, and that steer bounces to GOD as a requires_reply GOD
    // can't clear → inbox flood. ptyForAgent(id) === undefined means no live PTY.
    // God is exempt from this orphan check (it keeps its own flow + the godId skip
    // below) so its ledger row is unaffected. Live real agents always own a PTY
    // (ptyToAgent is set at spawn), so their breaker behavior is unchanged.
    if (a.isAssistant) continue;
    if (id !== reg.godId && !ptyForAgent(id)) continue;
    const sample = usageProvider.getAgentUsage(id);
    // #56: only append a ledger row for a LIVE session sample. A dead/orphaned
    // agent with a frozen transcript still yields a sample via the transcript
    // fallback, but with an EMPTY sessionId (aggregateLive returns null → no live
    // OTel session). Appending it every ~30s rewrote the identical row forever
    // (2,417 dupes observed). A truthy sessionId is set only by a live session
    // (aggregateLive picks the most-recent live session id), so this gates on
    // "is there a live session" without changing any live-agent behavior.
    if (sample?.sessionId) hive.appendCostLedger(sample); // ledger covers everyone incl. god
    // Second source for the resume key. recordSession() is otherwise reachable
    // ONLY from the hook shim, so any window where hooks don't land leaves the
    // registry with no sessionId and "Restart & Continue" refuses to continue —
    // while this very sample proves the app knew the live session id all along
    // (it was already being written to the cost ledger one line above). Same id,
    // same liveness gate; recordSession writes only on change, so this is a
    // no-op once the hooks are flowing.
    if (sample?.sessionId) hive.recordSession(id, sample.sessionId);
    if (id === reg.godId) continue;            // breaker skips god
    // Progress = fresh coordination files OR a recent OTel tool span. The span
    // leg closes the background-work blind spot: subagent/Workflow tool calls
    // never reach the parent session's PostToolUse hook (so the breaker's own
    // distinct-tool clock stays stale) but their spans DO flow through the
    // collector under this agent's id — an idle parent supervising a hard-
    // working background fleet is progressing, not wedged. Observed live: the
    // one residual no-progress false positive after the #109 fixes.
    const spans = telemetry.getSpans(id);
    const lastSpanAt = spans.length ? spans[spans.length - 1].ts : 0;
    inputs.push({
      agentId: id,
      sample,
      progressing: now - lastCoordinationAt(id) < progressWindowMs || now - lastSpanAt < progressWindowMs,
      // Work, as distinct from coordination. The breaker decides what to do
      // with it; the beat only reports it.
      lastWorkAt: lastWorkAt(id)
    });
  }
  for (const d of breaker.tick(inputs, now)) {
    try { liveWebContents()?.send('control:breakerState', d.state); } catch { /* window gone */ }
    if (d.action === 'none') continue;
    const name = reg.agents[d.state.agentId]?.name ?? d.state.agentId;
    const reason = d.state.reason;
    if (d.action === 'steer') {
      hive.send({ to: d.state.agentId, act: 'request', subject: 'Circuit breaker: steer',
        body: `The app noticed a problem with this task (${reason}). If you are repeating yourself or stuck, stop, and send Michael a short summary of what you tried and what you need.` }, 'breaker');
    } else if (d.action === 'constrain') {
      hive.send({ to: d.state.agentId, act: 'request', subject: 'Circuit breaker: constrain',
        body: `The app paused this task (${reason}). Before running more tools, send Michael a short plan of your next step and wait for his go ahead.` }, 'breaker');
      // No toast: a constrain is a soft pause Michael handles (only Michael
      // notifies, docs/designs/michael-only-notifications.md).
    } else if (d.action === 'stop') {
      const ptyId = ptyForAgent(d.state.agentId);
      if (ptyId) { try { ptyManager.kill(ptyId); } catch { /* already gone */ } teardownPty(ptyId); }
      // A stop halts that agent's work, so the owner hears it, from Michael.
      ownerToast(michaelName(), `I stopped ${name}: ${reason}`);
    }
  }
}

/** Lifetime spend, folded from cost-ledger.jsonl. `telemetry`'s usd counter is
 *  cumulative-since-process-start and restarts at ~0 on every app restart, so
 *  it cannot answer "what has this agent cost us". See costLifetime.ts. */
const costTotals = new CostLedgerTotals();

/** Build + write the live fleet snapshot Michael reads (`<hive>/fleet.json`).
 *  Always-on (independent of the heartbeat) since `claude agents` can't see the
 *  hive's sibling sessions. PII-free; never throws (called from a timer). */
function writeFleetSnapshot(): void {
  if (!hive.enabled()) return;
  try {
    const reg = hive.registry();
    const snap = telemetry.snapshot();
    const usageById = new Map(snap.usage.map((u) => [u.agentId, u]));
    const now = Date.now();
    // Async + incremental; returns immediately and never throws into the timer.
    const hiveRoot = hive.root();
    if (hiveRoot) void costTotals.refresh(join(hiveRoot, 'cost-ledger.jsonl'));
    const agents = Object.entries(reg.agents)
      .filter(([, a]) => !a.archived)
      .map(([id, a]) => {
        const u = usageById.get(id);
        const spans = snap.spans[id] ?? [];
        const tokens = u ? u.input + u.output + u.cacheRead + u.cacheCreation : 0;
        // `usd` is LIFETIME (reset-corrected). Until the first fold completes we
        // fall back to the session figure rather than publishing a cold $0.
        const lifetime = costTotals.usdFor(id);
        const sessionUsd = u ? Number(u.usd.toFixed(4)) : 0;
        return {
          id,
          name: a.name,
          role: a.role ?? (a.isGod ? 'orchestrator' : 'agent'),
          cwd: a.cwd,
          isGod: !!a.isGod,
          breaker: breaker.levelFor(id),
          tokens,
          usd: lifetime === null ? sessionUsd : Number(lifetime.toFixed(4)),
          sessionUsd,
          lastTool: spans.length ? spans[spans.length - 1].tool : null,
          lastActiveSecAgo: u ? Math.round((now - u.ts) / 1000) : null,
          inboxBacklog: hive.inboxBacklog(id),
          onHold: !!a.onHold
        };
      });
    hive.writeFleetSnapshot({ ts: now, agents });
  } catch (e) {
    console.error('[fleet] snapshot failed:', e);
  }
}

/** Arm the heartbeat with an adaptive, self-rescheduling cadence (recursive
 *  setTimeout instead of a fixed setInterval). Each beat runs the cost/breaker
 *  pass, re-engages a quiet floor, stamps lastFiredAt, then re-arms: ~base on a
 *  normal beat, base/4 (min 30s) when an agent looks stuck, base*2.5 right after
 *  a re-engage. Registered into missionTimers so shutdown tears it down. */
function armHeartbeat(m: ScheduledMission): void {
  const base = m.intervalMs;
  const quiet = m.quietThresholdMs ?? 300_000;
  const beat = (): void => {
    let next = base;
    try {
      // (the breaker beat + cost ledger now run on their own always-on timer)
      // Re-engage god when the floor is quiet OR when real agent/human mail is
      // waiting in god's inbox — the latter is independent of floor-quiet so a
      // worker's reply doesn't sit unread while other agents keep the floor busy.
      const actionable = godActionableInboxCount();
      if (isFloorQuiet(quiet) || actionable > 0) {
        reengageGod(buildHeartbeatDigest(quiet, actionable));
        next = Math.round(base * 2.5);            // back off after re-engaging
      } else if (looksStuck(quiet)) {
        next = Math.max(30_000, Math.round(base / 4)); // tighten when an agent is wedged
      }
      const cur = readConfig().missions ?? [];
      writeConfig({ missions: cur.map((x) => (x.id === m.id ? { ...x, lastFiredAt: Date.now() } : x)) });
      try { liveWebContents()?.send('missions:updated'); } catch { /* window gone */ }
    } catch (e) {
      console.error('[heartbeat]', e);
    }
    const entry = missionTimers.get(m.id) ?? {};
    entry.timeout = setTimeout(beat, next);
    missionTimers.set(m.id, entry);
  };
  const remaining = Math.max(0, base - (Date.now() - (m.lastFiredAt ?? 0)));
  missionTimers.set(m.id, { timeout: setTimeout(beat, remaining) });
}

/** The live renderer webContents, or null if the window is gone/destroyed.
 *  Anything that emits to the renderer from a timer/socket/child callback must
 *  route through here — during quit the window can be destroyed while those
 *  callbacks are still in flight, and `.send()` on a destroyed webContents
 *  throws "Object has been destroyed" (the main-process crash dialog). */
function liveWebContents(): Electron.WebContents | null {
  const wc = mainWindow?.webContents;
  if (wc && !wc.isDestroyed()) return wc;
  // Primary gone (closed/destroyed): fall back to any other live window so a
  // global event still reaches a renderer instead of being silently dropped.
  for (const w of allWindows) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) return w.webContents;
  }
  return null;
}

// ─── Slack webhook server (Slack message → Michael's queue) ──────────────────
/** The running Slack ingestion server, or null when disabled/stopped. */
let slackServer: SlackWebhookServer | null = null;
/** The loopback-only reply endpoint (lets the bundled helper post back to Slack
 *  without ever seeing the bot token). Lifecycle is tied to `slackServer`. */
let slackReplyServer: SlackReplyServer | null = null;
/** Last public tunnel URL handed out — persisted so Settings can re-show the
 *  Request URL after a reopen (Slack reuses it until the server is stopped). */
let lastSlackUrl: string | undefined;

/** AUTONOMOUS REQUEST PROTOCOL — built PER MESSAGE (not a static const) so it can
 *  embed the request's concrete `channel`, `thread_ts`, and the resolved helper
 *  path. Prepended (server-side, authoritatively) to the working instruction god
 *  reads for any Slack-origin request: there is no interactive human at the
 *  keyboard, so god must route fast, delegate WITH the exact reply command (so the
 *  worker posts its real result back into THIS thread itself), stay autonomous,
 *  and only block on enumerated high-severity actions. Prepended to god's PROMPT
 *  only — the human-facing kanban card TITLE stays the user's raw text (the
 *  renderer keeps them split). Trailing space is intentional so the user's message
 *  reads naturally after it. */
function buildAutonomousRequestProtocol(channel: string, threadTs: string, helperPath: string): string {
  // Slack reply rules ride the Slack request itself, not every agent's startup
  // instructions (owner cleanup, 2026-09-25). Plain, no spawning or git.
  return `[Slack request: nobody is watching the office live, so handle it this way.]
1. Route it straight to the one team member whose role fits, from the roster. When the request names someone ("ask Pam"), send it to them.
2. Tell them to do the work and post the result to this Slack thread themselves when done, with exactly: "${hive.nodeCommand()}" "${helperPath}" --channel ${channel} --thread ${threadTs} --text "<the result>". Use that Node path as it is; plain "node" is often missing.
3. No questions in the office. Only spending money, anything public, or deleting something they did not create needs the owner first.
4. The Slack reply is the real answer in Slack formatting: a short *bold* headline, then the outcome, specifics and links. Never just "done".
5. They then tell you (Michael) what they did.
6. If a decision is needed, post the question with numbered options to the thread with the same command, and record {q, options, askedAt, thread_ts ${threadTs}} so the reply in the thread finds its way back.
The request starts now: `;
}

// ─── Slack done-notifier (Slack-origin task → done → one summary reply) ───────
/** Polls the shared kanban (hive/tasks.json) for Slack-origin tasks that reach
 *  'done' and posts ONE summary reply into the originating thread. Lifecycle is
 *  tied to `slackServer`. OUTBOUND-only: it never touches inbound queue/lanes. */
let slackDoneTimer: ReturnType<typeof setInterval> | null = null;
/** Re-entrancy guard so a slow post can't overlap the next tick. */
let slackDonePolling = false;
/** Task ids already notified — exactly-once across re-reads AND restarts. Lazily
 *  loaded from / persisted to `slackDoneNotifiedPath()`. */
let slackDoneNotified: Set<string> | null = null;
/** Ids already 'done' when the observer started — baselined (never notified) so a
 *  summary only ever fires on a live …→done transition, not on pre-existing dones. */
let slackDoneBaseline: Set<string> | null = null;
/** thread_ts values an agent has ALREADY answered directly via the loopback
 *  `/reply` endpoint. The done-summary poller skips these — the agent's own
 *  substantive reply already landed in-thread, so the poller is a fallback, not a
 *  duplicator (this is what stops the bare/duplicate `:white_check_mark:` posts). */
const directlyRepliedThreads = new Set<string>();

/** Absolute path to the bundled `md-slack-reply.cjs` helper. Packaged: under
 *  `process.resourcesPath` (electron-builder extraResources). Dev: the repo's
 *  `resources/` dir, resolved from the app path. */
function slackReplyScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'md-slack-reply.cjs')
    : join(app.getAppPath(), 'resources', 'md-slack-reply.cjs');
}

/** W3 — the bundled read-only `skills/` source dir copied into each agent's
 *  `.claude/skills/` at spawn. Same packaged/dev resolution as the helpers above.
 *  Tolerated-missing until lp-manifest (Kevin) populates it (the hive copy is a
 *  no-op on an absent dir). */
function skillsResourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'skills')
    : join(app.getAppPath(), 'resources', 'skills');
}

/** The bundled Office Packs (the business types onboarding offers). Same
 *  packaged/dev resolution as `skillsResourceDir()` above — see the
 *  `resources/packs` entry in electron-builder.yml. */
function packsDir(): string {
  return packsResourceDir(app, process.resourcesPath);
}

/** Pack roles that read the books (Oscar in every pack). They may use
 *  QuickBooks, Read only, until the owner chooses (owner, 2026-09-29). Read
 *  once: the bundled packs don't change while the app runs. */
let booksReaders: Set<string> | undefined;
function booksReadRoleIds(): Set<string> {
  if (booksReaders) return booksReaders;
  const ids = new Set<string>();
  try {
    for (const { pack } of loadBundledPacks({ packsDir }).packs) {
      for (const role of pack.agents) if (levelFor(role, 'books.read') !== 'off') ids.add(role.id);
    }
  } catch (e) { console.error('[quickbooks] pack roles:', e); }
  booksReaders = ids;
  return ids;
}

/** Job titles (lowercased) of pack roles that read the books. Read once:
 *  the bundled packs don't change while the app runs. */
let booksReadTitles: Set<string> | undefined;
function booksReadRoleTitles(): Set<string> {
  if (booksReadTitles) return booksReadTitles;
  const titles = new Set<string>();
  try {
    for (const { pack } of loadBundledPacks({ packsDir }).packs) {
      for (const role of pack.agents) {
        if (levelFor(role, 'books.read') !== 'off') titles.add(role.role.trim().toLowerCase());
      }
    }
  } catch (e) { console.error('[quickbooks] pack role titles:', e); }
  booksReadTitles = titles;
  return titles;
}

/** QuickBooks on + Read-only default, based on the agent's role — not the agent id.
 *  `booksReadRoleIds()` holds pack role *ids* (e.g. `oscar`), but a hired agent gets
 *  a fresh agent id, so a bookkeeper hired later never matched and started with
 *  QuickBooks off. Match the hire's job title against the pack roles instead. */
function agentHasBooksRead(agentId: string): boolean {
  // Back-compat: an agent whose id literally is a books role id (the original oscar).
  if (booksReadRoleIds().has(agentId)) return true;
  let title = '';
  try { title = (hive.registry().agents[agentId]?.role ?? '').split(': ')[0].trim().toLowerCase(); }
  catch { /* no hive yet */ }
  return !!title && booksReadRoleTitles().has(title);
}

/** The agent-facing `doc-text` CLI, built beside index.js (inside the asar when
 *  packaged). Agents run it with the bundled Node to read Word/Excel/PowerPoint. */
function docTextCliPath(): string {
  return join(app.getAppPath(), 'out', 'main', 'docTextCli.js');
}

/** Michael's folder (the business folder), created if the owner deleted it
 *  rather than failing every spawn that depends on it. Undefined on installs
 *  that predate agent folders, which keep today's layout. An office set up
 *  before 2026-09-25 recorded only its Office folder; launch fills
 *  businessFolder from it (migrateBusinessFolder), and until then its parent is
 *  used here. */
function businessFolderReady(): string | undefined {
  const cfg = readConfig();
  const folder = cfg.businessFolder ?? legacyBusinessFolder(cfg.officeFolder);
  if (!folder) return undefined;
  const r = ensureFolder(expandTilde(folder));
  return r.ok ? r.path : undefined;
}

/** One-time at launch: an office set up before 2026-09-25 recorded its shared
 *  Office folder; Michael's folder is the one holding it. Nothing moves on
 *  disk: the Office folder becomes an ordinary folder inside Michael's. A parent
 *  that can't hold an office (the home folder, a system folder) keeps Michael
 *  in the Office folder itself. Also switches the knowledge feature on once,
 *  now that it is where company knowledge lives. */
function migrateBusinessFolder(): void {
  const cfg = readConfig();
  if (!cfg.businessFolder && cfg.officeFolder) {
    const office = expandTilde(cfg.officeFolder);
    const parent = legacyBusinessFolder(office);
    writeConfig({ businessFolder: parent && isUsableTeamFolder(parent) ? parent : office });
  }
  if (!readConfig().knowledgeOnSeeded) {
    writeConfig({ knowledgeGraph: { ...(readConfig().knowledgeGraph ?? {}), enabled: true }, knowledgeOnSeeded: true });
  }
}

/** Every team member's folder and Michael's, for the access rules
 *  (folderAccess.ts): the folders picked at setup plus every hired agent's,
 *  archived ones included (their files are still theirs). */
/** An office without a business folder keeps no team folders apart, and its
 *  shell commands are not held to the sandbox, as before; only the app's
 *  private folder is closed to every agent (issue #63). */
function privateOnlyFolderPolicy(isGod: boolean, cwd: string): AgentFolderPolicy | undefined {
  const home = readConfig().harnessHome;
  if (!home) return undefined;
  const layout = folderLayoutFor(undefined, [], expandTilde(home));
  return { ...folderPolicy({ isGod, cwd }, layout, process.platform !== 'linux'), sandboxOnly: false };
}

function businessFolderLayout(businessFolder: string): FolderLayout {
  const cfg = readConfig();
  const folders = (cfg.businessTeam ?? []).map((m) => m.folder);
  for (const a of Object.values(hive.registry().agents)) {
    if (!a.isGod && !a.isAssistant && a.cwd) folders.push(a.cwd);
  }
  return folderLayoutFor(businessFolder, folders, cfg.harnessHome ? expandTilde(cfg.harnessHome) : undefined);
}

/** Where the helper discovers `{ port, token }` for the loopback endpoint. Kept
 *  under userData (NOT the git repo, NOT mined into MemPalace). */
function slackReplyConfigPath(): string {
  return join(app.getPath('userData'), 'slack-reply.json');
}

/** Ledger of task ids whose done-summary has already been posted. Ids ONLY — no
 *  secret ever lands here. Under userData (out of the repo, out of MemPalace). */
function slackDoneNotifiedPath(): string {
  return join(app.getPath('userData'), 'slack-done-notified.json');
}

/** Directory where downloaded Slack attachments are saved (out of repo, out of MemPalace). */
function slackFilesDir(): string {
  return join(app.getPath('userData'), 'slack-files');
}

/** Per-file download size cap — reject files larger than 10 MB before writing. */
const SLACK_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Sanitize a Slack filename: keep only the basename, replace non-safe chars,
 *  prefix with a random hex tag to prevent collisions and path-traversal attacks. */
function sanitizeSlackFilename(name: string | undefined, tag: string): string {
  const safe = (typeof name === 'string' && name)
    ? basename(name).replace(/[^\w.\-]/g, '_').replace(/^\.+/, '_').slice(0, 200) || 'file'
    : 'file';
  return `${tag}-${safe}`;
}

/**
 * Download a single Slack private file into slackFilesDir() using the bot token.
 * Returns the local path on success, null on any failure (size limit, network, etc.).
 * The bot token is used only in the Authorization header and is NEVER logged.
 */
function downloadSlackFile(
  file: SlackEventFile,
  botToken: string,
  destDir: string
): Promise<{ path: string; name: string; mimetype: string } | null> {
  return new Promise((resolve) => {
    const tag = randomBytes(4).toString('hex');
    const filename = sanitizeSlackFilename(file.name, tag);
    const destPath = join(destDir, filename);
    const name = file.name ?? filename;
    const mimetype = file.mimetype ?? 'application/octet-stream';

    try {
      mkdirSync(destDir, { recursive: true });
    } catch {
      resolve(null);
      return;
    }

    let urlObj: URL;
    try {
      urlObj = new URL(file.url_private);
    } catch {
      resolve(null);
      return;
    }
    if (urlObj.protocol !== 'https:') { resolve(null); return; }

    const req = httpsRequest(
      { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: 'GET',
        headers: { authorization: `Bearer ${botToken}` } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume(); // drain response body
          resolve(null);
          return;
        }
        let written = 0;
        let aborted = false;
        const stream = createWriteStream(destPath);
        res.on('data', (chunk: Buffer) => {
          if (aborted) return;
          written += chunk.length;
          if (written > SLACK_FILE_MAX_BYTES) {
            aborted = true;
            stream.destroy();
            try { unlinkSync(destPath); } catch { /* best-effort cleanup */ }
            res.destroy();
            resolve(null);
            return;
          }
          stream.write(chunk);
        });
        res.on('end', () => {
          if (aborted) return;
          stream.end(() => resolve({ path: destPath, name, mimetype }));
        });
        res.on('error', () => { stream.destroy(); resolve(null); });
        stream.on('error', () => { res.destroy(); resolve(null); });
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * Download all raw Slack files (up to cap) and return the local-path file list.
 * Failures are silently dropped — a partial list is still useful to the agent.
 */
async function downloadSlackFiles(
  rawFiles: SlackEventFile[],
  botToken: string | undefined
): Promise<{ path: string; name: string; mimetype: string }[]> {
  if (!rawFiles.length || !botToken) return [];
  const destDir = slackFilesDir();
  const results = await Promise.all(
    rawFiles.map((f) => downloadSlackFile(f, botToken, destDir))
  );
  return results.filter((r): r is { path: string; name: string; mimetype: string } => r !== null);
}

function loadSlackDoneNotified(): Set<string> {
  try {
    const arr = JSON.parse(readFileSync(slackDoneNotifiedPath(), 'utf8'));
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch { /* missing/corrupt → start empty */ }
  return new Set();
}

function persistSlackDoneNotified(set: Set<string>): void {
  try { writeFileSync(slackDoneNotifiedPath(), JSON.stringify([...set])); }
  catch (e) { console.error('[slack] could not persist done-notify ledger:', e); }
}

/** Slack `chat.postMessage` errors that are permanent for this config — retrying
 *  can never make them succeed, so a failed post with one of these is recorded
 *  (not retried) to avoid flooding the log every 5s. Anything else is treated as
 *  transient and left to retry. */
const TERMINAL_SLACK_ERRORS = new Set<string>([
  'missing_scope', 'invalid_auth', 'not_authed', 'account_inactive',
  'token_revoked', 'token_expired', 'no_permission', 'channel_not_found',
  'not_in_channel', 'is_archived', 'restricted_action', 'org_login_required',
]);

/** The single in-thread summary for a finished task. Sourced from the task's
 *  result/description (falling back to the title), trimmed Slack-friendly. */
function slackDoneSummary(task: HiveTask): string {
  const body = (task.result ?? task.description ?? '').trim();
  const head = `:white_check_mark: *${task.title}*`;
  const text = body ? `${head}\n\n${body}` : head;
  return text.length > 2800 ? `${text.slice(0, 2799)}…` : text;
}

/** One observation pass over the kanban. Posts a summary for any Slack-origin
 *  task that has newly reached 'done'. Best-effort and self-guarding — it must
 *  never throw into the timer, and the bot token never leaves this function. */
async function pollSlackDoneTasks(): Promise<void> {
  if (slackDonePolling) return;
  const botToken = readConfig().slackBotToken;
  if (!botToken) return; // can't post without the token — nothing to do
  let tasks: HiveTask[];
  try {
    const ledger = hive.tasks() as { tasks?: HiveTask[] };
    tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
  } catch { return; } // unreadable/missing tasks.json → skip this tick

  const notified = slackDoneNotified ?? (slackDoneNotified = loadSlackDoneNotified());

  // First tick seeds the baseline (ids already done) and posts nothing — so we
  // only ever fire on a transition observed live this session.
  if (slackDoneBaseline === null) {
    slackDoneBaseline = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
    return;
  }
  const baseline = slackDoneBaseline;

  slackDonePolling = true;
  try {
    for (const t of tasks) {
      if (t.status !== 'done') continue;
      if (baseline.has(t.id) || notified.has(t.id)) continue; // already handled
      const slack = t.slack;
      if (!slack || !slack.channel || !slack.thread_ts) continue; // non-Slack-origin → leave alone
      // FALLBACK-ONLY: if the agent already posted a DIRECT reply into this thread
      // (loopback /reply), the human has its substantive answer — don't double-post.
      if (directlyRepliedThreads.has(slack.thread_ts)) { notified.add(t.id); persistSlackDoneNotified(notified); continue; }
      // Never post a bare `:white_check_mark: *title*` with no substance: if the card
      // carries neither a result nor a description, there is nothing meaningful to
      // deliver — skip it (still under the FALLBACK contract).
      if (!(t.result ?? t.description ?? '').trim()) { notified.add(t.id); persistSlackDoneNotified(notified); continue; }
      const res = await postSlackReply({
        botToken, channel: slack.channel, thread_ts: slack.thread_ts, text: slackDoneSummary(t)
      });
      if (res.ok) {
        notified.add(t.id);
        persistSlackDoneNotified(notified); // mark-on-success → exactly one delivered reply
      } else if (res.error && TERMINAL_SLACK_ERRORS.has(res.error)) {
        // A permanent config/auth error (e.g. the bot token lacks `chat:write`)
        // will NEVER succeed — record the id so we stop hammering every tick, and
        // log the reason once. Never log the token or message body.
        notified.add(t.id);
        persistSlackDoneNotified(notified);
        console.error('[slack] done-summary post for task', t.id,
          '— giving up (terminal error:', res.error + '). Fix the Slack bot scope/permissions; later tasks post once resolved.');
      } else {
        // Transient (network / rate-limit / unknown) → leave unmarked so a later
        // tick retries. Log the id + error only; never the token or message body.
        console.error('[slack] done-summary post failed for task', t.id, '-', res.error, '(will retry)');
      }
    }
  } finally {
    slackDonePolling = false;
  }
}

/** Begin watching the kanban for Slack-origin done-transitions (idempotent). */
function startSlackDoneObserver(): void {
  if (slackDoneTimer) return;
  slackDoneNotified = loadSlackDoneNotified();
  slackDoneBaseline = null; // re-seed on the first tick of this session
  slackDoneTimer = setInterval(() => { void pollSlackDoneTasks(); }, 5000);
}

/** Stop watching the kanban. Safe to call when not running. */
function stopSlackDoneObserver(): void {
  if (slackDoneTimer) { clearInterval(slackDoneTimer); slackDoneTimer = null; }
  slackDoneBaseline = null;
}

/** Build a SlackWebhookServer from the current config and start it, replacing
 *  any running instance, and return the start result (incl. the public tunnel
 *  URL the user pastes into Slack). No-op + error result when the integration is
 *  disabled or the signing secret is unset. */
async function startSlackServer(): Promise<{ ok: boolean; url?: string; error?: string }> {
  // Hidden in this build (buildFeatures.ts): no listener the owner can't see or stop.
  if (!SHOW_SLACK) return { ok: false, error: 'Slack is not available in this build' };
  const cfg = readConfig();
  if (!cfg.slackEnabled || !cfg.slackSigningSecret) {
    return { ok: false, error: 'slack disabled or missing signing secret' };
  }
  slackServer?.stop();
  slackServer = new SlackWebhookServer({
    port: cfg.slackPort && cfg.slackPort > 0 ? cfg.slackPort : 3847,
    signingSecret: cfg.slackSigningSecret,
    channelId: cfg.slackChannelId,
    // Fires from the HTTP server's event loop (not the IPC thread); route through
    // liveWebContents() so a message arriving during window teardown can't throw.
    // Downloads any file attachments (bot token stays in main; local paths go to IPC).
    onMessage: async (m) => {
      const localFiles = await downloadSlackFiles(
        m._rawFiles ?? [],
        readConfig().slackBotToken
      );
      // `text` stays the user's RAW Slack text → drives the readable kanban card
      // title. `autonomyPreamble` is the authoritative policy block the renderer
      // prepends ONLY to god's working instruction (his PTY prompt), keeping the
      // card title human-facing-clean. Built PER MESSAGE so the AUTONOMOUS REQUEST
      // PROTOCOL carries THIS request's concrete channel, thread_ts, and the
      // resolved helper path — god hands the worker an exact reply command.
      // Server-side so it applies to every session.
      const ipcMsg: { text: string; channel: string; ts: string; thread_ts: string; autonomyPreamble: string; files?: typeof localFiles } = {
        text: m.text, channel: m.channel, ts: m.ts, thread_ts: m.thread_ts,
        autonomyPreamble: buildAutonomousRequestProtocol(m.channel, m.thread_ts, slackReplyScriptPath())
      };
      if (localFiles.length > 0) ipcMsg.files = localFiles;
      try { liveWebContents()?.send('slack:incomingMessage', ipcMsg); }
      catch { /* window torn down */ }
    }
  });
  const res = await slackServer.start();
  // ok:false means the port is not bound (never bound, or closed again after the
  // tunnel failed) → drop the instance.
  if (!res.ok) { slackServer = null; return res; }
  if (res.url) lastSlackUrl = res.url;
  // Bring up the loopback reply endpoint (token-gated, never tunneled) and drop
  // the discovery file for the bundled helper. Best-effort: reply path being
  // unavailable must not sink ingestion.
  await startSlackReplyServer();
  // Begin watching the kanban for Slack-origin tasks that reach 'done', to post
  // their one summary reply in-thread. OUTBOUND-only; never touches ingestion.
  startSlackDoneObserver();
  analytics.trackFeature('slack_trigger');
  return res;
}

/** Start the loopback reply endpoint and write its `{ port, token }` to userData
 *  so `md-slack-reply.cjs` can reach it. The bot token is read lazily from config
 *  at reply time and never written to this file. */
async function startSlackReplyServer(): Promise<void> {
  slackReplyServer?.stop();
  const token = randomBytes(24).toString('hex');
  slackReplyServer = new SlackReplyServer({
    token,
    getBotToken: () => readConfig().slackBotToken,
    // An agent posted a DIRECT substantive reply into this thread → record it so the
    // done-summary poller skips it (the poller is a fallback, not a duplicator).
    onReplied: (thread_ts) => { directlyRepliedThreads.add(thread_ts); }
  });
  const r = await slackReplyServer.start();
  if (!r.ok || r.port === undefined) {
    console.error('[slack] reply endpoint failed to start:', r.error);
    slackReplyServer = null;
    return;
  }
  try {
    writeFileSync(slackReplyConfigPath(), JSON.stringify({ port: r.port, token }), { mode: 0o600 });
  } catch (e) {
    console.error('[slack] could not write reply config:', e);
  }
}

/** Stop and forget the Slack server (+ reply endpoint). Best-effort; safe to call
 *  when not running. The last tunnel URL is retained so Settings keeps showing it. */
function stopSlackServer(): void {
  try { slackServer?.stop(); } catch (e) { console.error('[slack] stop failed:', e); }
  slackServer = null;
  try { slackReplyServer?.stop(); } catch (e) { console.error('[slack] reply stop failed:', e); }
  slackReplyServer = null;
  stopSlackDoneObserver();
  try { if (existsSync(slackReplyConfigPath())) unlinkSync(slackReplyConfigPath()); } catch { /* noop */ }
}

// ─── Generic inbound webhook + status API (multi-endpoint) ───────────────────
/** The running generic-webhook server, or null when disabled/stopped. A PUBLIC
 *  (tunnel-forwarded) surface — secret-gated, unlike the loopback /reply. ONE
 *  server and ONE tunnel serve EVERY configured endpoint; the id in the request
 *  path picks which. Adding a webhook therefore costs no port and no tunnel, and
 *  never disturbs a caller already pointed at another endpoint's URL. */
let webhookServer: WebhookServer | null = null;
/** Last public tunnel URL handed out — retained so Settings can re-show the
 *  endpoint after a reopen (the tunnel rotates it per restart). */
let lastWebhookUrl: string | undefined;

/** Local port the shared server binds to. The port is a property of the SERVER,
 *  not of any one trigger — `webhookPort` stays the (legacy) override. */
const WEBHOOK_DEFAULT_PORT = 3849;

/** The endpoints the operator has switched on. A disabled webhook is not merely
 *  rejected at the door — it is never handed to the server, so its id does not
 *  exist on the wire and its secret is not in memory on the request path. */
function enabledWebhookEndpoints(): WebhookTrigger[] {
  return (readConfig().webhookTriggers ?? []).filter((t) => t.enabled && !!t.secret);
}

/** SHA-256 hex of a capability token. The raw token is returned to the caller
 *  exactly once (the POST response) and never persisted; only this digest lands
 *  on the kanban card, so a GET can match without the raw token ever resting. */
function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** tokenHash → id of the `pending` history entry it belongs to.
 *
 *  A message the mode gate held has NO kanban card (the card is what approval
 *  creates), so this map is the only way its caller's GET can be answered — and
 *  answered HONESTLY, as "awaiting-approval" rather than a lie about queued work.
 *  It stores the token's DIGEST, never the token, exactly like the card stamp,
 *  and it is mirrored into the durable kv store so a restart doesn't 404 every
 *  caller that is still politely waiting on the operator. */
let heldWebhookTokens: Map<string, string> | null = null;
const HELD_TOKENS_KV_KEY = 'triggers.webhook.heldTokens';

function heldTokens(): Map<string, string> {
  if (heldWebhookTokens) return heldWebhookTokens;
  let stored: Record<string, string> | undefined;
  try { stored = persist.getKv<Record<string, string>>(HELD_TOKENS_KV_KEY); }
  catch { stored = undefined; }
  const entries = stored && typeof stored === 'object' ? Object.entries(stored) : [];
  heldWebhookTokens = new Map(entries.filter((e): e is [string, string] => typeof e[1] === 'string'));
  return heldWebhookTokens;
}

function persistHeldTokens(): void {
  try { persist.setKv(HELD_TOKENS_KV_KEY, Object.fromEntries(heldTokens())); }
  catch (e) { console.error('[webhook] could not persist held-token map:', e); }
}

/** Drop mappings whose history entry has aged out of the (capped) ledger — the
 *  operator can no longer decide them, so their tokens are dead weight. */
function pruneHeldTokens(): void {
  const map = heldTokens();
  if (map.size === 0) return;
  const live = new Set(listTriggerHistory().map((e) => e.id));
  let changed = false;
  for (const [hash, entryId] of [...map]) {
    if (!live.has(entryId)) { map.delete(hash); changed = true; }
  }
  if (changed) persistHeldTokens();
}

/** The token digest a held history entry was accepted under, if we still have it. */
function heldTokenHashFor(entryId: string): string | undefined {
  for (const [hash, id] of heldTokens()) if (id === entryId) return hash;
  return undefined;
}

/** Tell the Triggers tab its ledger moved, so history live-refreshes instead of
 *  waiting for the operator to re-open the tab. */
function notifyTriggerHistoryUpdated(): void {
  try { liveWebContents()?.send('triggerHistory:updated'); } catch { /* window gone */ }
}

/**
 * Create the stamped kanban card for an inbound message and route it to god.
 *
 * Split out of `handleWebhookMessage` because the APPROVAL path takes exactly
 * this route later — an operator saying yes must produce the same card and the
 * same god request an auto-allowed message would have, or the two paths drift
 * and "approved" quietly means something weaker than "allowed".
 *
 * Returns false only when the card — the thing the caller polls — could not be
 * written. The god routing is best-effort: the card already exists and is
 * pollable even if the send hiccups.
 */
function dispatchWebhookWork(arg: {
  taskId: string;
  title: string;
  message: string;
  /** Stamped onto the card so a GET can match the caller's token. */
  tokenHash?: string;
  /** 'webhook' | 'org' — only for the subject line and the god-facing note. */
  origin: 'webhook' | 'org';
}): boolean {
  try {
    const card: HiveTask = {
      id: arg.taskId,
      title: arg.title,
      description: arg.message,
      status: 'todo',
      dependsOn: [],
      priority: 1,
      createdAt: new Date().toISOString(),
      ...(arg.tokenHash ? { webhook: { tokenHash: arg.tokenHash } } : {})
    };
    // addTask appends against the latest on-disk ledger and is idempotent by task
    // id, so a concurrent card writer (Slack, god, voice, another webhook) can't
    // have its card lost to our stale whole-ledger overwrite. (writeTasks(...existing)
    // recreated exactly that race.) A fresh taskId never collides, so this always adds.
    hive.addTask(card);
  } catch (e) {
    console.error('[webhook] could not create task card:', e instanceof Error ? e.message : e);
    return false;
  }
  // Body carries ONLY the sender's message + the card id (so whoever finishes it
  // updates that card's status/result for the caller's GET) — never the secret,
  // never the raw token.
  try {
    hive.send({
      to: 'god',
      act: 'request',
      subject: `[${arg.origin}] ${arg.title}`,
      body: `${arg.message}\n\n(Inbound via the generic ${arg.origin} API, tracked as kanban card ${arg.taskId}. When this work is finished, set that card's status to 'done' and fill its 'result' so the caller's status check reflects the outcome.)`,
      requires_reply: false
    }, 'webhook');
  } catch (e) {
    console.error('[webhook] could not route to god:', e instanceof Error ? e.message : e);
  }
  return true;
}

/**
 * A verified POST, run through the endpoint's TriggerMode.
 *
 * `isAutoAllowed(mode, kind)` is the whole gate. When it says yes this behaves
 * exactly as the single-endpoint server always did — card, god request, capability
 * token. When it says no NOTHING reaches the hive: the message is written to the
 * ledger as `pending` and sits there until the operator decides, and the caller
 * is handed its token plus a 202 so it can watch the hold rather than believe
 * work started.
 *
 * Either way an `inbound` history row is recorded. The secret never reaches here
 * (the server hands over `{id,name}` only) and no credential is ever written to
 * the ledger.
 */
function handleWebhookMessage(msg: WebhookInbound, endpoint: WebhookEndpointRef): WebhookDispatch | null {
  // 192-bit unguessable token, returned once; only its hash is stored.
  const token = randomBytes(24).toString('hex');
  const tokenHash = hashWebhookToken(token);
  const full = msg.title ?? msg.message;
  const title = full.length > 80 ? `${full.slice(0, 79)}…` : full;

  const trigger = (readConfig().webhookTriggers ?? []).find((t) => t.id === endpoint.id);
  // An endpoint that vanished between the request and this lookup falls back to
  // the STRICTEST mode, never the most permissive one.
  const mode: TriggerMode = trigger?.mode ?? DEFAULT_TRIGGER_MODE;
  // The caller's own declaration wins; `classifyInboundKind` is the conservative
  // guess for callers that don't declare (it leans 'directive' on purpose).
  const kind: InboundKind = msg.kind ?? classifyInboundKind(msg.message);
  const peer = msg.from?.trim() || endpoint.name || endpoint.id;
  // Minted here, not derived from the task id, because a HELD message has no task
  // id yet and must still be pairable with the reply it eventually earns.
  const correlationId = randomBytes(8).toString('hex');

  const base = {
    source: 'webhook' as const,
    sourceId: endpoint.id,
    sourceName: endpoint.name,
    direction: 'inbound' as const,
    peer,
    title,
    body: msg.message,
    kind,
    correlationId
  };

  if (!isAutoAllowed(mode, kind)) {
    const entry = appendTriggerHistory({ ...base, decision: 'pending' });
    heldTokens().set(tokenHash, entry.id);
    persistHeldTokens();
    notifyTriggerHistoryUpdated();
    return { token, pending: true };
  }

  const taskId = `webhook-${randomBytes(8).toString('hex')}`;
  if (!dispatchWebhookWork({ taskId, title, message: msg.message, tokenHash, origin: 'webhook' })) return null;
  appendTriggerHistory({ ...base, decision: 'auto-allowed', taskId });
  notifyTriggerHistoryUpdated();
  return { token, taskId, pending: false };
}

/** Resolve a capability token to its task's public status — scoped to the ONE
 *  card (or the ONE held message) whose stored hash matches; never lists or leaks
 *  any other task. Returns null for any non-match (the server answers 404 either
 *  way, so a probe can't tell "unknown" from "malformed"). */
function lookupWebhookStatus(token: string): WebhookTaskStatus | null {
  const hash = hashWebhookToken(token);

  // Held messages first — they have no card, and the O(1) hit keeps the common
  // "still waiting" poll off the task scan entirely.
  const heldEntryId = heldTokens().get(hash);
  if (heldEntryId) {
    const entry = listTriggerHistory().find((e) => e.id === heldEntryId);
    if (!entry) { heldTokens().delete(hash); persistHeldTokens(); return null; }
    if (entry.decision === 'pending') {
      return { status: 'awaiting-approval', title: entry.title ?? '' };
    }
    if (entry.decision === 'rejected') {
      return { status: 'rejected', title: entry.title ?? '' };
    }
    // Approved: the release stamped this hash onto a real card, so fall through.
  }

  const wanted = Buffer.from(hash);
  let tasks: HiveTask[];
  try {
    const ledger = hive.tasks() as { tasks?: HiveTask[] };
    tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
  } catch { return null; }
  for (const t of tasks) {
    const h = t.webhook?.tokenHash;
    if (!h) continue;
    const have = Buffer.from(h);
    // Both are fixed-length sha-256 hex; compare in constant time defensively.
    if (have.length === wanted.length && timingSafeEqual(have, wanted)) {
      return { status: t.status, title: t.title, result: t.result };
    }
  }
  return null;
}

// ─── Webhook done-observer (the OUTBOUND half of the trigger ledger) ─────────
// Mirrors `pollSlackDoneTasks`: watch the kanban for webhook-origin cards that
// reach 'done' and write the reply side of the conversation, tagged with the
// inbound row's correlationId so the UI can pair request ↔ response.
//
// Unlike the Slack poller there is no "baseline" of already-done ids: the LEDGER
// is the record of what we've already paired, so a card that finished while the
// app was closed still gets its outbound row on the next boot, and re-seeding
// from the ledger makes a duplicate impossible.
let webhookDoneTimer: ReturnType<typeof setInterval> | null = null;
let webhookOutboundRecorded: Set<string> | null = null;

function seedWebhookOutbound(): Set<string> {
  const seen = new Set<string>();
  try {
    for (const e of listTriggerHistory()) {
      if (e.direction === 'outbound' && e.taskId) seen.add(e.taskId);
    }
  } catch { /* unreadable ledger → treat as empty; appends are still deduped by taskId */ }
  return seen;
}

function pollWebhookDoneTasks(): void {
  let tasks: HiveTask[];
  try {
    const ledger = hive.tasks() as { tasks?: HiveTask[] };
    tasks = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
  } catch { return; } // unreadable/missing tasks.json → skip this tick
  const done = tasks.filter((t) =>
    t.status === 'done' && (t.webhook != null || t.id.startsWith('webhook-')));
  if (done.length === 0) return;
  const recorded = webhookOutboundRecorded ?? (webhookOutboundRecorded = seedWebhookOutbound());
  const fresh = done.filter((t) => !recorded.has(t.id));
  if (fresh.length === 0) return;

  const history = listTriggerHistory();
  let wrote = false;
  for (const t of fresh) {
    const inbound = history.find((e) => e.direction === 'inbound' && e.taskId === t.id);
    // No inbound row = a card from before the ledger existed. Nothing to pair it
    // with, so mark it handled rather than writing a half of a conversation.
    if (!inbound) { recorded.add(t.id); continue; }
    appendTriggerHistory({
      source: inbound.source,
      sourceId: inbound.sourceId,
      sourceName: inbound.sourceName,
      direction: 'outbound',
      peer: inbound.peer,
      title: t.title,
      body: (t.result ?? '').trim() || '(finished with no result recorded)',
      kind: inbound.kind,
      correlationId: inbound.correlationId,
      taskId: t.id
    });
    recorded.add(t.id);
    wrote = true;
  }
  if (wrote) notifyTriggerHistoryUpdated();
}

/** Begin watching the kanban for webhook-origin done-transitions (idempotent). */
function startWebhookDoneObserver(): void {
  if (webhookDoneTimer) return;
  webhookOutboundRecorded = seedWebhookOutbound();
  webhookDoneTimer = setInterval(() => {
    try { pollWebhookDoneTasks(); } catch (e) { console.error('[webhook] done-observer:', e); }
  }, 5000);
}

/** Stop watching the kanban. Safe to call when not running. */
function stopWebhookDoneObserver(): void {
  if (webhookDoneTimer) { clearInterval(webhookDoneTimer); webhookDoneTimer = null; }
  webhookOutboundRecorded = null;
}

/** Build the shared WebhookServer from the enabled endpoints and start it. A
 *  server that is already up is RE-POINTED rather than restarted (see
 *  `reconcileWebhookServer`): restarting would mint a fresh tunnel URL and break
 *  every other endpoint's caller. The public tunnel is opened only here — never
 *  on a default; a webhook reaches the wire only once the operator enables it. */
async function startWebhookServer(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const endpoints = enabledWebhookEndpoints();
  if (endpoints.length === 0) return { ok: false, error: 'no enabled webhook endpoints' };
  if (webhookServer) {
    webhookServer.setEndpoints(endpoints);
    return { ok: true, url: webhookServer.publicUrl() ?? lastWebhookUrl };
  }
  pruneHeldTokens();
  const cfg = readConfig();
  const server = new WebhookServer({
    port: cfg.webhookPort && cfg.webhookPort > 0 ? cfg.webhookPort : WEBHOOK_DEFAULT_PORT,
    endpoints,
    onMessage: handleWebhookMessage,
    lookupStatus: lookupWebhookStatus
  });
  webhookServer = server;
  const res = await server.start();
  // ok:false covers BOTH "never bound the port" (fatal → drop the instance) and
  // "bound fine, tunnel unavailable" (the security boundary is live and must stay
  // reachable/stoppable — dropping it there would leak an unstoppable listener).
  if (!res.ok && !server.listening()) { webhookServer = null; return res; }
  analytics.trackFeature('webhook_trigger');
  if (res.url) lastWebhookUrl = res.url;
  startWebhookDoneObserver();
  return res;
}

/** Bring the running server in line with config after any webhook mutation.
 *  Live endpoint swap when it's up, start when the enabled set becomes non-empty,
 *  stop when it empties. Never restarts a healthy server. */
function reconcileWebhookServer(): void {
  const endpoints = enabledWebhookEndpoints();
  if (endpoints.length === 0) { stopWebhookServer(); return; }
  if (webhookServer) { webhookServer.setEndpoints(endpoints); return; }
  void startWebhookServer().then((r) => {
    if (!r.ok) console.error('[webhook] start failed:', r.error);
    else console.log('[webhook] listening', r.url ? `(tunnel: ${r.url})` : '(no tunnel)');
  });
}

/** Per-endpoint public URLs for the settings surface's copy button. Empty string
 *  when no tunnel has ever come up — the UI shows the endpoint, just not a URL
 *  it could hand out yet. */
function webhookEndpointUrls(): { id: string; url: string }[] {
  const base = (webhookServer?.publicUrl() ?? lastWebhookUrl ?? '').replace(/\/+$/, '');
  return (readConfig().webhookTriggers ?? []).map((t) => ({
    id: t.id,
    url: base ? `${base}/${encodeURIComponent(t.id)}` : ''
  }));
}

/** Stop and forget the webhook server. Best-effort; safe when not running. The
 *  last tunnel URL is retained so Settings keeps showing it. */
function stopWebhookServer(): void {
  try { webhookServer?.stop(); } catch (e) { console.error('[webhook] stop failed:', e); }
  webhookServer = null;
  // The done-observer deliberately OUTLIVES the server (it is a ledger concern,
  // not a transport one) — it is torn down with the process/hive, not here.
}

/** The persisted main-window geometry (kv key `window.bounds`). */
interface WindowBounds { x?: number; y?: number; width: number; height: number }

const DEFAULT_WIN = { width: 1440, height: 900 };
const MIN_WIN = { width: 1280, height: 800 };

/** Validate + clamp restored bounds: enforce the minimum size, and drop a
 *  position that no longer lands on any connected display (monitor unplugged) so
 *  the window can't open off-screen. Returns null for unusable input. */
function clampBounds(b: unknown): WindowBounds | null {
  if (!b || typeof b !== 'object') return null;
  const r = b as Partial<WindowBounds>;
  if (typeof r.width !== 'number' || typeof r.height !== 'number') return null;
  const width = Math.max(MIN_WIN.width, Math.round(r.width));
  const height = Math.max(MIN_WIN.height, Math.round(r.height));
  if (typeof r.x !== 'number' || typeof r.y !== 'number') return { width, height };
  const x = Math.round(r.x), y = Math.round(r.y);
  // Keep the position only if the window rect overlaps some display's work area.
  const onScreen = screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return x < wa.x + wa.width && x + width > wa.x && y < wa.y + wa.height && y + height > wa.y;
  });
  return onScreen ? { x, y, width, height } : { width, height };
}

/** Minimal trailing-edge debounce for the move/resize flood. */
function debounce(fn: () => void, ms: number): () => void {
  let t: NodeJS.Timeout | null = null;
  return () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(); }, ms); };
}

// ─── Shareable hires: dontbemichael:// deep link + file import ──────────────
// A hire manifest NEVER auto-spawns: it is validated, then handed to the
// renderer, which pre-fills the Add-Agent modal for human review. See
// src/shared/hire.ts for the spec + security model.

/** Manifests that arrived before the renderer was ready to receive them.
 *  The renderer PULLS these via hire:drainPending once its subscription is
 *  mounted — main never pushes blind, so a fast-loading packaged renderer
 *  can't lose a deep link to a startup race. */
const pendingHires: HireManifest[] = [];
let rendererReadyForHires = false;

function deliverHire(manifest: HireManifest): void {
  if (rendererReadyForHires && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('hire:import', manifest);
  } else {
    pendingHires.push(manifest);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

async function handleHireLink(link: string): Promise<void> {
  const src = parseHireDeepLink(link);
  if (!src) { console.warn('[hire] ignoring malformed deep link'); return; }
  const res = await fetchHireManifest(src);
  if (!res.ok) {
    console.error('[hire] deep link rejected:', res.error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hire:error', { error: res.error });
    }
    return;
  }
  deliverHire(res.manifest);
  analytics.trackFeature('hire_install');
}

// Register the protocol. In dev (electron .) Windows needs the explicit
// exe+args form or the registration points at electron.exe with no entry.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_URL_SCHEME, process.execPath, [resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(APP_URL_SCHEME);
}

// Deep links on Windows/Linux arrive as the argv of a SECOND process — take the
// single-instance lock and forward them to the running instance. (macOS gets
// the 'open-url' event instead.) The lock also rules out two harnesses fighting
// over the same hive, which was previously possible but never useful.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  allowQuit = true;
  app.quit();
} else {
  app.on('second-instance', (_evt, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const link = argv.find((a) => a.startsWith(`${APP_URL_SCHEME}://`));
    if (link) void handleHireLink(link);
  });
}

app.on('open-url', (evt, url) => {
  evt.preventDefault();
  void handleHireLink(url);
});

// IPC: the renderer signals readiness and PULLS anything queued (deep links
// that arrived before the window/subscription existed, incl. cold starts).
ipcMain.handle('hire:drainPending', () => {
  rendererReadyForHires = true;
  const out = pendingHires.splice(0, pendingHires.length);
  return out;
});

// IPC: "import hires…" file picker in the Add-Agent modal. Every selected file
// is validated independently; valid neighbours survive an invalid manifest.
ipcMain.handle('hire:openFile', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Import hire manifests',
    filters: [{ name: 'Hire manifest', extensions: ['json'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled || res.filePaths.length === 0) {
    return { ok: false, manifests: [], errors: [], error: 'cancelled' };
  }
  const batch = readHireManifestFiles(res.filePaths);
  return {
    ok: batch.manifests.length > 0,
    ...batch,
    error: batch.manifests.length === 0 ? 'no valid hire manifests selected' : undefined
  };
});

/**
 * Create the office window: it restores saved geometry, uses the default
 * session, runs the hive, and keeps the app-quit warning. (A second "floor"
 * window existed once; it went with the New Floor menu item, 2026-10-03.)
 */
function createWindow(): BrowserWindow {
  let geom: WindowBounds | null = null;
  try { geom = clampBounds(persist.getKv('window.bounds')); } catch { geom = null; }

  const win = new BrowserWindow({
    width: geom?.width ?? DEFAULT_WIN.width,
    height: geom?.height ?? DEFAULT_WIN.height,
    ...(geom && geom.x !== undefined && geom.y !== undefined ? { x: geom.x, y: geom.y } : {}),
    minWidth: MIN_WIN.width,
    minHeight: MIN_WIN.height,
    title: APP_NAME,
    backgroundColor: '#FFF8E7',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Keep Chromium's OS renderer sandbox active; privileged work stays behind
      // the narrow contextBridge/IPC surface owned by the main process.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer runs the hive's heartbeat loops (inbox nudge, message
      // flush, telemetry polls). Chromium throttles timers in occluded windows
      // — incl. behind the LOCK SCREEN — which silently stalls the hive while
      // the user is away. Don't.
      backgroundThrottling: false,
    }
  });

  // Capture the webContents once: after 'closed' the window is gone, but this
  // reference stays valid as the per-PTY ownership key.
  const wc = win.webContents;

  allWindows.add(win);
  // Global timer events follow the user — the most-recently-focused window is
  // primary. The primary is also seeded synchronously so boot events route now.
  win.on('focus', () => { mainWindow = win; });
  mainWindow = win;

  // Permission gate for the renderer (our own trusted, local content). The only
  // permission we constrain is microphone capture: it's allowed ONLY while a mic
  // feature is actually live — Free Flow dictation (`freeflowEnabled`) OR a
  // Realtime Michael voice session (`realtimeVoiceEnabled`, flipped on by the
  // session at start() before getUserMedia, off at stop()). With both flags off,
  // there's zero mic access even at the Electron layer. We deliberately do NOT
  // gate on OpenAI-key presence: that key (`apikey:openai`) is shared with the CLI
  // engines, so a CLI-only user must not have the mic gate opened. Every other
  // permission keeps the app's prior permissive behavior (e.g. clipboard for
  // xterm/editor copy must keep working).
  const micFeatureLive = (): boolean => {
    const cfg = readConfig();
    return cfg.freeflowEnabled === true || cfg.realtimeVoiceEnabled === true;
  };
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const mediaTypes = details && 'mediaTypes' in details ? details.mediaTypes : undefined;
      const wantsAudio = !mediaTypes || mediaTypes.includes('audio');
      callback(micFeatureLive() && wantsAudio);
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'media') return micFeatureLive();
    return true;
  });

  // The window persists its geometry (kv `window.bounds`). Skip while
  // maximized/minimized so a restore doesn't save the fullscreen rect.
  {
    const saveBounds = debounce(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
      try { persist.setKv('window.bounds', win.getBounds()); } catch { /* DB best-effort */ }
    }, 400);
    win.on('resized', saveBounds);
    win.on('moved', saveBounds);
    // Whether it was left filling the screen (kv `window.maximized`), so the
    // next launch opens the same way.
    const saveMaximized = () => {
      if (win.isDestroyed() || win.isMinimized()) return;
      try { persist.setKv('window.maximized', win.isMaximized()); } catch { /* DB best-effort */ }
    };
    win.on('maximize', saveMaximized);
    win.on('unmaximize', saveMaximized);
    win.on('close', () => {
      saveMaximized();
      if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
      try { persist.setKv('window.bounds', win.getBounds()); } catch { /* DB best-effort */ }
    });
  }

  // The office opens filling the screen (owner, 2026-10-03: it always came
  // back at about 70%), unless the owner last left it at a smaller size.
  let openMaximized = true;
  try { openMaximized = persist.getKv('window.maximized') !== false; } catch { /* DB best-effort: fill the screen */ }
  win.once('ready-to-show', () => {
    if (openMaximized) win.maximize();
    win.show();
  });

  // Never opens a window; hands the URL to the OS browser instead.
  //
  // Scheme-checked, because this is now reachable from AUTHOR-CONTROLLED markup:
  // a release drop's iframe has `allow-popups`, so a target="_blank" link in a
  // release body arrives here. http(s) only — an unguarded openExternal will
  // happily launch file://, or a registered custom scheme, on the user's machine.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // A link or a dropped file must never replace the app with another page: a
  // web link opens in the browser instead, under the same http(s) rule as above.
  // Reloading the app's own page (App.tsx does after a harness home change) and
  // the dev server's pages still go through.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return;
    if (isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // Close interception when live PTYs exist. The red-X destroys the window;
  // intercept it the same way before-quit does so PTY users aren't surprised.
  win.on('close', (e) => {
    if (allowQuit) return;
    // Primary window: existing app-wide quit warning (renderer modal).
    const count = ptyManager.list().length;
    if (count === 0) return;
    e.preventDefault();
    win.focus();
    wc.send('app:closeRequested', { ptyCount: count });
  });

  // The window is the PTY sink.
  ptyManager.attachWebContents(wc);

  // A main-frame reload unmounts the renderer's hire subscription — queue again
  // until the fresh renderer drains. Guard on isMainFrame: a stray sub-frame
  // navigation must NOT flip readiness off (the renderer only drains on mount,
  // so a later deep link would otherwise queue and sit until a full reload).
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame) rendererReadyForHires = false;
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    allWindows.delete(win);
    if (mainWindow === win) {
      mainWindow = null;
      for (const w of allWindows) { if (!w.isDestroyed()) { mainWindow = w; break; } }
    }
    syncKeepAwake();
  });

  return win;
}

/** The quit item's label in the app menu (and File on Windows and Linux). */
const QUIT_LABEL = 'Close Office';
/** The hide item's label in the Mac app menu, for the same reason as Quit:
 *  "Hide Don't Be Michael" read as a double negative (owner, 2026-09-24). */
const HIDE_LABEL = 'Hide Office';

/** Build + install the application menu: standard role-based items so
 *  copy/paste/quit work per platform, trimmed to what an office owner uses. */
function installAppMenu(): void {
  const isMac = process.platform === 'darwin';
  // Quit reads "Close Office" and Hide reads "Hide Office": "Quit Don't Be
  // Michael" put "Quit" and "Don't" side by side, which read as a double
  // negative (owner, 2026-09-24). Both keep their roles, so Cmd+Q, Cmd+H and
  // the quit guard behave exactly as before.
  const quitItem = { role: 'quit' as const, label: QUIT_LABEL };
  // Only what an office owner uses (owner, 2026-10-03): no File menu on the
  // Mac (its multi-window item opened a separate, empty office, and Close Window left the
  // office running in the Dock while looking like a quit); View keeps zoom and
  // full screen, with Reload and the developer tools only in development.
  const devViewItems: Electron.MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }];
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
        role: 'appMenu' as const,
        submenu: [
          { role: 'about' as const },
          { type: 'separator' as const },
          { role: 'services' as const },
          { type: 'separator' as const },
          { role: 'hide' as const, label: HIDE_LABEL },
          { role: 'hideOthers' as const },
          { role: 'unhide' as const },
          { type: 'separator' as const },
          quitItem
        ]
      }]
      // Windows and Linux have no app menu, so Close Office lives in File.
      : [{ label: 'File', submenu: [quitItem] }]),
    // The Edit menu is spelled out rather than `{ role: 'editMenu' }` for one
    // reason: `registerAccelerator: false` on the clipboard items.
    //
    // A registered accelerator is claimed by the MENU, which then replays the
    // action through `webContents.paste()` — an async hop that runs a beat after
    // the keystroke. Dictation tools (Muesli, Wispr Flow, …) insert text by
    // stashing the clipboard, writing the transcript, sending the paste key, and
    // restoring the old clipboard immediately; the menu's late paste therefore
    // read the RESTORED clipboard and typed the user's previous copy instead of
    // what they had just said. It hit the terminal and the composer alike,
    // because both were downstream of the same replay.
    //
    // With registerAccelerator false the item still shows its shortcut, but the
    // key is left for the focused element to handle inline — xterm's own paste
    // handler and the textarea's native paste event both read the clipboard
    // synchronously, inside the keystroke, before any restore can land.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const, registerAccelerator: false },
        { role: 'redo' as const, registerAccelerator: false },
        { type: 'separator' as const },
        { role: 'cut' as const, registerAccelerator: false },
        { role: 'copy' as const, registerAccelerator: false },
        { role: 'paste' as const, registerAccelerator: false },
        { role: 'selectAll' as const, registerAccelerator: false }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...devViewItems,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


// ─── IPC: pty lifecycle ─────────────────────────────────────────────────────
/** Codex stores its rollout transcripts under a PER-AGENT CODEX_HOME
 *  (<hive>/agents/<id>/.codex/sessions/<Y>/<M>/<D>/rollout-*-<sessionId>.jsonl).
 *  A NEWLY added agent gets an empty CODEX_HOME, so `codex resume <sid>` finds
 *  nothing and silently opens a BLANK session — which is exactly what the Add
 *  Agent "resume session" field looked like it was doing. Find the agent whose
 *  CODEX_HOME owns this rollout and RETURN that home so the resumed agent can be
 *  pointed at it (the rollout AND its state_5.sqlite index live there together). */
function findCodexHomeForSession(sessionId: string, siblingsRoot: string): string | null {
  try {
    if (!sessionId || !/^[0-9a-fA-F][0-9a-fA-F-]{15,}$/.test(sessionId)) return null;
    let fallbackHome: string | null = null;
    // Walk each sibling agent's CODEX_HOME (<agent>/.codex) looking for the
    // rollout that owns this session. We RETURN that home rather than copy the
    // rollout out of it: Codex indexes sessions in its state_5.sqlite, so a lone
    // rollout file in a fresh home is invisible to `codex resume`. Pointing the
    // resumed agent at the OWNING home gives it the rollout AND the index.
    let agents: Array<{ name: string; isDirectory(): boolean }>;
    try {
      agents = readdirSync(siblingsRoot, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    } catch { return null; }
    for (const a of agents) {
      if (!a.isDirectory()) continue;
      const home = join(siblingsRoot, a.name, '.codex');
      const sessions = join(home, 'sessions');
      if (!existsSync(sessions)) continue;
      const stack = [sessions];
      let hasRollout = false;
      while (stack.length && !hasRollout) {
        const d = stack.pop() as string;
        let ents: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
        try {
          ents = readdirSync(d, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
        } catch { continue; }
        for (const e of ents) {
          const pth = join(d, e.name);
          if (e.isDirectory()) stack.push(pth);
          else if (e.isFile() && e.name.endsWith('.jsonl') && e.name.includes(sessionId)) { hasRollout = true; break; }
        }
      }
      if (!hasRollout) continue;
      // Prefer the home whose Codex state DB actually INDEXES this session — a
      // fresh/seeded home may carry only a stray rollout copy (no index), which
      // `codex resume` can't open. Match the id as raw bytes in state_5.sqlite
      // (+ its WAL). Homes with the rollout but no index are a last-resort fallback.
      const idBuf = Buffer.from(sessionId);
      let indexed = false;
      for (const db of ['state_5.sqlite', 'state_5.sqlite-wal']) {
        try { if (readFileSync(join(home, db)).includes(idBuf)) { indexed = true; break; } } catch { /* no db */ }
      }
      if (indexed) return home;
      if (!fallbackHome) fallbackHome = home;
    }
    return fallbackHome;
  } catch (e) {
    console.error('[resume] findCodexHomeForSession failed:', e);
    return null;
  }
}

/** Spawn options shared by the `pty:spawn` IPC handler and the god-triggered
 *  ephemeral-worker watcher. */
type AgentSpawnOptions = SpawnOptions & { hive?: AgentMeta; isolate?: boolean; resume?: boolean; requireResume?: boolean; resumeSessionId?: string; provider?: AgentProvider; noAutoInstall?: boolean };

/** Map a `ptyManager.spawn` failure string to the closed `agent_spawn_failed.reason`
 *  enum (analytics.ts). The two known strings come from PtyManager.spawn; anything
 *  else is a generic `spawn_error`. The raw message never leaves the machine — only
 *  the enum value does, per TELEMETRY.md. */
function spawnFailReason(error?: string): SpawnFailReason {
  if (error?.startsWith('cwd does not exist')) return 'cwd_missing';
  if (error?.includes('already exists')) return 'already_running';
  return 'spawn_error';
}

ipcMain.handle('pty:spawn', async (evt, opts: AgentSpawnOptions) => {
  if (!opts || typeof opts.id !== 'string' || typeof opts.cwd !== 'string' || typeof opts.command !== 'string') {
    return { ok: false, error: 'invalid SpawnOptions' };
  }
  // Record the spawning window as the PTY's owner so its output routes ONLY back
  // to that floor, then run the shared spawn core.
  const owner = BrowserWindow.fromWebContents(evt.sender)?.webContents ?? null;
  return spawnAgentCore(opts, owner);
});

/** Core agent-spawn logic — provider inference, the missing-CLI installer
 *  short-circuit, git-worktree isolation, hive provisioning, model/resume flags,
 *  and the final PTY spawn. Extracted VERBATIM from the `pty:spawn` IPC handler so
 *  it can ALSO be invoked by the god-triggered ephemeral-worker watcher (which has
 *  no renderer `evt`). `owner` is the window that should receive this PTY's output
 *  (null → the primary window). Behavior-identical to the prior inline handler. */
async function spawnAgentCore(opts: AgentSpawnOptions, owner: Electron.WebContents | null): Promise<{ ok: boolean; error?: string; cwd?: string; worktreePath?: string; resumeNotFound?: boolean; resumed?: boolean; seedPrompt?: string }> {
  // A team member never starts without the hook channel (S1,
  // docs/designs/windows-11-installer.md): it would run unwatched, or report to
  // whatever holds the channel's name.
  if (opts.hive) await hookServer.whenOpen();
  const channelError = opts.hive ? hookServer.channelError() : null;
  if (channelError) return { ok: false, error: channelError };
  // ── cwd INGESTION — expand `~` exactly once, here ───────────────────────────
  // This is the single door every agent spawn comes through (`pty:spawn` IPC and
  // the god-triggered ephemeral-worker watcher), so it is where a user-typed
  // `~/dev/foo` becomes an absolute path. Only a shell expands `~`; Node treats it
  // as a literal dir, so without this every downstream existsSync/statSync fails
  // with `cwd does not exist`. Expanding BEFORE hive provisioning is what makes the
  // registry store an ABSOLUTE cwd (and `cwdValid: true`). The resolved value is
  // returned to the caller so the renderer records the same absolute path.
  opts.cwd = expandTilde(opts.cwd);
  if (opts.hive) opts.hive = { ...opts.hive, cwd: expandTilde(opts.hive.cwd) };
  // Before anything checks the working folder. Michael works in the business
  // folder, private to him and the owner, which holds every team member's
  // folder so he can read his team's work (folderAccess.ts). The renderer may
  // ask for an older place (the retired Office folder); main decides here, where
  // the folder checks live.
  const businessFolder = businessFolderReady();
  if (opts.hive?.isGod && businessFolder) {
    opts.cwd = businessFolder;
    opts.hive = { ...opts.hive, cwd: businessFolder };
  }
  // Which CLI is this? Explicit wins; else inferred from the binary
  // (claude/codex/grok/agy). Non-Claude providers skip every Claude-only spawn step
  // below. Persist the resolved provider onto opts (+ hive meta) so the registry
  // record and downstream provider-aware steps agree on one value.
  const provider = inferAgentProvider(opts.command, opts.provider ?? opts.hive?.provider);
  const claudeProvider = isClaudeProvider(provider);
  opts.provider = provider;
  if (opts.hive) opts.hive = { ...opts.hive, provider };
  // Activation-funnel entry (v0.4.6): every spawn REQUEST, so (attempted − spawned)
  // measures the fallout the whole rebuild exists to see. Gated on !noAutoInstall so
  // the missing-CLI relaunch (the only re-entry, index.ts install-exit handler) does
  // NOT double-count a single user attempt — it is the SAME attempt continuing.
  if (!opts.noAutoInstall) analytics.track('agent_spawn_attempted', { provider });
  // ── Missing engine CLI → run its installer visibly (pre-spawn) ───────────────
  // Every engine but Claude, which is handled first in the block below. If the
  // agent's engine binary (codex/…) isn't installed, spawning it
  // just dies with "— process exited (code 1) —" and the user has no idea why.
  // Detect the absent binary BEFORE spawning and, in this SAME terminal, print a
  // banner + RUN the provider's install command so the user can watch it (and
  // complete any interactive sign-in). On a CLEAN install exit the PTY-exit handler
  // auto restart-and-continues — it re-runs THIS spawn (with noAutoInstall) so the
  // freshly-installed CLI launches in the SAME pty/window, no user click. STRICTLY
  // pre-spawn: a non-zero exit from a CLI that DID start never reaches here, so there
  // is no install loop; and the relaunch's noAutoInstall guarantees the installer
  // can't fire twice. Providers with no known installer get a manual hint only (and
  // are NOT armed for relaunch) — nothing arbitrary is ever auto-run. We short-circuit
  // BEFORE worktree/hive/Claude-flag setup: ptyToAgent + worktreePaths stay unset for
  // this id, so when the install PTY exits teardownPty is a harmless no-op (the agent
  // isn't archived and no worktree is torn down) before the relaunch takes over.
  {
    const bin = opts.command.trim().split(/\s+/)[0] || opts.command;
    // Claude is set up where the owner can see it: the Ready step at the end of
    // setup, or the Get Michael ready card on Ask me (engineSetup.ts). Its
    // installer used to run here, in a terminal the owner never sees, behind a
    // Mac password prompt nobody saw; it failed and nothing said so. Now this
    // terminal only says what to do, and the card shows on Ask me.
    // The plain `claude` is found without a login shell (a miss there costs a
    // second of frozen windows per agent on a team restore).
    const claudeMissing = bin && claudeProvider && (bin === 'claude' ? !claudePathFast() : !ptyManager.isCommandAvailable(bin));
    // A Claude that is there but known signed out (or set to a key that is not
    // stored) starts on a sign in screen nobody sees: remember it too, so it
    // restarts once the owner signs in. Any other start leaves the list.
    // Nothing read yet this session (a fresh app launch): read once before the
    // first account start, so a signed out team is caught, not started blind.
    if (!claudeMissing && claudeProvider && bin === 'claude' && readConfig().claudeAuth !== 'apiKey' && claudeAuth.last() === null) {
      const path = claudePathFast();
      if (path) { try { await claudeAuth.read(path); } catch { /* unknown: start as before */ } }
    }
    const signedOutStart = !claudeMissing && claudeProvider && (readConfig().claudeAuth === 'apiKey'
      ? !integrations.hasSecret(providerKeyRef('anthropic'))
      : claudeAuth.last()?.signedIn === false);
    if (signedOutStart) claudeBlocked.set(opts.id, { god: !!opts.hive?.isGod });
    else if (!claudeMissing) claudeBlocked.delete(opts.id);
    if (claudeMissing) {
      // Remember who could not start, to start exactly those once Claude is
      // ready; a member (not Michael) makes the card speak for the team.
      claudeBlocked.set(opts.id, { god: !!opts.hive?.isGod });
      let godName = 'Michael';
      try { godName = hive.registry().agents[hiveGodId()]?.name?.trim() || godName; } catch { /* no hive yet */ }
      const res = ptyManager.spawn(
        { id: opts.id, cwd: opts.cwd, command: bin, cols: opts.cols, rows: opts.rows, shellScript: claudeMissingScript(process.platform, godName) },
        owner
      );
      if (!opts.noAutoInstall) analytics.track('agent_spawn_failed', { provider, reason: 'cli_missing' });
      noticeEngineSetup(opts.id);
      syncKeepAwake();
      return res;
    }
    if (bin && !opts.noAutoInstall && !ptyManager.isCommandAvailable(bin)) {
      // The installer commands are `npm install -g …`. Probe for npm the same way
      // we probe for the engine CLI, so a no-Node machine gets the node-free rung
      // (or an honest manual hint) instead of watching `npm: not found` scroll by.
      // An npm whose Node is BELOW the floor counts as unavailable: founder rule
      // (2026-08-07) is "their Node newer than ours → leave it alone; absent or
      // older → install the latest stable for them".
      const npmAvailable =
        ptyManager.isCommandAvailable('npm') &&
        nodeIsUsable(detectNodeVersion(ptyManager.commandPath('node')));
      // Only reach the network when we actually need to (npm missing/too old);
      // resolveNodeInstaller is timeout-bounded and returns null offline, which
      // simply drops the ladder to the native/manual rung.
      const nodeInstaller = npmAvailable ? null : await resolveNodeInstaller();
      const rung = chooseInstallRung(installInfoForProvider(provider), npmAvailable, nodeInstaller);
      const res = ptyManager.spawn(
        {
          id: opts.id,
          cwd: opts.cwd,
          command: bin,
          cols: opts.cols,
          rows: opts.rows,
          shellScript: buildMissingCliScript(bin, provider, npmAvailable, process.platform, nodeInstaller)
        },
        owner
      );
      // Arm auto restart-and-continue: when this installer PTY exits cleanly, the
      // exit handler re-runs the spawn so the just-installed CLI launches in place
      // (no user click). Only when an installer actually RAN (a provider with no
      // bundled installer just prints a manual hint and exits 0 — relaunching there
      // would spawn the still-missing binary and die) and the PTY actually started.
      // …keyed on the RUNG, not on `installCommand`: the manual rung prints a hint
      // and exits 0, and relaunching there would just respawn the still-missing
      // binary and die with the bare "process exited (code 1)" this whole path exists
      // to replace.
      if (res.ok && rung.command) {
        pendingInstallRelaunch.set(opts.id, { opts, owner, bin, rung: rung.kind });
        // The auto-installer PTY is running; agent_install_finished on its exit says
        // whether it actually produced an agent (rung is non-manual here by construction).
        analytics.track('agent_install_started', { provider, rung: rung.kind });
      } else if (res.ok) {
        // Manual rung: the PTY only printed a hint (no installer to run, no relaunch
        // armed), so no agent will start. This is the Mode 2 case that used to send
        // NOTHING — an absent engine with no unattended install path.
        analytics.track('agent_spawn_failed', { provider, reason: 'cli_missing' });
      } else {
        // The install PTY itself failed to spawn (cwd gone, id clash, throw).
        analytics.track('agent_spawn_failed', { provider, reason: spawnFailReason(res.error) });
      }
      syncKeepAwake();
      return res;
    }
  }
  // Git isolation: when requested and the cwd is a real repo, give this agent
  // its own worktree on an `agent/<id>` branch so it can't clobber other agents'
  // (or the user's) working tree. Best-effort — a failure falls back to the
  // shared cwd rather than blocking the spawn.
  // NOTE (tracked, not yet hardened): the restore flow passes isolate:false and
  // re-enters the existing worktree by cwd, so it never reaches here. But a stale
  // `isolate:true` recipe spawned against an already-existing worktree path would
  // make addWorktree below conflict (path/branch exists) and fall back to the base
  // cwd — reuse-existing-worktree handling here is the follow-up.
  if (opts.isolate === true && await isRepo(opts.cwd)) {
    try {
      const origCwd = opts.cwd;
      const wtRoot = join(readConfig().harnessHome ?? origCwd, 'worktrees');
      // The id is renderer-supplied (validated only as a string). Slugify it so a
      // crafted id can't inject path separators, then assert the resolved path
      // stays under the worktrees root (defends against bare '..' that slugify
      // leaves intact). If it would escape, bail isolation → fall back to cwd.
      const seg = (opts.hive?.id ?? opts.id).replace(/[^A-Za-z0-9._-]/g, '-');
      const wtPath = join(wtRoot, seg);
      if (!resolve(wtPath).startsWith(resolve(wtRoot) + sep)) {
        console.error('[worktree] refusing unsafe worktree path for id:', opts.hive?.id ?? opts.id);
      } else {
        const br = await getBranch(origCwd);
        const baseBranch = 'current' in br && br.current ? br.current : 'main';
        const wt = await addWorktree(origCwd, wtPath, baseBranch);
        if (wt.ok) {
          opts.cwd = wtPath;
          worktreePaths.set(opts.id, wtPath);
          worktreeOrigins.set(opts.id, origCwd);
          const deps = await linkWorktreeDeps(origCwd, wtPath);
          if (!deps.ok) console.error('[worktree] dependency link failed:', deps.error);
        } else {
          console.error('[worktree] addWorktree failed:', wt.error);
        }
      }
    } catch (e) {
      console.error('[worktree] isolation failed:', e);
    }
  }
  // Proxy-tier CLIs (qwen/crush) route their LLM traffic through a loopback sidecar
  // whose UPSTREAM is read from the preset's bridge.baseUrlEnv inside hive.ensureAgent.
  // For the local-LLM path, feed the user's configured base URL as that upstream so the
  // proxy forwards to their endpoint (Ollama/LM Studio/vLLM). Set on process.env BEFORE
  // ensureAgent reads it. (Crush's baseUrlEnv is an inert sentinel used ONLY as this
  // upstream source; its real routing is the per-agent CRUSH_GLOBAL_CONFIG base_url.)
  if (opts.hive && (provider === 'crush' || provider === 'qwen')) {
    const bridge = providerPreset(provider).bridge;
    const baseUrl = readConfig().providerBaseUrls?.[provider];
    if (bridge && bridge.kind === 'proxy' && baseUrl) process.env[bridge.baseUrlEnv] = baseUrl;
  }
  // If the agent carries hive metadata, provision its workspace and add
  // provider-specific spawn injection. Non-Claude providers get shared AGENT_*
  // env only; Claude Code also gets prompt/settings hook args.
  // Protocol seed that must be TYPED into a bare TUI after boot (Crush —
  // seedDelivery:'type-into-tui') rather than passed on argv. Surfaced in the spawn
  // result so the renderer types it through the per-pty write-chain. (ondev-b)
  let seedPrompt: string | undefined;
  // Claude connectors (docs/designs/claude-connectors.md): the plan is worked
  // out once, passed to the spawn and recorded as what this agent started with,
  // so a change in between still asks for a restart. Until the hive injection
  // has applied it, the agent counts as unprotected and is stripped below.
  const connectorPlan = opts.hive && claudeProvider ? connectorStart(readConfig(), opts.hive.id) : undefined;
  let connectorsApplied = false;
  if (opts.hive && hive.enabled()) {
    try {
      const inj = await hive.ensureAgent(
        { ...opts.hive, cwd: opts.cwd, provider },
        {
          semanticMemory: memory.active(),
          knowledgeGraph: knowledge.active(),
          // Bake the ABSOLUTE KG CLI path into the agent's prompt. The prompt used
          // to spell it `$KG_CLI`, which is POSIX-only: under cmd.exe/PowerShell it
          // expands to nothing, so every knowledge-graph instruction was dead on a
          // Windows floor. Empty when the KG is off (the line isn't emitted then).
          kgCliPath: knowledge.env().KG_CLI,
          kgRoot: knowledge.env().KG_ROOT,
          meaningSearch: meaningSearch(),
          theme: readConfig().terminalTheme ?? 'light',
          // W3 — default-MCP consent state + the bundled skills source dir.
          mcpDefaults: readConfig().mcpDefaults,
          skillsDir: skillsResourceDir(),
          // The shared palace is mutated by the agent's own `mempalace` calls, so
          // the OS sandbox must let it through (empty when memory is off).
          extraWritableDirs: [memory.env().MEMPALACE_PALACE_PATH].filter((p): p is string => !!p),
          businessFolder,
          business: (() => {
            const cfg = readConfig();
            const pack = businessPackInfo(cfg.businessType);
            const profile = cleanCompanyProfile(cfg.companyProfile);
            return {
              name: cfg.businessName,
              city: cfg.businessCity,
              typeName: pack.displayName ?? profile.industry,
              briefing: pack.briefing
            };
          })(),
          folderPolicy: businessFolder
            ? folderPolicy(
              { isGod: !!opts.hive.isGod, cwd: opts.cwd },
              businessFolderLayout(businessFolder),
              process.platform !== 'linux'
            )
            : privateOnlyFolderPolicy(!!opts.hive.isGod, opts.cwd),
          docTextCliPath: docTextCliPath(),
          connectors: connectorPlan?.plan
        }
      );
      opts.args = [...(opts.args ?? []), ...inj.args];
      connectorsApplied = true;
      seedPrompt = inj.seedPrompt;
      // A degraded spawn (proxy bridge never bound) is told to the user the same
      // way breaker escalations are: a native toast, gated on the notifications
      // setting. The hive already logged it and pushed hive:degraded to the floor.
      if (inj.degraded) ownerToast('Agent running degraded', inj.degraded);
      // Point the agent's mempalace CLI at the shared palace + the `kg` CLI at the
      // enterprise knowledge store (both no-ops / empty when their flags are off).
      opts.env = { ...(opts.env ?? {}), ...inj.env, ...memory.env(), ...knowledge.env() };
    } catch (e) {
      // Hive provisioning is best-effort; never block a spawn on it.
      console.error('[hive] ensureAgent failed:', e);
    }
  }
  // No hive injection (it failed, or the hive is off) means no hook and no deny
  // rules: a Claude agent then starts with no connector and none of the owner's
  // own servers, whatever its grants (D8). md-mail still comes via --mcp-config.
  if (connectorPlan && !connectorsApplied) {
    console.warn(`[connectors] ${opts.hive?.id}: no hive settings, starting without connectors`);
    if (!(opts.args ?? []).includes('--strict-mcp-config')) opts.args = [...(opts.args ?? []), '--strict-mcp-config'];
    opts.env = { ...(opts.env ?? {}), ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
  }
  // Long-run guardrails + tiering (Lane A #6.4/#6.6). All additive to the args
  // already assembled (incl. the hive injection); an explicit choice always wins.
  // Set when an explicit Add Agent "resume session" id couldn't be located and we
  // silently fell back to a fresh session — returned so the dialog can surface it.
  let resumeNotFound = false;
  // Set when `--resume` was actually attached (explicit id or restore-on-restart),
  // so the renderer can skip re-orienting a god/assistant that resumed its thread.
  let didResume = false;
  // Claude-only — these are Claude Code flags; other CLIs carry their own flags
  // in the command string the renderer already built.
  if (opts.hive && claudeProvider) {
    const cfg = readConfig();
    // Permission posture (D9): only a GUI hire (Add Agent) builds its command
    // through buildSpawnCommand, which bakes autoMode's bypass flag into the
    // command STRING before this function ever sees it. A main-only spawn (the
    // ephemeral-worker watcher, a voice hire) skips that step entirely, so it
    // previously reached here with neither the flag nor any equivalent — every
    // other Claude spawn path got the user's autoMode posture and this one
    // didn't. argsWithAutoModeFlag is idempotent (a GUI spawn's args already has
    // the flag, so this is a no-op for it) and is the SAME check spawnAgentCore
    // already applies for opencode/crush et al a few lines below via
    // HIVE_AUTO_APPROVE — one global toggle, one posture, every spawn path.
    // Confirmed live: a worker spawned without this flag deadlocked — a
    // cross-session message to it came back "held for the recipient user's
    // approval" with no surface for anyone to ever grant that approval.
    const args = argsWithAutoModeFlag(opts.args ?? [], cfg.autoMode, provider);
    // Model precedence: an explicit per-agent --model (from the renderer) wins;
    // else the user's global defaultModel; else the role-based default tier. The
    // GOD is special-cased: it has its own engine config (godProvider/godModel), so
    // modelForRole resolves it and that wins over the worker-oriented defaultModel.
    if (!args.includes('--model')) {
      const m = opts.hive.isGod
        ? modelForRole(opts.hive, cfg)
        : cfg.defaultModel ?? modelForRole(opts.hive, cfg);
      if (m) args.push('--model', m);
    }
    // A model newer than the installed Claude Code (Opus 5.5 needs 2.1.280+)
    // would be rejected and the agent would never start. Swap it for the
    // newest model this CLI knows. Applies to every Claude agent, whichever
    // picker chose the model, since this is the one door all spawns use.
    {
      const at = args.findIndex((a) => a === '--model' || a.startsWith('--model='));
      const requested = at < 0 ? undefined : args[at] === '--model' ? args[at + 1] : args[at].slice('--model='.length);
      if (requested && CLAUDE_MODEL_CLI_FLOOR[requested]) {
        const bin = opts.command.trim().split(/\s+/)[0] || opts.command;
        const pick = modelForCli(requested, await claudeCliVersion(ptyManager.commandPath(bin)));
        if (pick.downgraded) {
          if (args[at] === '--model') args[at + 1] = pick.model; else args[at] = `--model=${pick.model}`;
          console.warn(`[spawn] ${opts.hive.id}: ${pick.downgraded.from} needs Claude Code ${pick.downgraded.need}+, found ${pick.downgraded.have}; running ${pick.model}`);
        }
      }
    }
    // Compaction is Claude Code's own auto compact (owner, 2026-09-25): the app
    // only moves where it fires. Claude Code clamps this to the model's window,
    // so a 200k model is unchanged and a 1M model compacts at about 300k.
    // An owner who set the variable themselves keeps their value.
    if (!process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW && !opts.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW) {
      opts.env = { ...(opts.env ?? {}), CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(AUTO_COMPACT_WINDOW_TOKENS) };
    }
    // Name the Remote Control session after the agent (Michael, Jim, Dev1…) so it
    // is identifiable in claude.ai / the mobile app. Otherwise Claude defaults the
    // prefix to the machine hostname (e.g. "vyapaks-macbook-pro-…"), which is
    // opaque when several agents run at once — especially with remoteControlAtStartup
    // on, where RC auto-enables for every session. Slugify the friendly name into a
    // single safe token; Claude still appends its own random suffix for uniqueness.
    if (!args.includes('--remote-control-session-name-prefix')) {
      const label = (opts.hive.name || opts.hive.id || '')
        .trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
      if (label) args.push('--remote-control-session-name-prefix', label);
    }
    // Coarse runaway cap.
    if (typeof cfg.maxTurns === 'number' && cfg.maxTurns > 0 && !args.includes('--max-turns')) {
      args.push('--max-turns', String(cfg.maxTurns));
    }
    // Resume: an explicit session id (Add Agent "resume session" field, #2) wins,
    // else this agent's last recorded session (#1 restore-on-restart / #6.6a).
    // Seed the transcript into the target cwd's Claude project dir first — Claude
    // keys sessions by cwd, so a session started elsewhere is invisible until its
    // `.jsonl` is copied across. Only attach `--resume` if the transcript is
    // actually present (already or after the copy); otherwise fall back to a fresh
    // session rather than launching a `--resume` against a missing id.
    const explicitSid = typeof opts.resumeSessionId === 'string' ? opts.resumeSessionId.trim() : '';
    const sid = explicitSid || (opts.resume === true ? hive.lastSession(opts.hive.id) : undefined);
    if (sid && !args.includes('--resume')) {
      if (seedSessionTranscript(opts.cwd, sid)) {
        args.push('--resume', sid);
        didResume = true;
      } else if (explicitSid) {
        // The user typed a session id in the Add Agent dialog but it isn't in any
        // Claude project dir — we fall back to a FRESH session rather than a broken
        // `--resume`. Make that non-silent: warn on the floor and flag it back to
        // the renderer so the dialog can tell the user 'started fresh'.
        console.warn(`[resume] session "${explicitSid}" not found in any Claude project dir — starting a fresh session`);
        resumeNotFound = true;
      }
    }
    opts.args = args;
  }
  // Idempotent session resume on respawn (#6.6a) — provider-aware: Claude
  // `--resume <sid>`, Grok `--resume <sid>`, Antigravity `--conversation <id>`.
  // The recorded session id comes from hook payloads, so
  // a restored worker continues its prior CLI session. Only when requested AND a
  // prior id exists for this agent.
  // Claude resume — incl. transcript seeding + only-attach-when-present — is
  // handled in the Claude-only block above; this generic flag path covers the
  // other CLIs (it must not blindly attach `--resume` when the seed failed).
  if (opts.hive && !claudeProvider) {
    const preset = providerPreset(provider);
    const rf = preset.resumeFlag;
    const rsub = preset.resumeSubcommand;
    // An id typed into Add Agent's "resume session" field wins; otherwise fall
    // back to this agent's own recorded session (restart-in-place). Previously
    // resumeSessionId was read ONLY in the Claude branch, so a Codex agent
    // silently ignored it and started a brand-new empty session.
    const typedSid = typeof opts.resumeSessionId === 'string' ? opts.resumeSessionId.trim() : '';
    const sid = typedSid || (opts.resume === true ? hive.lastSession(opts.hive.id) : undefined);
    if (sid && rf) {
      const args = opts.args ?? [];
      if (!args.includes(rf)) { args.push(rf, sid); opts.args = args; didResume = true; }
    } else if (sid && rsub) {
      // Subcommand form (Codex): `codex resume [OPTIONS] [SESSION_ID]` — the
      // subcommand MUST be argv[0], the id trails the flags. Codex indexes
      // sessions in state_5.sqlite, so a fresh agent's empty CODEX_HOME can't
      // resume by id. If this agent's own home already has the session, resume in
      // place; otherwise point CODEX_HOME at the agent home that OWNS it (that
      // home has both the rollout and the sqlite index).
      const myHome = (opts.env ?? {}).CODEX_HOME;
      const agentsRoot = myHome ? dirname(dirname(myHome)) : '';
      const ownerHome = agentsRoot ? findCodexHomeForSession(sid, agentsRoot) : null;
      if (!ownerHome) {
        console.warn(`[resume] codex session "${sid}" not found in any agent CODEX_HOME - starting fresh`);
        if (typedSid) resumeNotFound = true;
      } else {
        if (ownerHome !== myHome) opts.env = { ...(opts.env ?? {}), CODEX_HOME: ownerHome };
        const args = opts.args ?? [];
        // Positional order matters: `codex resume [OPTIONS] [SESSION_ID] [PROMPT]`.
        // The hive identity prompt rides in `args` as a POSITIONAL (codex has no
        // prompt flag), so the id must come BEFORE it — appending the id last made
        // codex read the prompt as SESSION_ID ("No saved session found with ID
        // You are \"Dev2\"…") and the id as the prompt.
        if (args[0] !== rsub) { opts.args = [rsub, sid, ...args]; didResume = true; }
        console.log('[resume] codex resume', sid, 'in', ownerHome);
      }
    }
  }
  if (opts.requireResume === true && !didResume) {
    return {
      ok: false,
      error: 'Existing session could not be resumed; no replacement process was started.',
      ...(resumeNotFound ? { resumeNotFound: true } : {})
    };
  }
  // Remember which agent owns this PTY so closing the tab can archive it. A
  // live terminal means active — ensureAgent above already cleared `archived`.
  if (opts.hive?.id) {
    ptyToAgent.set(opts.id, opts.hive.id);
    // Worker inbox-wake watchdog (#151): boot grace starts at spawn so the
    // initial orientation prompt is never mistaken for an idle agent.
    workerWake.noteSpawn(opts.id);
  }
  // Pre-accept Claude Code's bypass-mode warning + folder-trust dialog so the
  // agent (spawned with --permission-mode bypassPermissions) doesn't stall on an
  // interactive prompt it can't answer and exit code 1. Best-effort, never blocks.
  // Claude-only — other CLIs handle their own permission UX.
  if (claudeProvider) {
    // The owner's API key, when they chose one over a Claude account. It is
    // approved in ~/.claude.json in the same pass, so Claude never stops to ask.
    const authEnv = claudeAuthEnv();
    try { ensureClaudePermissionsAccepted(opts.cwd, { approveKey: authEnv.ANTHROPIC_API_KEY }); } catch { /* never block spawn */ }
    if (authEnv.ANTHROPIC_API_KEY) opts.env = { ...(opts.env ?? {}), ...authEnv };
  }
  // Suppress first-run interactive prompts for providers that need it (e.g. Codex
  // directory-trust gate via CODEX_NON_INTERACTIVE). Merges into any env already
  // set on opts.
  const nonInteractiveEnv = nonInteractiveEnvForProvider(provider);
  if (Object.keys(nonInteractiveEnv).length > 0) {
    opts.env = { ...(opts.env ?? {}), ...nonInteractiveEnv };
  }
  // ── BYOK keys + per-provider config for the non-Claude CLI engines (v0.3.1) ──
  // OpenCode / Crush / pi / qwen read BYOK API keys from standard env vars and, for
  // the local-LLM path, a per-provider base URL. Keys are write-only in the broker
  // (read MAIN-ONLY here, never logged); base URLs ride HarnessConfig. Claude/codex
  // use their own login, so they skip this. Pam guardrails #3/#4/#5.
  if (opts.hive && (provider === 'opencode' || provider === 'crush' || provider === 'pi' || provider === 'qwen')) {
    const cfg = readConfig();
    const extra: Record<string, string> = {};
    // 1) BYOK keys — LEAST-PRIVILEGE (Pam/Jim NIT-2): inject ONLY the key for the
    //    spawned model's provider prefix when we can identify it; fall back to all
    //    stored keys when the model/prefix is unknown (default model, qwen slugs,
    //    custom). Reduces the blast radius vs handing every CLI all keys.
    const modelIdx = (opts.args ?? []).indexOf('--model');
    const modelSlug = modelIdx >= 0 ? (opts.args?.[modelIdx + 1] ?? '') : '';
    const prefix = modelSlug.includes('/') ? modelSlug.split('/')[0].toLowerCase() : '';
    const PREFIX_BACKEND: Record<string, string> = {
      anthropic: 'anthropic', openai: 'openai', google: 'google', gemini: 'google', groq: 'groq', openrouter: 'openrouter'
    };
    const scoped = PREFIX_BACKEND[prefix];
    const backends = scoped ? [scoped] : Object.keys(BACKEND_KEY_ENV);
    for (const backend of backends) {
      const key = integrations.getSecret(providerKeyRef(backend));
      if (!key) continue;
      extra[BACKEND_KEY_ENV[backend]] = key;
      // OpenCode/AI-SDK's Google provider reads GOOGLE_GENERATIVE_AI_API_KEY, not
      // GEMINI_API_KEY — inject both so google/* authenticates (Jim NIT #1).
      if (backend === 'google') extra.GOOGLE_GENERATIVE_AI_API_KEY = key;
    }
    // 2) Floor auto-state for pi's bundled extension auto-allow (guardrail #5): it
    //    only auto-approves tool calls when this is '1' (i.e. floor auto mode on).
    extra.HIVE_AUTO_APPROVE = cfg.autoMode ? '1' : '0';
    // 3) OpenCode's auto-approve + local provider live in its single config-injection
    //    env var, built dynamically so permission:allow is GATED on autoMode (#2).
    if (provider === 'opencode') {
      const oc: Record<string, unknown> = { autoupdate: false };
      if (cfg.autoMode) oc.permission = { edit: 'allow', bash: 'allow', webfetch: 'allow' };
      const baseUrl = cfg.providerBaseUrls?.opencode;
      if (baseUrl) {
        // Register the model id the user actually selects (the part after 'local/')
        // so `--model local/<id>` resolves; default to 'local'. Without this the
        // dropdown's `local/llama3` failed against a config that only declared model
        // 'local' (Jim verify-opencode MUST-FIX #2).
        const localModel = (prefix === 'local' && modelSlug.slice(6)) || 'local';
        oc.provider = {
          local: { npm: '@ai-sdk/openai-compatible', name: 'Local (self-hosted)', options: { baseURL: baseUrl }, models: { [localModel]: { name: localModel } } }
        };
      }
      extra.OPENCODE_CONFIG_CONTENT = JSON.stringify(oc);
    }
    opts.env = { ...(opts.env ?? {}), ...extra };
  }
  // Codex Remote is daemon-based (there is no `/remote-control` slash command).
  // Start/enable the daemon under this agent's isolated CODEX_HOME and connect
  // the TUI to it so the thread is visible in ChatGPT mobile. Best-effort: an
  // unavailable/older Codex install still gets a normal local terminal.
  if (provider === 'codex' && opts.hive?.id) {
    await enableCodexRemoteForSpawn(opts, opts.hive.id);
  }
  // Mail tools (docs/designs/multi-mailbox.md, eng E1): an agent whose
  // Capabilities include email gets the md-mail MCP server, which Claude Code
  // starts outside the Bash sandbox, holding this agent's own broker token.
  // Revoked in teardownPty with the rest of this PTY's grants. `--mcp-config`
  // takes several values, so it must stay the last argument.
  if (claudeProvider && opts.hive?.id && opts.hive.role !== 'worker' && integrationBroker.running()) {
    const agentId = opts.hive.id;
    const home = readConfig().harnessHome ? expandTilde(readConfig().harnessHome!) : null;
    const root = hive.root();
    // A Send only grant alone gets the tools too (shared-mailboxes.md, item 1).
    if (home && root && hasMailTools(readConfig().agentCapabilities?.[agentId])) {
      try {
        // Fresh token every spawn (#63 rotate on respawn); old path under agents/
        // is removed so siblings cannot read a leftover broker token.
        const token = integrationBroker.grant(opts.id, [], agentId);
        const file = mdMailMcpPath(home, agentId);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ mcpServers: { 'md-mail': { command: hive.nodeCommand(), args: [mdMailScriptPath()], env: { MD_BROKER_URL: integrationBroker.url(), MD_BROKER_TOKEN: token } } } }, null, 2), { mode: 0o600 });
        try { unlinkSync(legacyMdMailMcpPath(root, agentId)); } catch { /* none left */ }
        opts.args = [...(opts.args ?? []), '--mcp-config', file];
      } catch (e) { console.error('[mail] md-mail config:', e); }
    }
  }
  const res = ptyManager.spawn(opts, owner);
  // What its connectors were at start, so a later change can restart it (D2).
  if (res.ok && opts.hive?.id && connectorPlan) {
    const failures = connectorsApplied ? 0 : (connectorsUnapplied.get(opts.hive.id) ?? 0) + 1;
    if (failures) connectorsUnapplied.set(opts.hive.id, failures); else connectorsUnapplied.delete(opts.hive.id);
    connectorPlans.set(opts.id, { agentId: opts.hive.id, sig: failures === 1 ? 'unapplied' : connectorPlan.sig });
  }
  // Record the Claude Code version this agent starts on, only once its terminal
  // is really running: a failed spawn must not count as an agent to upgrade.
  if (res.ok && opts.hive?.id && claudeProvider) {
    const binPath = ptyManager.commandPath(opts.command.trim().split(/\s+/)[0] || opts.command);
    void claudeCliVersion(binPath).then((started) => {
      if (!binPath || !started || !ptyToAgent.has(opts.id)) return;
      ptyCli.set(opts.id, { bin: binPath, started });
      void refreshCliUpdate();
    });
  }
  if (res.ok) analytics.track('agent_spawned', { provider });
  else analytics.track('agent_spawn_failed', { provider, reason: spawnFailReason(res.error) });
  syncKeepAwake(); // arm the power-save blocker while ≥1 agent PTY is alive (#18)
  // Hand the resolved worktree path back to the renderer so it can persist it on
  // the agent (only set when isolation actually provisioned a worktree above).
  // The restore flow re-enters this exact worktree (cwd = worktreePath) so a
  // restored isolated agent resumes in the CORRECT checkout, not the base repo.
  const worktreePath = worktreePaths.get(opts.id);
  // `cwd` echoes back the TILDE-EXPANDED absolute path so the renderer's agent
  // record matches what the registry and the PTY actually used.
  if (res.ok && opts.hive?.id) tellOfficeOpen(opts.hive.id);
  if (res.ok && opts.hive?.isGod) { standupOnOfficeOpen(); catchUpOwnerAnswers(); }
  return { ...res, cwd: opts.cwd, ...(worktreePath ? { worktreePath } : {}), ...(resumeNotFound ? { resumeNotFound: true } : {}), ...(didResume ? { resumed: true } : {}), ...(seedPrompt ? { seedPrompt } : {}) };
}
ipcMain.handle('pty:write', (_evt, id: string, data: string) => {
  if (typeof id !== 'string' || typeof data !== 'string') return { ok: false, error: 'invalid args' };
  return ptyManager.write(id, data);
});
ipcMain.handle('pty:resize', (_evt, id: string, cols: number, rows: number) => {
  if (typeof id !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return { ok: false, error: 'invalid args' };
  return ptyManager.resize(id, cols, rows);
});
// A terminal still drawn past its box after a fit (Windows report, 2026-10-09).
// Numbers and the platform only, so the office log names the case next time.
let lastTerminalOverflowLog = 0;
const loggedOverflowSizes = new Set<string>();
ipcMain.on('terminal:overflow', (_evt, info: unknown) => {
  // At most one line a minute for the whole app, and each terminal size once a
  // session: the log is committed with the office.
  if (Date.now() - lastTerminalOverflowLog < 60_000) return;
  const event = terminalOverflowEvent(info, process.platform);
  const size = event ? [event.rows, event.cols, event.dpr, event.fontSize].join('/') : '';
  if (!event || loggedOverflowSizes.has(size) || loggedOverflowSizes.size >= 20) return;
  loggedOverflowSizes.add(size);
  lastTerminalOverflowLog = Date.now();
  if (event) { try { hive.appendLog(event); } catch { /* best-effort */ } }
});
ipcMain.handle('pty:redraw', (_evt, id: string) => {
  if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
  return ptyManager.redraw(id);
});
ipcMain.handle('pty:kill', (_evt, id: string) => {
  if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
  // Kill the process, then run the shared lifecycle teardown (archive the agent,
  // remove its isolated worktree, drop the maps). teardownPty is idempotent, so
  // node-pty firing onExit once the child actually dies is a harmless no-op.
  const res = ptyManager.kill(id);
  teardownPty(id);
  // The owner closed it: it no longer waits on Claude, so no card or restart.
  claudeBlocked.delete(id);
  return res;
});
ipcMain.handle('pty:list', () => ptyManager.list());

// ─── IPC: analytics (the ONE renderer-facing seam) ──────────────────────────
/** Count one human-sent message (TELEMETRY.md → `message_sent`). A COUNT, and
 *  nothing else: this channel takes no text, no length and no id, so there is
 *  no shape in which message content could cross it.
 *
 *  This is the only analytics event the renderer can cause. It exists because
 *  two of the four send surfaces — a line typed into the agent's terminal, and
 *  the queue composer — are submits main cannot observe: the `pty:write` handler
 *  above fires on EVERY KEYSTROKE, so counting there would produce a keystroke
 *  meter, not a message count. `steer` and `hive` are counted at their own IPC
 *  handlers in this file and are rejected here (isRendererMessageSurface) so
 *  they can never be counted twice. The event name is fixed here, not passed
 *  in: the renderer chooses a surface, never an event. */
ipcMain.handle('analytics:messageSent', (_evt, surface: unknown) => {
  if (!isRendererMessageSurface(surface)) return { ok: false };
  analytics.trackMessageSent(surface);
  return { ok: true };
});

// Resolve a pasted Claude session id to the cwd it originally ran in, so the Add
// Agent dialog can auto-fill the folder for a resume (#2 zero-step resume). Reads
// the cwd from a transcript record; null when the id is invalid/unknown.
ipcMain.handle('session:resolveCwd', (_evt, sessionId: unknown) =>
  (typeof sessionId === 'string' ? resolveSessionCwd(sessionId) : null));

// ─── IPC: clipboard ─────────────────────────────────────────────────────────
ipcMain.handle('app:copyToClipboard', (_evt, text: unknown) => {
  if (typeof text !== 'string') return { ok: false, error: 'invalid text' };
  try { clipboard.writeText(text); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
});
ipcMain.handle('app:readClipboard', () => {
  try { return clipboard.readText(); } catch { return ''; }
});
// Same read, SYNCHRONOUS, for the terminal's paste shortcut.
//
// Dictation tools (muesli.works, Wispr Flow, …) type by stashing the user's
// clipboard, writing the transcript, sending the paste key, then restoring the
// old clipboard immediately. An `invoke` read returns a tick or two later — by
// which point the restore has already landed and we paste the PREVIOUS text.
// A `sendSync` read completes inside the keydown handler, before the tool gets
// a chance to put the old contents back.
ipcMain.on('app:readClipboardSync', (evt) => {
  try { evt.returnValue = clipboard.readText(); } catch { evt.returnValue = ''; }
});
// NOTE: the terminal theme is mirrored into each agent's per-session Claude
// settings at spawn (hive.ensureAgent theme option) — deliberately NOT via
// `claude config set -g theme`, which would also restyle the user's own
// Claude sessions outside the app.

// ─── IPC: folder picker ─────────────────────────────────────────────────────
ipcMain.handle('dialog:chooseFolder', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return { ok: false as const, error: 'no window' };
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Pick a folder'
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false as const, error: 'cancelled' };
  return { ok: true as const, path: res.filePaths[0] };
});

// ─── IPC: a terminal window at a folder ─────────────────────────────────────
ipcMain.handle('terminal:openAtFolder', async (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string' || cwd.length === 0) return { ok: false, error: 'invalid cwd' };
  try { if (!statSync(cwd).isDirectory()) return { ok: false, error: 'not a folder' }; } catch { return { ok: false, error: 'not a folder' }; }
  const launches = terminalLaunches(process.platform, cwd, process.env.ComSpec || 'cmd.exe');
  if (!Array.isArray(launches)) return { ok: false, error: launches.error };
  const run = (l: ProcessLaunch) => new Promise<{ ok: boolean; error?: string; missing?: boolean }>((resolve) => {
    const p = spawn(l.file, l.args, { windowsVerbatimArguments: l.windowsVerbatimArguments, windowsHide: false });
    let err = '';
    p.stderr?.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => resolve({ ok: false, error: e.message, missing: (e as NodeJS.ErrnoException).code === 'ENOENT' }));
    p.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `${l.file} exited ${code}` }));
  });
  let last: { ok: boolean; error?: string } = { ok: false, error: 'no terminal found' };
  for (const l of launches) {
    const r = await run(l);
    if (r.ok || !r.missing) return r.ok ? { ok: true } : { ok: false, error: r.error };
    last = r;
  }
  return { ok: false, error: last.error };
});

// ─── IPC: integrations (Phase 2 registry — backend for Ryan's Settings UI) ────
// Records are metadata only (config-backed); secrets are encrypted at rest and NEVER
// returned over IPC. `list` redacts secretRef to a `hasSecret` boolean.
ipcMain.handle('integrations:list', () => integrations.listRecordsRedacted());
ipcMain.handle('integrations:templates', () => INTEGRATION_TEMPLATES);
ipcMain.handle('integrations:upsert', (_evt, record: unknown) => integrations.upsertRecord(record));
ipcMain.handle('integrations:setSecret', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { id?: unknown; secret?: unknown };
  if (typeof p.id !== 'string' || !p.id) return { ok: false, error: 'id required' };
  if (typeof p.secret !== 'string' || !p.secret) return { ok: false, error: 'secret required' };
  return integrations.setSecret(secretRefFor(p.id), p.secret);
});
ipcMain.handle('integrations:remove', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { id?: unknown };
  if (typeof p.id !== 'string' || !p.id) return { ok: false, error: 'id required' };
  return integrations.removeRecord(p.id);
});
// ─── IPC: per-CLI-provider BYOK keys (write-only) ────────────────────────────
// API keys for the backend model-providers the non-Claude CLIs use are stored
// WRITE-ONLY under `apikey:<backend>` in the same encrypted broker. The renderer
// can SET a key and ASK whether one is set (boolean) — it can never read the
// plaintext back. Keys are materialized MAIN-ONLY at spawn (spawnAgentCore). Base
// URLs are non-secret and ride HarnessConfig.providerBaseUrls (normal config save).
ipcMain.handle('providerKey:set', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { backend?: unknown; key?: unknown };
  if (typeof p.backend !== 'string' || !(p.backend in BACKEND_KEY_ENV)) return { ok: false, error: 'unknown backend' };
  if (typeof p.key !== 'string' || !p.key) return { ok: false, error: 'key required' };
  const res = integrations.setSecret(providerKeyRef(p.backend), p.key);
  // The same Anthropic key signs Claude in when the owner chose one in Get
  // Michael ready: approve the new one and let the step and the card look again.
  if (res.ok && p.backend === 'anthropic' && readConfig().claudeAuth === 'apiKey') {
    try { approveClaudeApiKey(p.key); } catch { /* approved again at each start */ }
    noticeEngineSetup('api-key');
  }
  return res;
});
ipcMain.handle('providerKey:has', (_evt, backend: unknown) =>
  typeof backend === 'string' ? integrations.hasSecret(providerKeyRef(backend)) : false);
ipcMain.handle('providerKey:clear', (_evt, backend: unknown) => {
  if (typeof backend !== 'string' || !(backend in BACKEND_KEY_ENV)) return { ok: false, error: 'unknown backend' };
  try {
    // deleteSecret never throws: false means the key may still be stored.
    if (!integrations.deleteSecret(providerKeyRef(backend))) return { ok: false, error: 'The saved key could not be removed. Try again; if it keeps failing, the saved secrets file needs repair.' };
    if (backend === 'anthropic' && readConfig().claudeAuth === 'apiKey') noticeEngineSetup('api-key');
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
});
// Probe an integration's reachability through the broker's own auth path (admin-only;
// runs in main, so the secret is used but never returned — only the upstream status).
ipcMain.handle('integrations:test', async (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { id?: unknown; path?: unknown };
  if (typeof p.id !== 'string' || !p.id) return { ok: false, error: 'id required' };
  const rec = integrations.getRecord(p.id);
  if (!rec) return { ok: false, error: 'unknown integration' };
  const probe = validateBaseUrl(rec.baseUrl);
  if (!probe.ok) return { ok: false, error: probe.error };
  // Confine the probe path through the SAME gate as the worker forward() path, so an
  // absolute URL / backslash-host / traversal in p.path can't override the origin and
  // exfiltrate the secret to an attacker host. Resolve (and reject) BEFORE the secret
  // is ever materialized, so a bad path never even decrypts it.
  const target = resolveUpstreamUrl(rec.baseUrl, typeof p.path === 'string' ? p.path : '');
  if (!target) return { ok: false, error: 'path escapes the integration baseUrl', code: 'bad_request' };
  const secret = integrations.getSecret(rec.secretRef);
  const headers = buildAuthHeaders(rec.authType, rec.authHeader, secret);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    const r = await fetch(target, { method: 'GET', headers, redirect: 'manual', signal: ac.signal });
    clearTimeout(timer);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ─── IPC: config ────────────────────────────────────────────────────────────
ipcMain.handle('config:get', (): HarnessConfig => readConfig());
ipcMain.handle('config:damagedCopy', (): string | null => damagedConfigCopy());
ipcMain.handle('config:update', (_evt, patch: Partial<HarnessConfig>) => {
  // FIRST RUN: every hive-bound service is started by bootstrapHiveServices(),
  // which runs once at app-ready and early-returns on `!hive.enabled()` — i.e.
  // whenever harnessHome is still null, which is exactly the state a fresh
  // install boots in. Onboarding then sets harnessHome through THIS handler and
  // nothing re-bootstrapped, so the hook server, message router, telemetry
  // collector and mission scheduler all stayed dead for the rest of the session.
  //
  // Symptom: agents spawn and run (the PTY is not hive-bound), but no hook ever
  // reaches the app — no `hooks.sock` on disk, so no SessionStart, which means
  // recordSession() is never called and "Restart & Continue" fails with "No
  // recorded session ID"; the cards also sit on "ctx no status tick yet" and 0
  // tool calls. Everything healed on the next app launch, which is what hid it.
  //
  // changeHome() has always handled this by relaunching; onboarding does not
  // relaunch, so bootstrap here on the null → set transition. Gated on the
  // transition so ordinary config writes never re-enter it.
  const hiveWasEnabled = hive.enabled();
  const wasOnboarded = readConfig().onboardingComplete;
  const next = writeConfig(patch);
  // The office describes itself in <home>/office.json, so a reinstall finds it
  // by folder rather than by the business name typed into setup. Only a save
  // that changes the office's own fields writes it: switching offices changes
  // harnessHome alone, and must not copy one office's team into another.
  if (touchesOffice(patch)) syncOfficeRecord(next);
  // Company knowledge just turned on: index it for search by meaning now.
  if (patch && typeof patch === 'object' && 'knowledgeGraph' in patch) memory.companyKnowledgeChanged();
  // Live opt-in/out from Settings (TELEMETRY.md); stays off while
  // COLLECT_USAGE_STATS is false.
  if (typeof patch?.telemetryEnabled === 'boolean') analytics.setEnabled(COLLECT_USAGE_STATS && patch.telemetryEnabled);
  // Activation funnel (v0.4.6): onboarding just finished (false → true) — the top of
  // the launch → first-agent funnel. `provider` is the engine chosen in the wizard.
  // Fired here (main), not in the renderer, so it rides the same allowlist as the rest.
  if (!wasOnboarded && next.onboardingComplete) {
    analytics.track('onboarding_completed', { provider: next.godProvider ?? 'claude' });
  }
  // Keep the hive's mirror of the spawn gate current. The queue itself reads
  // config per tick so it gates immediately; this is for the PROMPT, which is
  // built per spawn, so flipping the toggle reaches god the next time he starts.
  if (typeof patch?.orchestratorMaySpawn === 'boolean') hive.setOrchestratorMaySpawn(patch.orchestratorMaySpawn);
  if (!hiveWasEnabled && hive.enabled()) {
    console.log('[hive] harnessHome configured — bootstrapping hive services');
    try { bootstrapHiveServices(); } catch (e) { console.error('[hive] bootstrap after onboarding:', e); }
  }
  return next;
});
ipcMain.handle('config:setAgentTokenCap', (_evt, agentId: unknown, tokenCap: unknown) =>
  setAgentTokenCap(agentId, tokenCap)
);
ipcMain.handle('config:ensureHome', (_evt, path: unknown) => {
  if (typeof path !== 'string' || path.length === 0) return { ok: false, error: 'invalid path' };
  return ensureHarnessHome(path);
});

// Change the harnessHome folder. Because every derived path (hive root, palace,
// sock, agent dirs) resolves lazily through getHome(), the only real work is
// optionally MOVING the existing hive + palace and relaunching so every service
// re-binds against the new root. mode: 'move' copies the data (old kept as a
// safety net), 'fresh' just re-points and bootstraps an empty home.
ipcMain.handle('config:changeHome', async (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { newHome?: unknown; mode?: unknown };
  if (typeof p.newHome !== 'string' || !p.newHome) return { ok: false, error: 'invalid newHome' };
  const mode: 'move' | 'fresh' = p.mode === 'fresh' ? 'fresh' : 'move';
  // expandTilde BEFORE resolve: both UI callers feed a folder-dialog result
  // (always absolute), but the hive picker's recents list can serve a literal
  // "~/…" persisted by a pre-#140 build — resolve() would anchor that at cwd
  // and the app would relaunch against a real directory named "~". Same
  // defence-in-depth-at-the-consumer rule as expandTilde's own doc.
  const newHome = resolve(expandTilde(p.newHome));
  const oldRaw = readConfig().harnessHome;
  const oldHome = oldRaw ? resolve(oldRaw) : null;

  // Guard against same-folder / nested-folder (a move would self-copy forever).
  if (oldHome) {
    if (newHome === oldHome) return { ok: false, error: 'That is already the current home folder.' };
    const a = newHome + sep, b = oldHome + sep;
    if (a.startsWith(b) || b.startsWith(a)) {
      return { ok: false, error: 'Pick a folder that is not inside (or a parent of) the current home.' };
    }
  }

  // Refuse a move onto a folder that already holds an office: mode move would
  // copy this office over that one (cpSync with force).
  if (mode === 'move' && homeFolderStatus(newHome).hasOffice) {
    return { ok: false, error: 'That folder already holds an office. Choose an empty folder to move to, or open that office instead.' };
  }

  const ensured = ensureHarnessHome(newHome);
  if (!ensured.ok) return ensured;

  // Tear down everything bound to the OLD root before copying, so nothing writes
  // mid-copy — a live git commit into hive/.git would otherwise be copied as a
  // half-written object and corrupt the moved repo.
  try { clearMissionTimers(); } catch (e) { console.error('[changeHome] clearMissionTimers:', e); }
  try { clearContextTimers(); } catch (e) { console.error('[changeHome] clearContextTimers:', e); }
  try { stopWebhookDoneObserver(); } catch (e) { console.error('[changeHome] stopWebhookDoneObserver:', e); }
  try { stopEphemeralWorkerWatcher(); } catch (e) { console.error('[changeHome] stopWorkerWatcher:', e); }
  try { integrationBroker.stop(); } catch (e) { console.error('[changeHome] broker.stop:', e); }
  try { mailService.closeAll(); } catch (e) { console.error('[changeHome] mail.closeAll:', e); }
  try { hive.stopRouter(); } catch (e) { console.error('[changeHome] stopRouter:', e); }
  try { hookServer.stop(); } catch (e) { console.error('[changeHome] hookServer.stop:', e); }
  try { stopSlackServer(); } catch (e) { console.error('[changeHome] slack.stop:', e); }
  try { stopWebhookServer(); } catch (e) { console.error('[changeHome] webhook.stop:', e); }
  try { memory.stop(); } catch (e) { console.error('[changeHome] memory.stop:', e); }
  try { memoryTidy.stop(); } catch (e) { console.error('[changeHome] memoryTidy.stop:', e); }

  if (mode === 'move' && oldHome) {
    try {
      // roster.json + its backups ride along with hive/palace: the roster is the
      // renderer's half of the same state, and leaving it behind would move the
      // agents' sessions and memory to the new home while their names, notes and
      // worktree paths stayed at the old one.
      for (const sub of ['hive', 'palace', 'roster.json', 'roster-backups']) {
        const src = join(oldHome, sub);
        if (!existsSync(src)) continue;
        // cpSync copies the whole tree incl. .git and is cross-device safe (unlike
        // renameSync, which throws EXDEV across volumes). We COPY, never delete —
        // the old folder stays as a safety net the user removes manually.
        cpSync(src, join(newHome, sub), { recursive: true, force: true, dereference: false });
      }
    } catch (e) {
      // Copy failed: recover IN PLACE against the unchanged old home (config never
      // repointed) so the user loses nothing, and surface the error — no relaunch.
      bootstrapHiveServices();
      const cfg = readConfig();
      if (cfg.slackEnabled && cfg.slackSigningSecret) void startSlackServer();
      reconcileWebhookServer();
      return { ok: false, error: `Could not copy data: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Repoint config and relaunch so every service re-bootstraps against newHome.
  // (Identical recovery path to resetAll — relaunch is the clean re-bind.)
  allowQuit = true;
  writeConfig({ harnessHome: newHome });
  try { ptyManager.killAll(); } catch (e) { console.error('[changeHome] killAll:', e); }
  restartApp(app);
  return { ok: true as const }; // unreachable (process exits) — typed for the renderer
});

/** Setup asks what is in a folder before it creates anything: an office, and if
 *  so its business and team (office.json, else the hive registry). */
ipcMain.handle('office:find', (_evt, path: unknown) => {
  const home = typeof path === 'string' && path.trim() ? resolve(expandTilde(path.trim())) : readConfig().harnessHome;
  return home ? findOffice(home) : { path: null, hasOffice: false, record: null, source: null };
});
/** Is an office folder there? No path = the current home. The launch screen
 *  uses it to decide between the floor and "we can't find your office", and
 *  Settings uses it to tell an existing office from an empty folder. */
ipcMain.handle('config:homeStatus', (_evt, path: unknown) =>
  homeFolderStatus(typeof path === 'string' && path ? resolve(expandTilde(path)) : readConfig().harnessHome ?? null)
);

/** Start an empty office in the CURRENT home path, after the old one went
 *  missing. The owner asked for it on the "we can't find your office" screen,
 *  so rebuilding is now deliberate. Relaunches, like every home change. */
ipcMain.handle('config:startOverHere', () => {
  const home = readConfig().harnessHome;
  if (!home) return { ok: false, error: 'No office folder is set.' };
  const ensured = ensureHarnessHome(home);
  if (!ensured.ok) return ensured;
  // Create the empty office itself (hive/registry.json), not just the folder:
  // launch only trusts a folder that holds an office, so a bare folder would
  // bring the owner straight back to the "can't find your office" screen.
  try { hive.ensureHive(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  allowQuit = true;
  try { ptyManager.killAll(); } catch (e) { console.error('[startOverHere] killAll:', e); }
  restartApp(app);
  return { ok: true as const }; // unreachable (process exits)
});

// ─── IPC: filesystem (sandboxed to a root) ──────────────────────────────────
ipcMain.handle('fs:listDir', (_evt, root: unknown, rel: unknown) => {
  if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
  return listDir(root, rel);
});
ipcMain.handle('fs:readFile', (_evt, root: unknown, rel: unknown) => {
  if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
  return readFileText(root, rel);
});
// Raw bytes for files the text reader refuses (images). The renderer cannot
// load them off disk itself — the CSP has no `file:` source and no file
// protocol is registered — so the bytes come through here and become a `blob:`
// URL on the other side. Same root confinement as every other fs handler.
ipcMain.handle('fs:readBinary', (_evt, root: unknown, rel: unknown) => {
  if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
  return readFileBinary(root, rel);
});
ipcMain.handle('fs:writeFile', (_evt, root: unknown, rel: unknown, content: unknown) => {
  if (typeof root !== 'string' || typeof rel !== 'string' || typeof content !== 'string') {
    return { ok: false, error: 'invalid args' };
  }
  return writeFileText(root, rel, content);
});
// v0.3.4: existence check for the terminal ⌘-click markdown flow (metadata only).
ipcMain.handle('fs:statAbs', (_evt, p: unknown) => {
  if (typeof p !== 'string' || p.length > 4096 || p.includes('\0')) {
    return { exists: false, isFile: false, path: '' };
  }
  return statAbs(p);
});

/** Reveal a path in the OS file browser — Finder, Explorer, or whatever the
 *  Linux desktop registers. Backs ⌘-click on a terminal path we cannot open
 *  ourselves (an image, an archive, an unknown extension).
 *
 *  `showItemInFolder`, NEVER `shell.openPath`, for a file. The path arrives
 *  from agent output, and openPath hands an arbitrary file to its default
 *  application: a printed `installer.dmg` or `.desktop` would be one click from
 *  executing. Revealing only ever opens a file browser, so the worst an agent
 *  can achieve by printing a path is a window at a folder the user could
 *  already open themselves.
 *
 *  openPath IS used for a plain directory, and only after statAbs has confirmed
 *  it is one: revealing a folder inside its parent is not what "open this
 *  folder" means to anyone. The exception is a directory with a macOS package
 *  ending (PACKAGE_EXTENSIONS in fs.ts, such as `.app` or `.pages`): openPath
 *  launches `Tool.app`, so it is shown in its parent like a file (eng review
 *  R4, 2026-10-04). Every other folder opens, dots in its name included
 *  (`acme.com`, `Q3.2026`). */
ipcMain.handle('fs:revealPath', async (_evt, p: unknown) => {
  if (typeof p !== 'string' || !p.length || p.length > 4096 || p.includes('\0')) {
    return { ok: false, error: 'bad request' };
  }
  const st = await statAbs(p);
  if (!st.exists) return { ok: false, error: 'not found' };
  if (st.isFile || !opensAsFolder(st.path)) { shell.showItemInFolder(st.path); return { ok: true }; }
  const err = await shell.openPath(st.path);
  return err ? { ok: false, error: err } : { ok: true };
});

/** Where an Ask me question's files may be found and opened (askFileRootsFor
 *  in fs.ts). Main reads the office and the registry itself; the renderer only
 *  names who raised the question and who it is assigned to. */
function askFileRoots(who: unknown): string[] {
  const cfg = readConfig();
  const office = cfg.businessFolder ?? legacyBusinessFolder(cfg.officeFolder);
  // gstack-shortcut(dec-150d1c26-a7b6-4411-b059-faad20888603): a team folder outside the office folder widens Open, upgrade when any team folder sits outside businessFolder or an outside user onboards
  let agents: Record<string, AskFileAgent> = {};
  try { agents = hive.registry().agents; } catch { /* no hive yet */ }
  return askFileRootsFor(office, agents, who);
}

const askFilePathOk = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= 1024 && !p.includes('\0');

/** What each named file of an Ask me question can do: open, reveal or missing. */
ipcMain.handle('fs:askFiles', async (_evt, paths: unknown, who: unknown) => {
  if (!Array.isArray(paths)) return [];
  // Each root's realpath once for the whole card, not once per path.
  const roots = await resolveAskFileRoots(askFileRoots(who));
  return Promise.all(paths.slice(0, 20).map((p) => (askFilePathOk(p)
    ? askFileVerdict(p, roots).then((r) => ({ verdict: r.verdict, tab: r.tab, path: r.path }))
    : { verdict: 'missing' as const, tab: false, path: String(p) })));
});

/** Where a file sits, in office terms, for the file tab's folder line
 *  (docs/designs/open-file-tab.md, DD4): the office, or the team member whose
 *  folder holds it, and the folders below that. */
function askFilePlace(root: string, real: string, path: string): { place: string; folder: string[] } {
  const cfg = readConfig();
  const office = cfg.businessFolder ?? legacyBusinessFolder(cfg.officeFolder);
  const same = (a?: string) => !!a && resolve(expandTilde(a)) === resolve(root);
  let place = 'office';
  if (!same(office)) {
    let agents: Record<string, AskFileAgent> = {};
    try { agents = hive.registry().agents; } catch { /* no hive yet */ }
    place = Object.keys(agents).find((id) => same(agents[id]?.cwd)) ?? 'office';
  }
  // The read path is canonical, so the folders below are taken from the root's
  // canonical path; which root it was is matched as configured.
  const below = path.startsWith(real) ? path.slice(real.length) : basename(path);
  return { place, folder: dirname(below).split(/[\\/]/).filter((f) => f && f !== '.') };
}

/** Read a named file for its office tab. The same folder check as Open runs
 *  again here; the renderer's earlier verdict never decides. */
ipcMain.handle('fs:readAskFile', async (_evt, p: unknown, who: unknown) => {
  if (!askFilePathOk(p)) return { ok: false, error: 'not found' };
  const r = await readAskFile(p, askFileRoots(who));
  if (!r.ok) {
    if (r.error !== 'not found') console.warn(`[fs:readAskFile] ${r.error}: ${p}`);
    return r;
  }
  return { ...r, ...askFilePlace(r.root, r.real, r.path) };
});

/**
 * Live refresh for open file tabs (open-file-tab.md, E1). Main watches the
 * file's FOLDER, filtered to its name: editors and agents often write a new
 * file and rename it over the old one, which ends a watch on the file itself,
 * and a deleted file cannot be watched until it comes back. At most 5 per
 * window, the same as the tabs; a window that reloads, crashes or closes drops
 * its watchers.
 */
const askFileWatches = new Map<number, Map<string, { close: () => void }>>();
const MAX_ASK_FILE_WATCHES = 5;
ipcMain.handle('fs:watchAskFile', async (evt, id: unknown, p: unknown, who: unknown) => {
  if (typeof id !== 'string' || !askFilePathOk(p)) return { ok: false };
  const v = await askFileVerdict(p, askFileRoots(who));
  if (v.verdict === 'missing' || !v.tab) return { ok: false };
  const wc = evt.sender;
  let mine = askFileWatches.get(wc.id);
  if (!mine) {
    const forWindow = new Map<string, { close: () => void }>();
    askFileWatches.set(wc.id, forWindow);
    mine = forWindow;
    // Each drop removes its own listeners, so a window that reloads many times
    // never stacks them, and an old drop never clears a newer map.
    const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) drop();
    };
    const drop = () => {
      for (const w of forWindow.values()) w.close();
      forWindow.clear();
      if (askFileWatches.get(wc.id) === forWindow) askFileWatches.delete(wc.id);
      wc.off('destroyed', drop);
      wc.off('render-process-gone', drop);
      wc.off('did-start-navigation', onNavigate);
    };
    wc.once('destroyed', drop);
    wc.once('render-process-gone', drop);
    wc.on('did-start-navigation', onNavigate);
  }
  mine.get(id)?.close();
  if (mine.size >= MAX_ASK_FILE_WATCHES) {
    const [oldest] = mine.keys();
    mine.get(oldest)?.close();
    mine.delete(oldest);
  }
  const name = basename(v.path);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const watcher = watchFs(dirname(v.path), (_type, file) => {
      if (file && file.toString() !== name) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!wc.isDestroyed()) wc.send('fs:askFileChanged', id); }, 300);
    });
    watcher.on('error', (e) => console.warn(`[fs:watchAskFile] ${(e as NodeJS.ErrnoException).code ?? e}: ${v.path}`));
    mine.set(id, { close: () => { if (timer) clearTimeout(timer); watcher.close(); } });
    return { ok: true };
  } catch (e) {
    console.warn(`[fs:watchAskFile] ${(e as NodeJS.ErrnoException).code ?? e}: ${v.path}`);
    return { ok: false };
  }
});
ipcMain.handle('fs:unwatchAskFile', (evt, id: unknown) => {
  const mine = askFileWatches.get(evt.sender.id);
  if (typeof id !== 'string' || !mine) return;
  mine.get(id)?.close();
  mine.delete(id);
});

/** Open an Ask me question's file. The check runs again here, so the renderer's
 *  earlier verdict never decides; a document that cannot open is shown instead. */
ipcMain.handle('fs:openAskFile', async (_evt, p: unknown, who: unknown) => {
  if (!askFilePathOk(p)) return { ok: false, error: 'bad request' };
  const r = await askFileVerdict(p, askFileRoots(who));
  if (r.verdict === 'missing') return { ok: false, error: 'not found' };
  if (r.verdict === 'open' && !(await shell.openPath(r.path))) return { ok: true, action: 'opened' as const };
  shell.showItemInFolder(r.path);
  return { ok: true, action: 'revealed' as const };
});

// ─── IPC: git ───────────────────────────────────────────────────────────────
ipcMain.handle('git:isRepo', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string') return false;
  return isRepo(cwd);
});

// The repo a cwd belongs to, following a linked worktree back to its main
// checkout — the renderer groups the agent roster by this.
ipcMain.handle('git:mainRepo', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string' || !cwd) return null;
  return mainRepoRoot(cwd);
});
ipcMain.handle('git:branch', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid cwd' };
  return getBranch(cwd);
});
ipcMain.handle('git:status', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid cwd' };
  return getStatus(cwd);
});
ipcMain.handle('git:log', (_evt, cwd: unknown, n: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid cwd' };
  const count = typeof n === 'number' ? Math.min(500, Math.max(1, n)) : 50;
  return getLog(cwd, count);
});
ipcMain.handle('git:branches', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid cwd' };
  return getBranches(cwd);
});
ipcMain.handle('git:aheadBehind', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid cwd' };
  return getAheadBehind(cwd);
});
ipcMain.handle('git:diff', (_evt, cwd: unknown, relPath: unknown) => {
  if (typeof cwd !== 'string' || typeof relPath !== 'string') {
    return { ok: false, error: 'invalid args' };
  }
  return getDiff(cwd, relPath);
});
// ─── v0.3.4: history / compare / checkout (git visualization) ───────────────
ipcMain.handle('git:logGraph', (_evt, cwd: unknown, n: unknown, skip: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid args' };
  const count = Math.min(500, Math.max(1, typeof n === 'number' ? n : 200));
  const off = Math.max(0, typeof skip === 'number' ? skip : 0);
  return getLogGraph(cwd, count, off);
});
ipcMain.handle('git:commitFiles', (_evt, cwd: unknown, sha: unknown) => {
  if (typeof cwd !== 'string' || typeof sha !== 'string') return { error: 'invalid args' };
  return getCommitFiles(cwd, sha);
});
ipcMain.handle('git:showFile', (_evt, cwd: unknown, rev: unknown, relPath: unknown) => {
  if (typeof cwd !== 'string' || typeof rev !== 'string' || typeof relPath !== 'string') {
    return { ok: false, error: 'invalid args' };
  }
  return getFileAtRev(cwd, rev, relPath);
});
ipcMain.handle('git:compareRefs', (_evt, cwd: unknown, base: unknown, head: unknown, mode: unknown) => {
  if (typeof cwd !== 'string' || typeof base !== 'string' || typeof head !== 'string') {
    return { error: 'invalid args' };
  }
  return compareRefs(cwd, base, head, mode === 'two' ? 'two' : 'three');
});
ipcMain.handle('git:worktrees', (_evt, cwd: unknown) => {
  if (typeof cwd !== 'string') return { error: 'invalid args' };
  return listWorktrees(cwd);
});
ipcMain.handle('git:checkout', async (_evt, cwd: unknown, ref: unknown, detach: unknown) => {
  if (typeof cwd !== 'string' || typeof ref !== 'string') return { ok: false, error: 'invalid args' };
  // Guard: never swap files under an actively-working agent. Objective signal
  // owned by main — any live pty whose cwd sits in this tree and emitted output
  // in the last 10s is treated as mid-run. (Idle-but-open terminals are fine:
  // checkoutRef additionally requires a clean tree, and TUIs redraw on fs
  // changes gracefully.)
  const busy = ptyManager.list().find((p) =>
    (p.cwd === cwd || p.cwd.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`)) &&
    Date.now() - p.lastOutputAt < 10_000
  );
  if (busy) {
    return { ok: false, error: `an agent is actively working in this repo (${busy.id}). Try again when it goes quiet` };
  }
  return checkoutRef(cwd, ref, detach === true);
});

// ─── IPC: roster mirror (shared between dev and a packaged build) ───────────
// The renderer's store is built synchronously at module load, before any async
// IPC could resolve, so the read is `ipcMain.on` + `returnValue` — one blocking
// round trip at boot, in exchange for the roster being correct on first paint
// instead of flashing an empty floor and then filling in.
// (`roster` itself is constructed earlier so HookServer can read standing goals.)
ipcMain.on('roster:readSync', (evt) => { evt.returnValue = roster.read(); });
ipcMain.on('config:homeSync', (evt) => { evt.returnValue = readConfig().harnessHome ?? null; });
ipcMain.handle('roster:read', () => roster.read());
ipcMain.handle('roster:write', (_evt, snap: unknown) => roster.write(snap));
ipcMain.handle('roster:backup', (_evt, reason: unknown) =>
  ({ ok: roster.backupNow(typeof reason === 'string' && /^[a-z0-9-]{1,40}$/.test(reason) ? reason : 'manual') }));

// ─── IPC: hive (multi-agent coordination) ───────────────────────────────────
ipcMain.handle('hive:registry', () => hive.registry());
ipcMain.handle('hive:renameAgent', (_evt, id: unknown, name: unknown) => {
  if (typeof id !== 'string' || typeof name !== 'string') {
    return { ok: false, error: 'Invalid rename request' };
  }
  return hive.renameAgent(id, name);
});
ipcMain.handle('hive:setAgentHold', (_evt, id: unknown, hold: unknown) => {
  if (typeof id !== 'string' || typeof hold !== 'boolean') {
    return { ok: false, error: 'Invalid hold request' };
  }
  return hive.setAgentHold(id, hold);
});
ipcMain.handle('hive:board', () => hive.board());
ipcMain.handle('hive:tasks', () => hive.tasks());
ipcMain.handle('hive:log', (_evt, n: unknown, kind: unknown, since: unknown) => hive.logTail(typeof n === 'number' ? n : 200, typeof kind === 'string' ? kind : undefined, typeof since === 'number' ? since : undefined));
ipcMain.handle('hive:memory', (_evt, id: unknown) => (typeof id === 'string' ? hive.memory(id) : ''));
ipcMain.handle('hive:memoryDetail', (_evt, id: unknown) => (typeof id === 'string' ? hive.memoryDetail(id) : { index: '', waiting: 0 }));
ipcMain.handle('hive:procedure', (_evt, id: unknown, slug: unknown) =>
  (typeof id === 'string' && typeof slug === 'string' ? hive.procedure(id, slug) : null));
ipcMain.handle('hive:inbox', (_evt, id: unknown) => (typeof id === 'string' ? hive.inbox(id) : []));

// ─── IPC: mailboxes and Capabilities (docs/designs/multi-mailbox.md) ─────────
// Records carry no password; the renderer only ever sends one, to save it.
ipcMain.handle('mail:save', async (_evt, input: unknown) => {
  if (!input || typeof input !== 'object') return { ok: false, kind: 'invalid', reason: 'Nothing to save.' };
  const fixId = (input as { id?: unknown }).id;
  const before = typeof fixId === 'string' ? (readConfig().mailboxes ?? []).find((m) => m.id === fixId) : undefined;
  const res = await saveMailbox(mailService, mailAdmin, PROVIDER_PRESETS, input as AddMailboxInput);
  // Fixing a mailbox closes its Ask me card (MB-7). Not only when it needed the
  // owner before: a failure during the login test can open the card after
  // `before` was read, and the fix that just worked has to close it too.
  if (res.ok && before) closeMailboxCard(res.record.id, `${res.record.address} is connected again.`);
  return res;
});
ipcMain.handle('mail:remove', (_evt, id: unknown) => {
  if (typeof id !== 'string') return { ok: false, affected: [] };
  const rec = (readConfig().mailboxes ?? []).find((m) => m.id === id);
  const res = removeMailbox(mailService, mailAdmin, id);
  if (res.ok && rec?.status === 'needs-attention') closeMailboxCard(id, `${rec.address} was removed in Settings.`);
  return res;
});
ipcMain.handle('mail:setCapabilities', (_evt, agentId: unknown, caps: unknown) => {
  if (typeof agentId !== 'string' || !caps || typeof caps !== 'object') return { ok: false, restartNeeded: false };
  return setAgentCapabilities(mailAdmin, agentId, caps as Parameters<typeof setAgentCapabilities>[2]);
});
/** A member's Send only grant (docs/designs/shared-mailboxes.md), or null to remove it. */
ipcMain.handle('mail:setSendOnly', (_evt, agentId: unknown, grant: unknown) => {
  if (typeof agentId !== 'string') return { ok: false, restartNeeded: false };
  if (grant !== null && (!grant || typeof grant !== 'object')) return { ok: false, restartNeeded: false };
  return setSendOnly(mailAdmin, agentId, grant as { mailbox?: unknown; sending?: unknown } | null);
});
/** Roles that may use QuickBooks, Read only, before the owner chooses. */
ipcMain.handle('quickbooks:roleDefaults', () => [...booksReadRoleIds()]);
/** Save one agent's QuickBooks capability. The hook reads it on the agent's
 *  next call, so nothing restarts. Only for a team member, or the new id of a
 *  hire in progress (issue 132); anything else writes nothing. */
ipcMain.handle('quickbooks:setAccess', (_evt, agentId: unknown, cap: unknown, opts: unknown) => {
  const onTeam = (id: string): boolean => { try { return Object.prototype.hasOwnProperty.call(hive.registry().agents, id); } catch { return false; } };
  const quickbooks = quickbooksAccessToSave(agentId, cap, onTeam, (opts as { hiring?: unknown } | undefined)?.hiring === true);
  if (!quickbooks) return { ok: false };
  const id = agentId as string;
  const cfg = readConfig();
  const caps = cfg.agentCapabilities ?? {};
  writeConfig({ agentCapabilities: { ...caps, [id]: { ...(caps[id] ?? {}), quickbooks } } });
  return { ok: true };
});
// ─── Claude connectors (docs/designs/claude-connectors.md, owner 2026-10-02) ───
// The connectors on the owner's Claude account, read with `claude mcp list` at
// app start, when Settings > Connections opens, and on Refresh. A failed read
// keeps the last good list; until one read succeeds every agent starts with
// none. The first good read also carries the old choices over (D9) and tells
// the owner, once, which connectors the update turned off (E2).
let connectorsRead: Promise<void> | null = null;
/** Successful reads in a row that listed no connector; a second one is
 *  believed. Any failed read starts the count again. */
let connectorsEmptyReads = 0;
function connectorsPush(): void {
  try { liveWebContents()?.send('connectors:reading', connectorsRead !== null); } catch { /* window gone */ }
}
/** Saves a failed read: the last good list stays, with the time it failed. */
function connectorsReadFailed(why: string, started: number): void {
  const prev = readConfig().claudeConnectors;
  console.warn(`[connectors] read failed: ${why} after ${Date.now() - started} ms; keeping the last good list`);
  writeConfig({ claudeConnectors: { list: prev?.list ?? null, servers: prev?.servers, readAt: prev?.readAt, failedAt: Date.now() } });
}
function refreshClaudeConnectors(why: string): Promise<void> {
  if (connectorsRead) return connectorsRead;
  const started = Date.now();
  connectorsRead = readClaudeMcpList(ptyManager.commandPath(claudeBinFor(readConfig().defaultCommand)))
    .then((r) => {
      const cfg = readConfig();
      const prev = cfg.claudeConnectors;
      if (!r.ok) { connectorsEmptyReads = 0; connectorsReadFailed(`${why}, ${r.why}`, started); return; }
      let { connectors, servers } = r.list;
      // A run that exited non-zero may have stopped part way: it may add, never
      // remove, so whatever the last good read had stays in, except an entry
      // whose address this run lists under a new name (a rename, moved below).
      if (!r.complete) {
        const seen = new Set(connectors.map((c) => c.key));
        const urls = new Set(connectors.map((c) => c.url).filter(Boolean));
        connectors = [...connectors, ...(prev?.list ?? []).filter((c) => !seen.has(c.key) && !(c.url && urls.has(c.url)))];
        servers = [...new Set([...servers, ...(prev?.servers ?? [])])];
      }
      // Enough of a list for the one-time carry-over: a complete run, or one
      // that lists connectors (older Claude Code exits non-zero whenever a
      // server fails). With the old Gmail switch on it must list a connector
      // at all, and a partial run must list Gmail or Calendar: an empty or cut
      // off list would use up the carry-over and lose that yes for good.
      const emailOn = emailCalendarAllowed(cfg.mcpDefaults);
      const listed = r.list.connectors.length > 0;
      const carryable = emailOn
        ? listed && (r.complete || r.list.connectors.some((c) => isEmailCalendarKey(c.key)))
        : r.complete || listed;
      // A read that lists the owner's own servers but no connector at all,
      // after one that had some, is the account not answering (offline, signed
      // out), not every connector removed. The same before the carry-over of
      // the old Gmail switch, which needs the connectors to grant.
      // Two such reads in a row are believed: the account really has none.
      connectorsEmptyReads = connectors.length === 0 ? connectorsEmptyReads + 1 : 0;
      if (connectors.length === 0 && connectorsEmptyReads < 2 && ((prev?.list?.length ?? 0) > 0 || (!cfg.connectorsMigrated && emailCalendarAllowed(cfg.mcpDefaults)))) {
        connectorsReadFailed(`${why}, no connectors listed`, started);
        return;
      }
      console.log(`[connectors] read (${why}): ${connectors.length} connectors, ${servers.length} other servers in ${Date.now() - started} ms`);
      // A renamed connector (same address) keeps its switch, grants and seen mark.
      let connectorsOn = { ...(cfg.connectorsOn ?? {}) };
      let agentCapabilities = { ...(cfg.agentCapabilities ?? {}) };
      let connectorsSeen = cfg.connectorsSeen;
      for (const { from, to } of renamedKeys(prev?.list, connectors)) {
        if (from in connectorsOn) { connectorsOn[to] = connectorsOn[from]; delete connectorsOn[from]; }
        for (const [id, caps] of Object.entries(agentCapabilities)) {
          if (caps?.connectors?.includes(from)) agentCapabilities[id] = { ...caps, connectors: caps.connectors.map((k) => (k === from ? to : k)) };
        }
        if (connectorsSeen?.includes(from)) connectorsSeen = connectorsSeen.map((k) => (k === from ? to : k));
        console.log(`[connectors] ${from} is now ${to}; its switch and grants moved`);
      }
      const patch: Partial<HarnessConfig> = { claudeConnectors: { list: connectors, servers, readAt: Date.now() }, connectorsSeen };
      // The one-time carry-over needs the office's team and a whole list, so it
      // waits for an open office and a complete read (D9).
      if (!cfg.connectorsMigrated && hive.enabled() && carryable) {
        const reg = hive.registry();
        const agentIds = [...new Set([...Object.keys(reg.agents ?? {}), ...(reg.godId ? [reg.godId] : [])])];
        const carried = connectorCarryOver({ ...cfg, connectorsOn, agentCapabilities }, connectors, agentIds);
        connectorsOn = carried.connectorsOn;
        agentCapabilities = carried.agentCapabilities;
        patch.connectorsMigrated = true;
        if (carried.switchedOff.length) connectorsUpgradeCard(carried.switchedOff);
        console.log(`[connectors] carried over: ${agentIds.length} agents, switched off: ${carried.switchedOff.join(', ') || 'none'}`);
      }
      writeConfig({ ...patch, connectorsOn, agentCapabilities });
    })
    .catch((e) => {
      connectorsEmptyReads = 0;
      console.error('[connectors] read:', e);
      try { connectorsReadFailed(`${why}, ${e instanceof Error ? e.message : String(e)}`, started); } catch { /* config unwritable */ }
    })
    .finally(() => { connectorsRead = null; connectorsPush(); });
  connectorsPush();
  return connectorsRead;
}

/** E2: one Ask me card after the update naming the connectors agents could
 *  use before and now cannot, until the owner turns them on. */
function connectorsUpgradeCard(keys: string[]): void {
  try {
    const now = new Date().toISOString();
    hive.addTask({
      id: 'claude-connectors-update',
      title: 'Claude connectors are now off',
      status: 'blocked',
      dependsOn: [],
      priority: 2,
      createdAt: now,
      humanQA: [{
        q: `**${keys.join(', ')} ${keys.length === 1 ? 'is' : 'are'} now off for the team.**\n\nAgents used to reach every connector on your Claude account. Now each one is off until you turn it on in Settings, Connections, Claude connectors, and give it to the team members who need it on their Access tab.`,
        askedAt: now,
        raisedBy: 'god'
      }]
    });
  } catch (e) { console.error('[connectors] ask me card:', e); }
}

/** What each running agent started with, by terminal: its connector plan. A
 *  config change that would start it differently asks the renderer to restart
 *  it when idle (D2), resuming its thread; the hook enforces the change until then. */
// An agent stripped because its hive injection failed is asked to restart
// once (the failure may have passed); after a second failure in a row it is
// recorded with its plan, so only a real change asks again, never every config
// save while the failure lasts.
const connectorPlans = new Map<string, { agentId: string; sig: string; told?: string }>();
const connectorsUnapplied = new Map<string, number>();
/** What an agent would start with: its plan, plus whether each connector it
 *  uses is signed in (Claude loads no tools for one that needs sign in, so
 *  signing in later needs a restart too). */
function connectorStart(cfg: HarnessConfig, agentId: string): { plan: SpawnConnectorPlan; sig: string } {
  const books = agentHasBooksRead(agentId);
  const plan = spawnConnectorPlan(cfg, agentId, books);
  const signedIn = usableConnectors(cfg, agentId, books).map((c) => `${c.key}:${c.status}`).sort().join(',');
  return { plan, sig: `${plan.strip ? 'strip' : [...plan.deny].sort().join('|')}#${signedIn}` };
}
onConfigWritten((cfg) => {
  for (const rec of connectorPlans.values()) {
    const { sig } = connectorStart(cfg, rec.agentId);
    if (sig === rec.sig) { rec.told = undefined; continue; }
    if (rec.told === sig) continue;
    rec.told = sig;
    console.log(`[connectors] ${rec.agentId} needs a restart to apply its connectors`);
    try { liveWebContents()?.send('connectors:restartNeeded', { agentId: rec.agentId }); } catch { /* window gone */ }
  }
});

ipcMain.handle('connectors:refresh', (_evt, why: unknown) => {
  const reason = typeof why === 'string' ? why : 'refresh';
  // Opening Connections reads again only when the last read is a minute old;
  // each read starts every MCP server the owner has. Refresh always reads.
  const last = readConfig().claudeConnectors;
  if (reason === 'settings' && Math.max(last?.readAt ?? 0, last?.failedAt ?? 0) > Date.now() - 60_000) return Promise.resolve();
  return refreshClaudeConnectors(reason);
});
ipcMain.handle('connectors:reading', () => connectorsRead !== null);
/** Agents whose connectors changed since they started, for a window that
 *  missed the restartNeeded push (it opened late or reloaded). */
ipcMain.handle('connectors:pendingRestarts', () => {
  const cfg = readConfig();
  return [...new Set([...connectorPlans.values()].filter((rec) => connectorStart(cfg, rec.agentId).sig !== rec.sig).map((rec) => rec.agentId))];
});
/** The owner's switch for one connector (QuickBooks keeps quickbooksClaude). */
ipcMain.handle('connectors:setOn', (_evt, key: unknown, on: unknown) => {
  if (typeof key !== 'string' || !key) return { ok: false };
  if (isQuickBooksKey(key)) { writeConfig({ quickbooksClaude: on === true }); return { ok: true }; }
  writeConfig({ connectorsOn: { ...(readConfig().connectorsOn ?? {}), [key]: on === true } });
  return { ok: true };
});
/** Give or take one connector from one agent. */
ipcMain.handle('connectors:setGrant', (_evt, agentId: unknown, key: unknown, granted: unknown) => {
  if (typeof agentId !== 'string' || !agentId || typeof key !== 'string' || !key || isQuickBooksKey(key)) return { ok: false };
  const caps = readConfig().agentCapabilities ?? {};
  const cur = caps[agentId]?.connectors ?? [];
  const connectors = granted === true ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
  writeConfig({ agentCapabilities: { ...caps, [agentId]: { ...(caps[agentId] ?? {}), connectors } } });
  return { ok: true };
});
/** Forget a connector that left the Claude account: its switch and grants. */
ipcMain.handle('connectors:clear', (_evt, key: unknown) => {
  if (typeof key !== 'string' || !key) return { ok: false };
  const cfg = readConfig();
  const connectorsOn = { ...(cfg.connectorsOn ?? {}) };
  delete connectorsOn[key];
  const agentCapabilities = Object.fromEntries(Object.entries(cfg.agentCapabilities ?? {}).map(([id, caps]) =>
    [id, caps?.connectors?.includes(key) ? { ...caps, connectors: caps.connectors.filter((k) => k !== key) } : caps]));
  writeConfig({ connectorsOn, agentCapabilities });
  return { ok: true };
});
/** The owner opened the list: what they saw is no longer new. */
ipcMain.handle('connectors:seen', () => {
  const cfg = readConfig();
  const keys = cfg.claudeConnectors?.list?.map((c) => c.key);
  // Only a change is saved: every save tells the renderer, which must not loop.
  if (keys && keys.join('\n') !== (cfg.connectorsSeen ?? []).join('\n')) writeConfig({ connectorsSeen: keys });
  return { ok: true };
});
/** An agent's handoff history, received and sent, for its Messages tab. */
ipcMain.handle('hive:history', (_evt, id: unknown) => (typeof id === 'string' ? hive.messageHistory(id) : []));
// Voice read-layer: recent message CONTENT (inbox/outbox bodies), REDACTED
// main-side by hive.voiceMessages(). The renderer/voice layer never sees a raw
// body — secrets are stripped here, before the result crosses IPC.
ipcMain.handle('hive:messages', (_evt, opts: unknown) =>
  hive.voiceMessages(opts && typeof opts === 'object' ? (opts as Parameters<typeof hive.voiceMessages>[0]) : {})
);
/** The last time the app cleared an agent's conversation (safeClearer.ts). */
ipcMain.handle('hive:clearedState', (_evt, id: unknown) => (typeof id === 'string' ? hive.clearedState(id) : null));
/** Undo a clear: point the agent back at its earlier conversation and restart
 *  it into it, through the same respawn-with-resume path the app uses after
 *  sleep (the renderer's power:resume handler). */
ipcMain.handle('agent:restoreConversation', (_evt, id: unknown) => {
  if (typeof id !== 'string') return { ok: false };
  const state = hive.clearedState(id);
  const ptyId = ptyForAgent(id);
  if (!state || !ptyId) return { ok: false };
  hive.restoreSession(id, state.oldSession);
  hive.recordClear(id, null);
  try { liveWebContents()?.send('power:resume', { reason: 'restore-conversation', awayMs: 0, dead: [ptyId], total: 1 }); } catch { /* window gone */ }
  return { ok: true };
});
/** The owner's Ask me answer, added to the raising agent's memory notes. */
ipcMain.handle('hive:rememberOwnerAnswer', (_evt, p: unknown) => {
  const o = (p ?? {}) as { agentId?: unknown; task?: unknown; q?: unknown; a?: unknown };
  if (typeof o.agentId !== 'string' || typeof o.q !== 'string' || typeof o.a !== 'string') return { ok: false };
  return { ok: hive.rememberOwnerAnswer(o.agentId, typeof o.task === 'string' ? o.task : '', o.q, o.a) };
});
ipcMain.handle('hive:send', (_evt, partial: Partial<HiveMessage>, from: unknown) => {
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  const sender = typeof from === 'string' ? from : 'system';
  const msg = hive.send(partial ?? {}, sender);
  // Count only what a PERSON sent. Every renderer surface that dispatches on a
  // human's behalf passes 'human' (Command Center dispatch, thread replies, ASK
  // ME answers); agent-to-agent traffic passes the agent id and would swamp the
  // number. Counted AFTER the send so a rejected message is never counted.
  if (sender === 'human') analytics.trackMessageSent('hive');
  return { ok: true, message: msg };
});
// Michael's open requests from the owner, by card (card-lifecycle.md): the
// Tasks view shows these cards as with Michael.
ipcMain.handle('hive:ownerRequests', () => (hive.enabled() ? hive.ownerRequests() : []));
/** A hire's first task (docs/designs/first-task-card.md): the card, and an
 *  owner request to Michael about it, once per hire. The card id comes from
 *  the agent id, so a second call finds the card and sends nothing. */
ipcMain.handle('hive:firstTask', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { sourceCard?: unknown; agentId?: unknown; name?: unknown; ask?: unknown; role?: unknown; existing?: unknown };
  if (typeof p.agentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.agentId)) return { ok: false, error: 'invalid first task' };
  // An owner's edited First task (from a hire's old Work style) comes with its
  // words; a new hire's comes from its pack card.
  const rawAsk = typeof p.ask === 'string' ? p.ask.trim() : '';
  if (rawAsk.length > FIRST_TASK_EDITED_MAX) return { ok: false, error: 'first task too long' };
  if (typeof p.sourceCard !== 'string' && !rawAsk) return { ok: false, error: 'invalid first task' };
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  const [type, defId] = typeof p.sourceCard === 'string' ? p.sourceCard.split('/') : [];
  const loaded = loadBundledPacks({ packsDir });
  const def = type ? [...loaded.packs.map((x) => x.pack), loaded.core].find((x) => x?.businessType === type)?.agents.find((a) => a.id === defId) : undefined;
  const cfg = readConfig();
  const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
  const name = oneLine(p.name, 60) || undefined;
  const now = new Date();
  const packed = def ? firstTaskCard(def, { agentId: p.agentId, name }, { name: cfg.businessName, city: cfg.businessCity }, now) : null;
  const who = name ?? p.agentId;
  const first = rawAsk
    ? firstTaskCardFromText({ agentId: p.agentId, name: who, role: def?.role ?? oneLine(p.role, 80) }, packed?.card.title ?? `First task for ${who}`, rawAsk, now, { existing: p.existing !== false })
    : packed;
  if (!first) return { ok: true, sent: false };
  // A First task the owner typed is new work even when the hire's first card
  // exists already (their pack one, long done): it gets its own card id.
  if (!hive.addTask(first.card)) {
    if (!rawAsk) return { ok: true, sent: false };
    first.card.id = `${first.card.id}-${now.getTime().toString(36)}`;
    if (!hive.addTask(first.card)) return { ok: true, sent: false };
  }
  hive.send({ to: MICHAEL_ID, act: 'request', subject: first.card.title, body: first.body, conversation: cardConversation(first.card.id), requires_reply: true }, 'human');
  return { ok: true, sent: true };
});
ipcMain.handle('hive:addTask', (_evt, task: unknown) => {
  if (!task || typeof task !== 'object' || Array.isArray(task)
    || typeof (task as { id?: unknown }).id !== 'string') {
    return { ok: false, error: 'invalid task' };
  }
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  return { ok: hive.addTask(task as HiveTask) };
});
/** The digest an answer is recorded by: its question and answer, word for word. */
function answerDigest(q: string, a: string): string {
  return createHash('sha256').update(`${q}\u0000${a}`).digest('hex').slice(0, 32);
}

/** The ledger's keys for these Ask me entries: answered ones only. */
function answerKeysOf(taskId: string, qa: unknown[]): string[] {
  return qa
    .filter((e): e is { q: string; a: string; answeredAt: string } => !!e && typeof e === 'object'
      && typeof (e as { q?: unknown }).q === 'string' && typeof (e as { a?: unknown }).a === 'string'
      && typeof (e as { answeredAt?: unknown }).answeredAt === 'string')
    .map((e) => answerKey(taskId, e.answeredAt, answerDigest(e.q, e.a)));
}

function recordOwnerAnswerKeys(keys: string[]): void {
  const prior = readConfig().ownerAnswerKeys ?? [];
  writeConfig({ ownerAnswerKeys: [...new Set([...prior, ...keys])].slice(-OWNER_ANSWER_KEYS_MAX) });
}

ipcMain.handle('hive:patchTask', (_evt, id: unknown, patch: unknown) => {
  if (typeof id !== 'string' || !id || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'invalid task patch' };
  }
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  // The renderer patches a card only to record Ask me answers. A move goes
  // through hive:moveTask, which keeps Blocked and Waiting Michael's (Codex
  // adversarial review, 2026-10-04), so any other field is refused here.
  if (Object.keys(patch).some((k) => k !== 'humanQA')) return { ok: false, error: 'only Ask me answers can be patched' };
  // The owner's Ask me answers arrive here; recording them is what lets the
  // launch catch-up tell an owner's answer from text an agent wrote into the
  // card (security review, 2026-10-03).
  // Only answers this patch adds count: the renderer sends the card's whole
  // list, and an entry already on disk may be one an agent wrote.
  const qa = (patch as { humanQA?: unknown }).humanQA;
  if (!Array.isArray(qa)) return { ok: false, landed: false, error: 'no Ask me answers in the patch' };
  const ledger = hive.tasks() as { tasks?: HiveTask[] };
  const onDisk = (Array.isArray(ledger?.tasks) ? ledger.tasks : []).find((t) => t?.id === id)?.humanQA ?? [];
  // The renderer's list is a few seconds old, so it only adds answers to
  // questions still open on disk: a newer ask, a changed question or a
  // withdrawal written since all stand (askMeRouting.ts mergeHumanQA).
  const { humanQA, added } = mergeHumanQA(onDisk, qa);
  if (!added.length) return { ok: true, landed: false };
  const ok = hive.patchTask(id, { humanQA: humanQA as HiveTask['humanQA'] });
  const keys = answerKeysOf(id, added.map((i) => humanQA[i]));
  if (ok && keys.length) recordOwnerAnswerKeys(keys);
  return { ok, landed: ok };
});
/** The most recorded owner answers kept: far more than any office has open. */
const OWNER_ANSWER_KEYS_MAX = 2000;

// ─── The owner's conversation with Michael (docs/designs/michael-replies.md) ───

/** Dock keys kept: years of questions at any realistic pace (R4). */
const OWNER_DOCK_KEYS_MAX = 50_000;
const dockKey = (m: { id: string; created_at: string; body?: string }): string => answerKey(`owner:${m.id}`, m.created_at, answerDigest('', m.body ?? ''));

/**
 * The keys of messages the owner really sent from the dock (R4), in their own
 * app-private file, read once and cached: config.json is re-read many times a
 * minute, so a list that grows with every question doesn't belong in it
 * (ship D5). The first build kept them in config.json; they are carried over once.
 */
const ownerDockKeysPath = (): string => join(app.getPath('userData'), 'owner-dock-keys.json');
let ownerDockKeysCache: Set<string> | null = null;
function saveOwnerDockKeys(list: string[]): boolean {
  const path = ownerDockKeysPath();
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify(list), 'utf8');
    renameSync(`${path}.tmp`, path);
    return true;
  } catch (e) { console.error('[owner] dock keys not saved:', e); return false; }
}
function ownerDockKeys(): Set<string> {
  if (ownerDockKeysCache) return ownerDockKeysCache;
  let list: string[] = [];
  try {
    const v: unknown = JSON.parse(readFileSync(ownerDockKeysPath(), 'utf8'));
    if (Array.isArray(v)) list = v.filter((k): k is string => typeof k === 'string');
  } catch { /* none yet */ }
  const legacy = readConfig().ownerDockKeys;
  if (Array.isArray(legacy) && legacy.length) {
    list = [...new Set([...list, ...legacy])].slice(-OWNER_DOCK_KEYS_MAX);
    // Settings keep their copy until the new file is safely written.
    if (saveOwnerDockKeys(list)) writeConfig({ ownerDockKeys: undefined });
  }
  ownerDockKeysCache = new Set(list);
  return ownerDockKeysCache;
}
function addOwnerDockKey(key: string): boolean {
  const list = [...ownerDockKeys(), key].slice(-OWNER_DOCK_KEYS_MAX);
  if (!saveOwnerDockKeys(list)) return false;
  ownerDockKeysCache = new Set(list);
  return true;
}
/** Whether an owner message is one the owner really sent from the dock. */
const isOwnerDockMessage = (m: { id: string; created_at: string; body?: string }): boolean =>
  ownerDockKeys().has(dockKey({ id: m.id, created_at: m.created_at, body: m.body }));
// Michael's every-turn list of owner questions uses the same check (ship D4).
hive.setOwnerMessageCheck(isOwnerDockMessage);

/** Whether the dock is on screen and the app in front: then a reply needs no
 *  notification (12A). */
let ownerDockVisible = false;

/** One desktop notification titled with Michael's name, opening the dock at
 *  this question when clicked. */
function ownerToastOpening(body: string, questionId: string): void {
  if (!readConfig().notifications) return;
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: michaelName(), body });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
      try { liveWebContents()?.send('owner:openDock', questionId); } catch { /* window gone */ }
    });
    n.show();
  } catch { /* unsupported platform */ }
}

hive.onOwnerReply((msg) => {
  try { liveWebContents()?.send('owner:changed'); } catch { /* window gone */ }
  if (msg.from_notes || !msg.in_reply_to || !['done', 'refuse', 'query'].includes(msg.act)) return;
  const inFront = ownerDockVisible && !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
  if (inFront || !hive.ownerNotify(msg.in_reply_to, msg.id)) return;
  const first = (msg.body || msg.subject || '').replace(/\s+/g, ' ').trim();
  const text = msg.act === 'query' ? `Has a question about: ${first}` : first;
  ownerToastOpening(text.length > 120 ? `${text.slice(0, 119)}…` : text, msg.in_reply_to);
});

ipcMain.handle('owner:ask', (_evt, p: unknown) => {
  const o = (p ?? {}) as { text?: unknown; inReplyTo?: unknown; conversation?: unknown };
  if (!hive.enabled() || typeof o.text !== 'string' || !o.text.trim()) return { ok: false };
  const msg = hive.ownerAsk({
    text: o.text.slice(0, 20_000),
    ...(typeof o.inReplyTo === 'string' ? { inReplyTo: o.inReplyTo } : {}),
    ...(typeof o.conversation === 'string' ? { conversation: o.conversation } : {})
  });
  if (!msg) return { ok: false };
  // A question whose genuine mark can't be saved would vanish after a restart:
  // it is withdrawn and the owner told it didn't send.
  if (!addOwnerDockKey(dockKey(msg))) { hive.ownerWithdraw(msg.id); return { ok: false }; }
  return { ok: true, id: msg.id, workOrder: ownerWorkOrder(msg.id, msg.body) };
});
ipcMain.handle('owner:conversation', () => hive.ownerConversationView(Date.now(), isOwnerDockMessage));
ipcMain.handle('owner:delivered', (_evt, id: unknown) => ({ ok: typeof id === 'string' && hive.ownerDelivered(id) }));
ipcMain.handle('owner:withdraw', (_evt, id: unknown) => ({ ok: typeof id === 'string' && hive.ownerWithdraw(id) }));
ipcMain.handle('owner:notSent', (_evt, id: unknown) => { if (typeof id === 'string') hive.ownerNotSent(id); return { ok: true }; });
ipcMain.handle('owner:retry', (_evt, id: unknown) => ({ ok: typeof id === 'string' && hive.ownerRetry(id) }));
ipcMain.handle('owner:read', (_evt, ids: unknown) => {
  if (Array.isArray(ids)) hive.ownerRead(ids.filter((x): x is string => typeof x === 'string').slice(0, 500));
  return { ok: true };
});
ipcMain.handle('owner:nudge', (_evt, id: unknown) => ({ ok: typeof id === 'string' && hive.ownerRemind(id, 'nudge') }));
ipcMain.handle('owner:dockVisible', (_evt, on: unknown) => { ownerDockVisible = on === true; return { ok: true }; });
ipcMain.handle('hive:ackReport', (_evt, taskId: unknown, index: unknown) => ({
  ok: typeof taskId === 'string' && Number.isInteger(index) && hive.ackReport(taskId, index as number)
}));

/** Late owner questions: Michael is reminded once (6A). */
function sweepLateOwnerQuestions(now = Date.now()): void {
  if (!hive.enabled()) return;
  for (const it of hive.ownerConversationView(now).items) {
    if (it.kind === 'owner' && it.status === 'late') hive.ownerRemind(it.id, 'late', now);
  }
}
setInterval(() => {
  try { sweepLateOwnerQuestions(); } catch (e) { console.error('[owner] late sweep failed', e); }
  // Paused Send only grants reach Michael once (shared-mailboxes.md, EV1).
  try { noticePausedGrants(); } catch (e) { console.error('[mail] paused grant sweep failed', e); }
}, 5 * 60_000);
// The owner's own card changes (card-lifecycle.md section 4): a move, or a
// close that ends the card as Done by their decision. Cards are never deleted
// from the UI; Michael is told of each change.
ipcMain.handle('hive:moveTask', (_evt, id: unknown, status: unknown) => {
  // Not Blocked: that is Michael's, for a question waiting on Ask me.
  if (typeof id !== 'string' || !id || !['todo', 'doing', 'done'].includes(status as string)) {
    return { ok: false, error: 'invalid task move' };
  }
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  return { ok: hive.ownerMoveTask(id, status as HiveTask['status']) };
});
ipcMain.handle('hive:closeTask', (_evt, id: unknown, reason: unknown) => {
  if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid task id' };
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  return { ok: hive.ownerCloseTask(id, typeof reason === 'string' ? reason : undefined) };
});
ipcMain.handle('hive:setArchived', (_evt, id: unknown, archived: unknown) => {
  if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  hive.setArchived(id, archived === true);
  return { ok: true };
});
ipcMain.handle('hive:patchAgentRole', (_evt, id: unknown, role: unknown) => {
  if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
  if (typeof role !== 'string') return { ok: false, error: 'invalid role' };
  if (!hive.enabled()) return { ok: false, error: 'hive disabled (no harnessHome)' };
  return hive.patchAgentRole(id, role);
});

// ─── IPC: Settings hero payload (remote data, cached) ───────────────────────
/** Plan copy and sponsor, fetched from the repo so they can change without a
 *  release. Validated in shared/heroPayload before it reaches the renderer. */
ipcMain.handle('hero:payload', async (_evt, force: unknown) =>
  loadHero(join(app.getPath('userData'), 'hero.json'), { force: force === true }));

// ─── IPC: model catalog (remote data, cached) ───────────────────────────────
/** The agent model presets, fetched from docs/model-catalog.json on main so a
 *  new model reaches installed copies without a release. Validated in
 *  shared/modelCatalogPayload; a null catalog means "keep the baked one". */
const MODEL_CATALOG_CACHE = () => join(app.getPath('userData'), 'model-catalog.json');
ipcMain.handle('models:catalog', async (_evt, force: unknown) =>
  loadModelCatalog(MODEL_CATALOG_CACHE(), { force: force === true }));

// ─── IPC: skills (installed locally, and the browsable catalog) ─────────────
/** Skills the CLIs on this machine can already use. Scans the registered repos
 *  plus the agent's own cwd, so a project-scoped skill shows up where it applies. */
ipcMain.handle('skills:local', (_evt, cwd: unknown): LocalSkill[] => {
  const cfg = readConfig();
  const cwds = [
    ...(typeof cwd === 'string' && cwd ? [cwd] : []),
    ...(cfg.registeredRepos ?? [])
  ];
  try {
    return listLocalSkills({ cwds, bundledDir: skillsResourceDir() });
  } catch (e) {
    console.error('[skills] local scan failed:', e);
    return [];
  }
});
/** The business types onboarding offers, each with its core agents merged in.
 *  A pack that fails to load is reported rather than thrown: onboarding's first
 *  screen is this list, and one bad file must not leave an owner with an empty
 *  grid and nothing to click. */
ipcMain.handle('packs:list', () => {
  try {
    return loadBundledPacks({ packsDir });
  } catch (e) {
    console.error('[packs] load failed:', e);
    return { packs: [], problems: [{ file: packsDir(), reason: String(e) }] };
  }
});

/** Default folders for the onboarding team screen (Decisions 44, 45):
 *  `~/Documents/<Business>/<Folder>` for each folder name. The business folder
 *  is Michael's, and holds the team's folders. When the owner picks another one (`root`), every default follows
 *  it; a folder that can't hold an office (the home folder, a system folder)
 *  is refused and the default kept. Nothing is created here. */
ipcMain.handle('folders:suggest', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { businessName?: unknown; folders?: unknown; root?: unknown };
  const businessName = typeof p.businessName === 'string' ? p.businessName : '';
  const names = Array.isArray(p.folders)
    ? p.folders.filter((x): x is string => typeof x === 'string').slice(0, 50)
    : [];
  const docs = app.getPath('documents');
  const picked = typeof p.root === 'string' && p.root.trim() ? resolve(expandTilde(p.root.trim())) : undefined;
  const rootRefused = !!picked && (!isAbsolute(picked) || !isUsableTeamFolder(picked));
  const root = picked && !rootRefused ? picked : businessFolderRoot(docs, businessName);
  const byFolder: Record<string, string> = {};
  for (const n of names) byFolder[n] = join(root, safeFolderName(n));
  return {
    // For display only: the screen shows ~/Documents/… rather than /Users/<name>/…
    home: app.getPath('home'),
    root,
    byFolder,
    ...(rootRefused ? { rootRefused: true } : {})
  };
});

/** Which folder names already exist under `root` (Michael's folder), so the
 *  hire wizard can give a new hire its own folder (hire redesign, point 2).
 *  Reads only; creates nothing. */
ipcMain.handle('folders:exists', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { root?: unknown; names?: unknown };
  if (typeof p.root !== 'string' || !p.root.trim()) return {};
  const root = resolve(expandTilde(p.root.trim()));
  const names = Array.isArray(p.names) ? p.names.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
  const out: Record<string, boolean> = {};
  for (const n of names) {
    try { out[n] = existsSync(join(root, safeFolderName(n))); } catch { out[n] = false; }
  }
  return out;
});

/** Overlap checks still running, by request id: one the owner moved past is
 *  stopped, so clicking through jobs never leaves hidden sessions behind. */
const checkRuns = new Map<string, AbortController>();
/** The hire wizard's distinct job check (design D6): a hidden Haiku call that
 *  compares the new job with every teammate's, the instant rules when it can't. */
ipcMain.handle('hire:checkDistinct', async (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { job?: unknown; team?: unknown; requestId?: unknown };
  const job = readJobProfile(p.job);
  if (!job) return { distinct: false, overlapsWith: [], why: '', source: 'rules' };
  const team = Array.isArray(p.team) ? p.team.map(readJobProfile).filter((m): m is NonNullable<typeof m> => !!m) : [];
  const cfg = readConfig();
  const requestId = typeof p.requestId === 'string' ? p.requestId.slice(0, 80) : '';
  const stop = new AbortController();
  if (requestId) checkRuns.set(requestId, stop);
  try {
    return await checkDistinct(job, team, {
      cwd: cfg.harnessHome ?? app.getPath('home'),
      command: cfg.defaultCommand ?? 'claude',
      env: memory.env(),
      log: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } },
      signal: stop.signal
    });
  } finally {
    if (requestId) checkRuns.delete(requestId);
  }
});
ipcMain.handle('hire:checkStop', (_evt, requestId: unknown) => {
  if (typeof requestId === 'string') checkRuns.get(requestId)?.abort();
  return { ok: true };
});

/** "Suggest me" on the hire wizard: a first work style for the owner to edit.
 *  The draft streams to the window as `workStyle:suggestText` while it is
 *  written, and `workStyle:suggestStop` ends it (owner, 2026-10-03). */
const suggestRuns = new Map<string, AbortController>();
ipcMain.handle('workStyle:suggest', async (evt, payload: unknown) => {
  const req = readSuggestRequest(payload);
  if (!req) return { text: '' };
  const raw = (payload ?? {}) as { requestId?: unknown };
  const requestId = typeof raw.requestId === 'string' ? raw.requestId.slice(0, 80) : '';
  const stop = new AbortController();
  if (requestId) suggestRuns.set(requestId, stop);
  const cfg = readConfig();
  try {
    return await suggestWorkStyle(req, {
      cwd: cfg.harnessHome ?? app.getPath('home'),
      command: cfg.defaultCommand ?? 'claude',
      env: memory.env(),
      log: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }
    }, {
      signal: stop.signal,
      onText: requestId ? (text) => { if (!evt.sender.isDestroyed()) evt.sender.send('workStyle:suggestText', { requestId, text }); } : undefined
    });
  } finally {
    if (requestId) suggestRuns.delete(requestId);
  }
});
ipcMain.handle('workStyle:suggestStop', (_evt, requestId: unknown) => {
  if (typeof requestId === 'string') suggestRuns.get(requestId)?.abort();
  return { ok: true };
});
/** A work style between the owner's plain description and the agent's
 *  instructions (owner, 2026-09-27). Falls back to a plain-text rewrite. */
ipcMain.handle('workStyle:convert', async (_evt, payload: unknown) => {
  const req = readConvertRequest(payload);
  if (!req) return { text: '', source: 'rules' };
  const cfg = readConfig();
  return convertWorkStyle(req, {
    cwd: cfg.harnessHome ?? app.getPath('home'),
    command: cfg.defaultCommand ?? 'claude',
    env: memory.env(),
    log: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }
  });
});

/** A job's focus area checked against the agent's Work style and its other
 *  jobs (schedule-focus-areas.md, FA3). Unchecked when the call can't run. */
ipcMain.handle('workStyle:checkFocus', async (_evt, payload: unknown) => {
  const req = readFocusCheckRequest(payload);
  if (!req) return { checked: false };
  const cfg = readConfig();
  // The agent's real Sending setting, read here rather than trusted from the renderer.
  const agentId = payload && typeof (payload as { agentId?: unknown }).agentId === 'string' ? (payload as { agentId: string }).agentId : '';
  const email = agentId ? cfg.agentCapabilities?.[agentId]?.email : undefined;
  if (email?.enabled) req.sending = sendingWords(sendingMode(email));
  // A Send only grant's Sending, so an outreach job is checked against it (ER7).
  const grant = agentId ? sendOnlyGrant(cfg, agentId) : undefined;
  if (grant) {
    const address = mailboxAddress(cfg, grant.mailbox);
    const line = `sends only from ${address}: ${sendingWords(grant.sending)}`;
    req.sending = req.sending ? `${req.sending}; ${line}` : line;
  }
  return checkFocusArea(req, {
    cwd: cfg.harnessHome ?? app.getPath('home'),
    command: cfg.defaultCommand ?? 'claude',
    env: memory.env(),
    log: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }
  });
});

/** Create the team's folders when onboarding finishes. Only ever ADDS a missing
 *  folder: an existing one, and everything in it, is left exactly as it is. */
ipcMain.handle('folders:ensure', (_evt, paths: unknown) => {
  const list = Array.isArray(paths)
    ? paths.filter((x): x is string => typeof x === 'string').slice(0, 50)
    : [];
  return list.map((p) => ensureFolder(expandTilde(p)));
});

/** The skills catalog, parsed from its README and cached in userData.
 *  `force` is the explicit refresh button; everything else is served from a
 *  day-old cache so opening the tab never waits on the network. */
ipcMain.handle('skills:catalog', async (_evt, force: unknown) => {
  const cachePath = join(app.getPath('userData'), 'skill-catalog.json');
  return loadCatalog(cachePath, { force: force === true });
});

/** Install one catalog skill into ~/.claude/skills. Structured refusals, never a
 *  throw: the UI distinguishes "not installable" from "install failed". */
ipcMain.handle('skills:install', async (_evt, url: unknown, name: unknown) => {
  if (typeof url !== 'string' || typeof name !== 'string') {
    return { ok: false as const, error: 'bad request' };
  }
  return installSkill(url, name);
});
/** Delete an installed skill. The guard rails live in uninstallSkill — it refuses
 *  any path it cannot prove is a skill folder inside a skills root. */
ipcMain.handle('skills:uninstall', (_evt, path: unknown) => {
  if (typeof path !== 'string') return { ok: false as const, error: 'bad request' };
  const cfg = readConfig();
  return uninstallSkill(path, { cwds: cfg.registeredRepos ?? [] });
});
/** Reveal a skill on disk. `openExternal` is deliberately https-only, so a
 *  file:// URL cannot (and should not) be smuggled through it. */
ipcMain.handle('skills:reveal', (_evt, path: unknown) => {
  if (typeof path !== 'string' || !path.trim()) return { ok: false, error: 'bad request' };
  const skillRoots = [join(homedir(), '.claude', 'skills'), join(homedir(), '.config', 'opencode')];
  const target = resolve(path);
  const inRoot = skillRoots.some((r) => target.startsWith(resolve(r) + sep))
    || (readConfig().registeredRepos ?? []).some((c) => target.startsWith(resolve(c) + sep));
  if (!inRoot) return { ok: false, error: 'outside a managed skills directory' };
  shell.showItemInFolder(target);
  return { ok: true };
});

// ─── IPC: Get Michael ready (engineSetup.ts) ────────────────────────────────
// Where Claude stands on this computer, its install and its sign in, each run in
// a terminal the step can show (Show details). Only Claude is set up here; any
// other engine keeps its own path.

/** `claude` without a login shell: the user's captured PATH plus the places
 *  Claude's installers use (engineSetup.findClaudeFast). */
function claudePathFast(): string | null {
  return findClaudeFast({
    platform: process.platform,
    pathEnv: process.platform === 'win32' ? (process.env.PATH || '') : userShellPath(),
    home: homedir(),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA
  });
}
/** Terminals that could not start for want of Claude, or started signed out
 *  (pty id → was it Michael). Each stays until that terminal starts ready on
 *  Claude or on another engine. Once ready, exactly these restart; a member in
 *  it makes the step and the card apply even when Michael runs on another engine. */
const claudeBlocked = new Map<string, { god: boolean }>();
/** Tell the step and Ask me to look again: the first notice at once, any more
 *  inside 2 s once at its end (a team restore sends one per member). */
const noticeEngineSetup = makeNoticeCoalescer((id) => {
  try { liveWebContents()?.send('engineSetup:changed', { id, exitCode: null }); } catch { /* window gone */ }
});

// Hidden checks (hire, focus, standing fit) sign in the same way as the team,
// with the key approved first so Claude never stops on its question; once per
// key, not on every check (~/.claude.json can run to megabytes).
let hiddenApprovedKey = '';
setHiddenClaudeAuthEnv(() => {
  const env = claudeAuthEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (key && key !== hiddenApprovedKey) {
    try { if (approveClaudeApiKey(key)) hiddenApprovedKey = key; } catch { /* best effort */ }
  }
  return env;
});

/** `claude auth status`, one at a time, never joining a read that started
 *  before a sign in ended, keeping the last known state on a failed read
 *  (engineSetup.makeClaudeAuthReader). */
const claudeAuth = makeClaudeAuthReader((path, done) => {
  const env = buildPtyEnv(process.env, process.platform === 'win32' ? (process.env.PATH || '') : userShellPath());
  const cmd = claudeAuthStatusCommand(process.platform, path, process.env.ComSpec);
  execFile(cmd.file, cmd.args, { timeout: 15_000, env, windowsVerbatimArguments: cmd.verbatim }, (err, stdout) => done(err, String(stdout ?? '')));
});
ipcMain.handle('engineSetup:status', async (_e, provider?: unknown): Promise<EngineSetupStatus> => {
  const cfg = readConfig();
  const p = typeof provider === 'string' && provider ? provider : (cfg.godProvider ?? 'claude');
  const isClaude = isClaudeProvider(inferAgentProvider('claude', p));
  const teamNeedsClaude = [...claudeBlocked.values()].some((b) => !b.god);
  const status = await readEngineSetupStatus({
    isClaude,
    teamNeedsClaude,
    claudePath: isClaude || teamNeedsClaude ? claudePathFast() : null,
    claudeAuth: cfg.claudeAuth,
    hasKey: () => integrations.hasSecret(providerKeyRef('anthropic')),
    authStatus: (path) => claudeAuth.read(path)
  });
  // Ready now: the terminals that could not start. Each leaves the list when it
  // actually starts on Claude (spawnAgentCore), so every reader sees the same.
  if (status.applies && !status.needed && claudeBlocked.size) return { ...status, restart: [...claudeBlocked.keys()] };
  return status;
});
// Start the install (or keep the one already running). The step watches the
// terminal's exit and then reads the status again. On macOS and Linux it runs
// under /bin/sh, not the owner's shell: the script is POSIX, and fish is not.
ipcMain.handle('engineSetup:install', (e): { ok: boolean; error?: string } => {
  if (!shouldStartInstall({ installRunning: ptyManager.list().some((x) => x.id === ENGINE_INSTALL_PTY), installed: !!claudePathFast() })) return { ok: true };
  const script = claudeInstallScript(process.platform);
  const res = process.platform === 'win32'
    ? ptyManager.spawn({ id: ENGINE_INSTALL_PTY, cwd: homedir(), command: 'claude', cols: 100, rows: 12, shellScript: script }, e.sender)
    : ptyManager.spawn({ id: ENGINE_INSTALL_PTY, cwd: homedir(), command: '/bin/sh', args: ['-c', script], cols: 100, rows: 12 }, e.sender);
  if (res.ok) analytics.track('agent_install_started', { provider: 'claude', rung: 'native' });
  else analytics.track('agent_spawn_failed', { provider: 'claude', reason: spawnFailReason(res.error) });
  return res;
});
// Sign in: `claude auth login` opens the browser. A fresh run each time, so
// "Open the browser again" works after a closed tab.
ipcMain.handle('engineSetup:signIn', (e): { ok: boolean; error?: string } => {
  const claude = claudePathFast();
  if (!claude) return { ok: false, error: 'not installed' };
  // Signing in with an account means the team uses it, not a key.
  if (readConfig().claudeAuth === 'apiKey') writeConfig({ claudeAuth: 'account' });
  if (ptyManager.list().some((x) => x.id === ENGINE_SIGNIN_PTY)) ptyManager.kill(ENGINE_SIGNIN_PTY);
  return ptyManager.spawn({ id: ENGINE_SIGNIN_PTY, cwd: homedir(), command: claude, args: ['auth', 'login'], cols: 100, rows: 12 }, e.sender);
});
// Use an Anthropic API key instead of a Claude account. The key is checked with
// Anthropic first, so a typo never becomes a team that cannot start; then kept
// write only in the secret store (the same Anthropic key as Settings, AI
// engines) and approved for Claude Code. It never comes back over IPC.
ipcMain.handle('engineSetup:useApiKey', async (_e, raw: unknown): Promise<{ ok: boolean; error?: 'invalid' | 'rejected' | 'refused' | 'workspace' | 'busy' | 'unreachable' | 'store'; reason?: string }> => {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!apiKeyShapeOk(key)) return { ok: false, error: 'invalid' };
  // Electron's fetch follows the system proxy, so the check works wherever Claude does.
  const { verdict, reason } = await checkAnthropicKey(key, net.fetch as unknown as KeyCheckFetch);
  if (verdict !== 'ok') return { ok: false, error: verdict, ...(reason ? { reason } : {}) };
  // Approved in ~/.claude.json first: a key Claude would stop to ask about is
  // never saved as ready (fail closed; the owner can try again).
  let approved = false;
  try { approved = approveClaudeApiKey(key); } catch { approved = false; }
  if (!approved) return { ok: false, error: 'store' };
  const saved = integrations.setSecret(providerKeyRef('anthropic'), key);
  if (!saved.ok) return { ok: false, error: 'store' };
  writeConfig({ claudeAuth: 'apiKey' });
  try { liveWebContents()?.send('engineSetup:changed', { id: 'api-key', exitCode: null }); } catch { /* window gone */ }
  return { ok: true };
});

// ─── IPC: setup catalog (which external tools are actually here) ────────────
/**
 * Probe every catalog row against THIS machine.
 *
 * Presence is a PATH resolution, not a spawn: running each candidate to read a
 * --version would be a dozen process launches on every panel open, and several of
 * these CLIs boot a TUI when invoked bare. `resolveCommand` returns its input
 * unchanged when it finds nothing, so "resolved to a real, existing path that is
 * not just the bare name" is the found test.
 *
 * mempalace is the one row that does NOT come from PATH: the memory subsystem
 * already resolves it (including uv/pip locations PATH may not carry for a
 * Finder-launched app) and knows whether the palace is initialised, so it is
 * authoritative and reused rather than re-probed differently here.
 */
ipcMain.handle('tools:status', (): ToolStatus[] => {
  const win = process.platform === 'win32';
  const mem = (() => { try { memory.resetBinCache(); return memory.status(); } catch { return null; } })();
  return toolCatalog().map((spec): ToolStatus => {
    const installCommand = win ? spec.install.win32 : spec.install.posix;
    if (spec.id === 'mempalace') {
      return {
        ...spec,
        installCommand,
        found: !!mem?.available,
        path: mem?.bin ?? null,
        detail: mem?.available
          ? (mem.initialized ? 'palace initialised' : 'installed; palace not built yet')
          : undefined
      };
    }
    if (!spec.bin) return { ...spec, installCommand, found: false, path: null };
    let path: string | null = null;
    try {
      const resolved = resolveCliCommand(spec.bin);
      if (resolved !== spec.bin && existsSync(resolved)) path = resolved;
    } catch { /* a probe must never take the panel down */ }
    return { ...spec, installCommand, found: !!path, path };
  });
});

// ─── IPC: semantic memory (MemPalace CLI) ───────────────────────────────────
// refresh() = resetBinCache + an idempotent start(). The poll is the one thing
// that reliably notices mempalace being installed after boot, so it is what arms
// the mine loop that boot's start() had to skip — otherwise the pill reads
// "getting ready" until the app is restarted.
ipcMain.handle('hive:memoryStatus', () => memory.refresh());
ipcMain.handle('hive:searchMemory', (_evt, query: unknown, wing: unknown) => {
  if (typeof query !== 'string' || !query.trim()) return { ok: false, output: '', error: 'empty query' };
  return memory.search(query, { wing: typeof wing === 'string' ? wing : undefined });
});
ipcMain.handle('hive:memoryWakeUp', (_evt, wing: unknown) =>
  memory.wakeUp(typeof wing === 'string' ? wing : undefined));
ipcMain.handle('hive:mineNow', () => { memory.mineNow(); return { ok: true }; });
// Condense memory.md on demand: an explicit id condenses that one agent (skips
// the size trigger — a "condense now" button); no id runs a full threshold scan.
ipcMain.handle('memory:reflectNow', (_evt, id: unknown) =>
  memoryTidy.tidyNow(typeof id === 'string' && id ? id : undefined));

// ─── IPC: enterprise Knowledge Graph (multimodal context for agents) ─────────
ipcMain.handle('kg:status', () => knowledge.status());
ipcMain.handle('kg:list', () => knowledge.list());
ipcMain.handle('kg:search', (_evt, query: unknown, limit: unknown) => {
  if (typeof query !== 'string' || !query.trim()) return [];
  return knowledge.search(query, typeof limit === 'number' ? limit : undefined);
});
ipcMain.handle('kg:get', (_evt, id: unknown) =>
  (typeof id === 'string' && id ? knowledge.get(id) : null));
ipcMain.handle('kg:remove', (_evt, id: unknown) => {
  const ok = typeof id === 'string' && id ? knowledge.remove(id) : false;
  if (ok) memory.companyKnowledgeChanged(); // drop it from search by meaning too
  return { ok };
});
// Ingest one or more files from disk. Best-effort per file; returns per-file
// results so the UI can report partial success.
ipcMain.handle('kg:ingestFiles', async (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { paths?: unknown; tags?: unknown };
  const paths = Array.isArray(p.paths) ? p.paths.filter((x): x is string => typeof x === 'string') : [];
  const tags = Array.isArray(p.tags) ? p.tags.filter((x): x is string => typeof x === 'string') : undefined;
  const results = await ingestSequentially(paths, tags);
  if (results.some((r) => r.ok)) memory.companyKnowledgeChanged(); // index it for search by meaning
  return { results };
});
// Open a multi-file picker and ingest the chosen artifacts in one round-trip.
ipcMain.handle('kg:addFiles', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return { ok: false as const, error: 'no window' };
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    title: 'Add documents to the Knowledge Graph'
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false as const, error: 'cancelled' };
  const results = await ingestSequentially(res.filePaths);
  if (results.some((r) => r.ok)) memory.companyKnowledgeChanged(); // index it for search by meaning
  return { ok: true as const, results };
});

/** Ingest files one at a time. Sequential on purpose: kg-core appends every
 *  document to a single index.jsonl, and parallel ingests would interleave
 *  those appends. A file that can't be read comes back as ok:false with the
 *  reason, which the UI shows the owner by name. */
async function ingestSequentially(paths: string[], tags?: string[]) {
  const results: Array<
    | { ok: true; srcPath: string; docId: string; chunkCount: number }
    | { ok: false; srcPath: string; error: string }
  > = [];
  for (const srcPath of paths) {
    try {
      const r = await knowledge.ingestFile(srcPath, tags ? { tags } : {});
      results.push({ ok: true, srcPath, docId: r.docId, chunkCount: r.chunkCount });
    } catch (e) {
      results.push({ ok: false, srcPath, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// ─── IPC: composer attachments (images + arbitrary files, attached by PATH) ──
// The message queue pipes raw text into a Claude CLI PTY, so attachments travel
// as a file PATH the agent reads with its Read tool (same convention as Slack).
// Picker offers an Images group + All Files.
ipcMain.handle('dialog:attachFiles', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return { ok: false as const, error: 'no window' };
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    title: 'Attach images or files',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tiff', 'avif'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false as const, error: 'cancelled' };
  return { ok: true as const, files: res.filePaths.map((p) => ({ path: p, name: basename(p) })) };
});

// Persist the current native clipboard image to a temp PNG so a pasted
// screenshot can be attached by PATH. Returns an error result when the
// clipboard holds no image (e.g. a normal text paste).
ipcMain.handle('clipboard:saveImage', async () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { ok: false as const, error: 'no image in clipboard' };
    const dir = join(app.getPath('temp'), 'cth-pastes');
    mkdirSync(dir, { recursive: true });
    const name = `paste-${Date.now()}.png`;
    const dest = join(dir, name);
    writeFileSync(dest, img.toPNG());
    return { ok: true as const, file: { path: dest, name } };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});

// ─── IPC: command history (SQLite — every prompt submitted to an agent) ──────
ipcMain.handle('history:add', (_evt, payload: unknown) => {
  const p = (payload ?? {}) as { agentId?: unknown; cwd?: unknown; text?: unknown };
  if (typeof p.agentId !== 'string' || typeof p.text !== 'string') return { ok: false, error: 'invalid args' };
  try {
    persist.addHistory({ agentId: p.agentId, cwd: typeof p.cwd === 'string' ? p.cwd : null, text: p.text });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
});
ipcMain.handle('history:list', (_evt, agentId: unknown, limit: unknown) =>
  persist.listHistory(
    typeof agentId === 'string' && agentId ? agentId : undefined,
    typeof limit === 'number' ? limit : undefined
  ));
ipcMain.handle('history:search', (_evt, query: unknown, limit: unknown) =>
  persist.searchHistory(typeof query === 'string' ? query : '', typeof limit === 'number' ? limit : undefined));

// ─── IPC: quit confirmation ─────────────────────────────────────────────────
/** Tear the harness down and quit. Shared by the hard "kill all & quit" path
 *  and the closing-time conclusion (after the god confirmed the floor saved). */
function teardownAndQuit(): void {
  allowQuit = true;
  // Each teardown step is best-effort: a throw here (e.g. a dying child or a
  // half-torn-down socket) must never abort the quit or pop a crash dialog.
  try { clearMissionTimers(); } catch (e) { console.error('[quit] clearMissionTimers:', e); }
  try { clearContextTimers(); } catch (e) { console.error('[quit] clearContextTimers:', e); }
  try { stopWebhookDoneObserver(); } catch (e) { console.error('[quit] stopWebhookDoneObserver:', e); }
  try { stopEphemeralWorkerWatcher(); } catch (e) { console.error('[quit] stopWorkerWatcher:', e); }
  try { integrationBroker.stop(); } catch (e) { console.error('[quit] broker.stop:', e); }
  try { mailService.closeAll(); } catch (e) { console.error('[quit] mail.closeAll:', e); }
  try { hive.stopRouter(); } catch (e) { console.error('[quit] stopRouter:', e); }
  try { hookServer.stop(); } catch (e) { console.error('[quit] hookServer.stop:', e); }
  try { telemetry.stop(); } catch (e) { console.error('[quit] telemetry.stop:', e); }
  try { stopSlackServer(); } catch (e) { console.error('[quit] slack.stop:', e); }
  try { stopWebhookServer(); } catch (e) { console.error('[quit] webhook.stop:', e); }
  try { memory.stop(); } catch (e) { console.error('[quit] memory.stop:', e); }
  try { memoryTidy.stop(); } catch (e) { console.error('[quit] memoryTidy.stop:', e); }
  try { persist.close(); } catch (e) { console.error('[quit] persist.close:', e); }
  try { hive.stopAllProxyBridges(); } catch (e) { console.error('[quit] stopAllProxyBridges:', e); }
  try { ptyManager.killAll(); } catch (e) { console.error('[quit] killAll:', e); }
  app.quit();
}
// The clock menu's Closing time: the same path as Cmd-Q. before-quit starts
// closing time when terminals are running and lets the app quit when none are
// (window.close() only closed the window, leaving the app in the Dock).
ipcMain.handle('app:requestQuit', () => {
  app.quit();
});
ipcMain.handle('app:confirmClose', () => {
  closingTime.cancel(); // a hard quit overrides a closing time in progress
  teardownAndQuit();
});
ipcMain.handle('app:cancelClose', () => {
  // The modal closes on the renderer side. The one thing main owes anybody here
  // is the truth about a restart-to-install: if this quit was one, it has just
  // been called off, and whoever is waiting on it needs to hear that rather than
  // sit disabled forever waiting for a process that is not going to die.
  abortPendingRestart();
});

// ─── IPC: closing time (graceful, data-loss-free shutdown) ──────────────────
// The third quit-dialog button. The god broadcasts closing time, every worker
// saves its memory and ACKs, the god concludes with CLOSING-TIME-COMPLETE —
// only then does the harness tear down. See closingTime.ts for the protocol.
const closingTime = new ClosingTimeController(
  hive,
  // Roster source: agents with a live PTY right now (ptyToAgent is pruned on
  // every teardown). The registry alone would include ghost workers from
  // sessions that ended with a hard quit — never archived, never able to ACK.
  () => [...new Set(ptyToAgent.values())],
  () => liveWebContents(),
  (relaunch) => {
    // Same dev-mode caveat as restart.ts: a relaunched dev build opens blank.
    if (relaunch && !process.env.ELECTRON_RENDERER_URL) app.relaunch();
    teardownAndQuit();
  },
  // #7C.2 steering — the graceful interrupt that reaches deeply busy agents
  // at their next hook boundary instead of waiting for a Stop.
  control
);
hive.setRoutedObserver((msg, targets) => closingTime.onRouted(msg, targets));
ipcMain.handle('app:startClosingTime', (_evt, opts?: { relaunch?: boolean }) =>
  closingTime.start({ relaunch: opts?.relaunch === true }));
ipcMain.handle('app:cancelClosingTime', () => closingTime.cancel());
/** The closing-time dialog's Remind and Close without them (owner, 2026-09-29). */
ipcMain.handle('app:closingTimeRemind', (_evt, id: unknown) => closingTime.remind(id));
ipcMain.handle('app:closingTimeExcuse', (_evt, id: unknown) => closingTime.excuse(id));

// ─── IPC: full reset (wipe data + config, relaunch into onboarding) ──────────
ipcMain.handle('app:resetAll', () => {
  allowQuit = true;
  // Tear everything down first so nothing writes back into the dirs we wipe.
  try { clearMissionTimers(); } catch (e) { console.error('[reset] clearMissionTimers:', e); }
  try { clearContextTimers(); } catch (e) { console.error('[reset] clearContextTimers:', e); }
  try { stopWebhookDoneObserver(); } catch (e) { console.error('[reset] stopWebhookDoneObserver:', e); }
  try { stopEphemeralWorkerWatcher(); } catch (e) { console.error('[reset] stopWorkerWatcher:', e); }
  try { integrationBroker.stop(); } catch (e) { console.error('[reset] broker.stop:', e); }
  try { mailService.closeAll(); } catch (e) { console.error('[reset] mail.closeAll:', e); }
  try { hive.stopRouter(); } catch (e) { console.error('[reset] stopRouter:', e); }
  try { hookServer.stop(); } catch (e) { console.error('[reset] hookServer.stop:', e); }
  try { telemetry.stop(); } catch (e) { console.error('[reset] telemetry.stop:', e); }
  try { stopSlackServer(); } catch (e) { console.error('[reset] slack.stop:', e); }
  try { memory.stop(); } catch (e) { console.error('[reset] memory.stop:', e); }
  try { memoryTidy.stop(); } catch (e) { console.error('[reset] memoryTidy.stop:', e); }
  try { persist.close(); } catch (e) { console.error('[reset] persist.close:', e); }
  try { ptyManager.killAll(); } catch (e) { console.error('[reset] killAll:', e); }
  try { hive.removeExposedCodexData(); } catch (e) { console.error('[reset] removeExposedCodexData:', e); }
  // Erase the hive (Michael's + every agent's memory, inboxes, tasks, board,
  // git history) and the semantic-memory palace. Only these harness-created
  // subdirs are removed — never the user's whole harnessHome folder.
  for (const dir of [hive.root(), memory.palacePath()]) {
    if (!dir) continue;
    try { rmSync(dir, { recursive: true, force: true }); }
    catch (e) { console.error('[reset] rm', dir, e); }
  }
  // The roster is the renderer's half of the same state, so it retires with the
  // hive — archived into roster-backups/ rather than deleted, and cleared as the
  // active file so re-selecting this folder later doesn't resurrect agents whose
  // sessions and memory are gone.
  try { roster.archive(); }
  catch (e) { console.error('[reset] roster.archive:', e); }
  // Back to first-run defaults, then relaunch clean so all in-memory services
  // re-bootstrap from scratch and the renderer lands on onboarding.
  resetConfig();
  restartApp(app);
});

// ─── IPC: token telemetry (real usage + est. cost from CC transcripts) ───────
// Reconciler/fallback path: per-cwd transcript sum, now priced PER MODEL (cost
// bug #1 fixed in pricing.ts). Kept for back-compat with the existing UsageRow.
ipcMain.handle('hive:agentUsage', (_evt, cwd: unknown) =>
  typeof cwd === 'string' ? readAgentUsage(cwd) : null);
// Current context size (tokens) of an agent's LIVE session — the transcript
// path is learned from the agent's hook payloads (SessionStart fires right at
// spawn), so this works even when several agents share one cwd. Null until the
// first hook fires; a known-but-empty transcript reads as 0 so a freshly
// (re)started session zeroes the gauge instead of leaving a stale value up.
ipcMain.handle('hive:agentContext', (_evt, agentId: unknown) => {
  if (typeof agentId !== 'string') return null;
  const tp = hookServer.transcriptPath(agentId);
  if (!tp) return null;
  return readContextTokens(tp) ?? 0;
});

// A consolidated, NON-SENSITIVE per-agent directory for the voice read-layer
// (Realtime Michael's get_agent_detail / list_agents). One read that joins
// everything the office-floor sidebar + telemetry know per agent: the registry
// record (name/role/provider/cwd/status/archived/isGod/isAssistant/sessionId/
// cwdValid), live token + breaker + last-tool telemetry, and the current context
// window fill. Includes ARCHIVED agents (unlike the heartbeat's fleet.json, which
// is live-only) so Michael can speak to inactive agents — their cwd and memory
// stay reachable. PII-free: no secrets, env, or API keys ever leave main; cost is
// carried as tokens (+ a usd field the voice layer deliberately never speaks).
ipcMain.handle('hive:agentDirectory', () => {
  if (!hive.enabled()) return { godId: null, agents: [] };
  const reg = hive.registry();
  const snap = telemetry.snapshot();
  const usageById = new Map(snap.usage.map((u) => [u.agentId, u]));
  const now = Date.now();
  const agents = Object.entries(reg.agents).map(([id, a]) => {
    const u = usageById.get(id);
    const spans = snap.spans[id] ?? [];
    const tokens = u ? u.input + u.output + u.cacheRead + u.cacheCreation : 0;
    const ctx = hookServer.contextFor(id);
    return {
      id,
      name: a.name,
      role: a.role ?? (a.isGod ? 'orchestrator' : 'agent'),
      provider: a.provider ?? 'claude',
      model: u?.model ?? null,
      status: a.status ?? 'idle',
      cwd: a.cwd ?? null,
      cwdValid: a.cwdValid ?? null,
      archived: !!a.archived,
      isGod: !!a.isGod,
      isAssistant: !!a.isAssistant,
      sessionId: a.sessionId ?? null,
      hasMemory: hive.hasMemory(id),
      inboxBacklog: hive.inboxBacklog(id),
      breaker: breaker.levelFor(id),
      tokens,
      usd: u ? Number(u.usd.toFixed(4)) : 0,
      lastTool: spans.length ? spans[spans.length - 1].tool : null,
      lastActiveSecAgo: u ? Math.round((now - u.ts) / 1000) : null,
      contextTokens: ctx?.tokens ?? null,
      contextLimit: ctx?.limit ?? null,
      contextPct: ctx && ctx.limit > 0 ? Math.round((ctx.tokens / ctx.limit) * 100) : null
    };
  });
  return { godId: reg.godId, agents };
});

// ─── IPC: live telemetry (the OTel collector — the locked usage-provider seam) ─
// The fleet grid + span waterfall (#7B) read these; Lane A's breaker (#6)
// consumes getAgentUsage in-process via the provider, not over IPC.
ipcMain.handle('telemetry:usage', (_evt, agentId: unknown) =>
  typeof agentId === 'string' ? telemetry.getAgentUsage(agentId) : null);
ipcMain.handle('telemetry:spans', (_evt, agentId: unknown) =>
  typeof agentId === 'string' ? telemetry.getSpans(agentId) : []);
ipcMain.handle('telemetry:snapshot', () => telemetry.snapshot());

// ─── IPC: circuit-breaker state (Lane A #6 policy → this lane's avatars/meter) ─
// Lane A's breaker calls this with a BreakerState; we fan it out to the renderer
// on `control:breakerState`, where the avatar adapter gives it precedence over
// hook-derived status (#5C looping/zombie). Defined here so the channel exists
// before Jim's policy lands; he produces, this lane consumes.
ipcMain.handle('control:setBreakerState', (_evt, state: unknown) => {
  try { liveWebContents()?.send('control:breakerState', state); } catch { /* window tore down */ }
  return { ok: true };
});

// ─── IPC: operator control over agents (#7C.1–7C.3) ─────────────────────────
// All return the agent's fresh control snapshot so the UI can reflect state.
ipcMain.handle('control:pause', (_evt, agentId: unknown, on: unknown) => {
  if (typeof agentId !== 'string') return null;
  control.pause(agentId, on === true);
  return control.snapshot(agentId);
});
ipcMain.handle('control:autoDelivery', (_evt, agentId: unknown, paused: unknown) => {
  if (typeof agentId !== 'string') return null;
  const on = paused === true;
  control.pauseAutoDelivery(agentId, on);
  const current = new Set(readConfig().autoDeliveryPausedAgents ?? []);
  if (on) current.add(agentId); else current.delete(agentId);
  writeConfig({ autoDeliveryPausedAgents: Array.from(current).sort() });
  return control.snapshot(agentId);
});
ipcMain.handle('control:resume', (_evt, agentId: unknown) => {
  if (typeof agentId !== 'string') return null;
  control.resume(agentId);
  return control.snapshot(agentId);
});
ipcMain.handle('control:gateTool', (_evt, agentId: unknown, tool: unknown, on: unknown) => {
  if (typeof agentId !== 'string' || typeof tool !== 'string') return null;
  control.gateTool(agentId, tool, on === true);
  return control.snapshot(agentId);
});
ipcMain.handle('control:steer', (_evt, agentId: unknown, text: unknown) => {
  if (typeof agentId !== 'string' || typeof text !== 'string') return null;
  control.steer(agentId, text);
  // A steer typed into the control strip is a human message. Counted HERE, at
  // the IPC seam, and deliberately not inside control.steer(): closingTime and
  // the voice action layer call that directly, and neither is a person typing.
  analytics.trackMessageSent('steer');
  return control.snapshot(agentId);
});
ipcMain.handle('control:halt', (_evt, agentId: unknown) => {
  if (typeof agentId !== 'string') return null;
  control.halt(agentId);
  return control.snapshot(agentId);
});
ipcMain.handle('control:snapshot', (_evt, agentId: unknown) =>
  typeof agentId === 'string' ? control.snapshot(agentId) : null);

// ─── IPC: scheduled missions (recurring auto-dispatch) ──────────────────────
// One schedule per call. Each op reads the config as it is NOW and changes only
// the schedule it names, so a view opened earlier (an agent's tab, Michael's
// list) can never delete a schedule it didn't know about. The old whole-list
// save did exactly that once schedules could be added from ASK ME (eng review
// R2). Every op answers { ok, error? } so the UI can show a failed save (7A).
type MissionOpResult = { ok: true } | { ok: false; error: string };
function applyMissions(change: (list: ScheduledMission[]) => ScheduledMission[] | null): MissionOpResult {
  try {
    const next = change(readConfig().missions ?? []);
    if (!next) return { ok: false, error: 'not found' };
    writeConfig({ missions: next });
    // The change is saved from here on. Re-arming the timers can't turn that
    // into a reported failure, or the owner retries a save that landed
    // (adversarial review, 2026-09-25).
    try { syncMissions(); } catch (e) { console.error('[missions] re-arm failed after save', e); }
    try { liveWebContents()?.send('missions:updated'); } catch { /* window gone */ }
    return { ok: true };
  } catch (e) {
    console.error('[missions] write failed', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
const isMission = (m: unknown): m is ScheduledMission =>
  !!m && typeof m === 'object' && typeof (m as ScheduledMission).id === 'string' && typeof (m as ScheduledMission).label === 'string'
  && typeof (m as ScheduledMission).to === 'string' && typeof (m as ScheduledMission).enabled === 'boolean';
ipcMain.handle('missions:list', () => readConfig().missions ?? []);
ipcMain.handle('missions:upsert', (_evt, mission: unknown): MissionOpResult => {
  if (!isMission(mission)) return { ok: false, error: 'invalid schedule' };
  // Several "when" lines are stored canonical, or the save is refused: a bad
  // line would run on a clock nobody set.
  // The focus area is stored clean (FA1); an empty one is no focus.
  let clean: ScheduledMission = { ...mission };
  const focus = cleanFocus(mission.focus);
  if (focus) clean.focus = focus; else delete clean.focus;
  if (mission.times !== undefined) {
    const times = normalizeTimes(mission.times);
    if (!times) return { ok: false, error: 'invalid schedule times' };
    clean = { ...clean, times };
  }
  return applyMissions((list) => upsertMission(list, clean));
});
ipcMain.handle('missions:delete', (_evt, id: unknown): MissionOpResult =>
  typeof id === 'string' ? applyMissions((list) => deleteMission(list, id)) : { ok: false, error: 'invalid id' });
ipcMain.handle('missions:setEnabled', (_evt, id: unknown, on: unknown): MissionOpResult =>
  typeof id === 'string' ? applyMissions((list) => setMissionEnabled(list, id, on === true)) : { ok: false, error: 'invalid id' });

// ─── IPC: schedule requests (an agent asked, the owner decides in ASK ME) ────
ipcMain.handle('scheduleRequests:list', () => {
  // Requests filed before merging existed are folded into one card per job.
  const cfg = readConfig();
  const pending = cfg.scheduleRequests ?? [];
  const folded = foldScheduleRequests(pending, cfg.missions ?? []);
  if (folded.length !== pending.length) writeConfig({ scheduleRequests: folded });
  return folded;
});
ipcMain.handle('scheduleRequests:decide', (_evt, id: unknown, approve: unknown): MissionOpResult => {
  if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
  return decideScheduleRequest(id, approve === true);
});

// ─── IPC: Send on approval (an agent proposed an email, the owner decides) ───
// A member no longer on the team has no card on Ask me: nobody would send it.
ipcMain.handle('mailProposals:list', () => mailApprovals.waiting().filter((p) => memberPresent(p.agentId)));
ipcMain.handle('mailProposals:decide', (_evt, id: unknown, decision: unknown, edit: unknown, note: unknown, standing: unknown) => {
  if (typeof id !== 'string' || (decision !== 'approve' && decision !== 'changes' && decision !== 'decline')) return { ok: false, error: 'invalid' };
  const e = (edit && typeof edit === 'object' ? edit : {}) as { subject?: unknown; body?: unknown };
  return mailApprovals.decide(id, decision, e, note, standing);
});
/** A Send only member's latest sends from its grant's mailbox, for its Access tab
 *  (shared-mailboxes.md, O1b): app private, never in the office log. */
ipcMain.handle('mail:recentSends', (_evt, agentId: unknown, mailbox: unknown) =>
  (typeof agentId === 'string' && typeof mailbox === 'string' ? mailApprovals.recentSends(agentId, mailbox, 5).map((r) => ({ to: r.to, subject: r.subject, sentAt: r.sentAt })) : []));
// Standing approvals: kinds an agent may send without asking, revocable on its Access tab.
ipcMain.handle('mailStanding:list', (_evt, agentId: unknown) => (typeof agentId === 'string' ? mailApprovals.standing(agentId) : []));
ipcMain.handle('mailStanding:revoke', (_evt, id: unknown) => (typeof id === 'string' ? mailApprovals.revokeStanding(id) : { ok: false, error: 'invalid' }));

/** The owner closed this agent (not a crash or a restart): pause its schedules
 *  and mark it, so Michael's list shows it as closed (design 6A, eng review R1). */
ipcMain.handle('agent:closedByOwner', (_evt, id: unknown): { ok: boolean; paused: number } => {
  if (typeof id !== 'string' || !id) return { ok: false, paused: 0 };
  return closeAgentByOwner(id);
});

// ─── IPC: full-text search across hive files (board, tasks, memory) ──────────
ipcMain.handle('hive:textSearch', (_evt, query: unknown) => {
  if (typeof query !== 'string' || !query.trim()) return { ok: false, results: [] };
  const root = hive.root();
  if (!root) return { ok: false, results: [] };
  const q = query.toLowerCase();
  const results: Array<{ source: string; excerpt: string }> = [];
  // Each target file is (path, readable label). agents/<id>/memory.md is expanded below.
  const targets: Array<{ path: string; source: string }> = [
    { path: join(root, 'board.md'), source: 'board.md' },
    { path: join(root, 'tasks.json'), source: 'tasks.json' }
  ];
  const agentsDir = join(root, 'agents');
  if (existsSync(agentsDir)) {
    for (const id of readdirSync(agentsDir)) {
      targets.push({ path: join(agentsDir, id, 'memory.md'), source: `${id}/memory.md` });
    }
  }
  for (const { path, source } of targets) {
    if (!existsSync(path)) continue;
    let hits = 0;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (hits >= 3) break;
      const idx = line.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      // ~40 chars of context on either side of the match.
      const excerpt = line.slice(Math.max(0, idx - 40), idx + q.length + 40).trim();
      results.push({ source, excerpt });
      hits++;
    }
  }
  return { ok: true, results };
});

// ─── IPC: GitHub issue ingestion (gh CLI) ────────────────────────────────────
ipcMain.handle('github:issues', (_evt, cwd: unknown) =>
  typeof cwd === 'string' ? listIssues(cwd) : { ok: false, error: 'no cwd' }
);

// ─── IPC: GitHub CI status watcher (gh CLI) ──────────────────────────────────
ipcMain.handle('github:ciRuns', (_evt, cwd: unknown) =>
  typeof cwd === 'string' ? listCIRuns(cwd) : { ok: false, error: 'no cwd' }
);

// ─── IPC: desktop notifications toggle ──────────────────────────────────────
ipcMain.handle('app:setNotifications', (_evt, val) => writeConfig({ notifications: val === true }));

// ─── IPC: onboarding reliability — open Settings deep-link + login-item toggle ─
/** Open a System Settings deep-link (or https URL) in the OS default handler.
 *  Restricted to Settings panes / https so the renderer can't shell arbitrary
 *  schemes. macOS uses `x-apple.systempreferences:`, Windows uses `ms-settings:`
 *  (Linux has no universal settings URI, so the renderer never sends one there).
 *  Used by the onboarding "Permissions & reliability" step. */
ipcMain.handle('app:openExternal', async (_evt, url: unknown) => {
  if (typeof url !== 'string' || !/^(x-apple\.systempreferences:|ms-settings:|https:\/\/)/.test(url)) {
    return { ok: false, error: 'blocked url' };
  }
  await shell.openExternal(url);
  return { ok: true };
});
/** Toggle macOS "Open at Login" — fully programmatic, no permission prompt.
 *  Returns the resulting state so the renderer toggle reflects reality. */
ipcMain.handle('app:setLoginItem', (_evt, enabled: unknown) => {
  if (process.platform === 'linux') return false;
  app.setLoginItemSettings({ openAtLogin: enabled === true });
  return app.getLoginItemSettings().openAtLogin;
});

// ─── IPC: Slack integration ─────────────────────────────────────────────────
ipcMain.handle('slack:start', () => startSlackServer());
/** Stop must survive a restart. Boot re-arms from `slackEnabled`, so stopping
 *  without clearing it silently brought the server back on the next launch —
 *  the user pressed Stop and Slack was live again.
 *
 *  Persist BEFORE tearing down. If the write throws (read-only volume, ENOSPC)
 *  the server is still up and the UI stays truthful; the other order leaves a
 *  dead server that still reads as Connected with the flag set, which is this
 *  same bug again with no error to show for it.
 *
 *  Only this handler clears the flag. changeHome / quit / reset call
 *  `stopSlackServer()` directly and must not: they are lifecycle, not a user
 *  turning the integration off. (Start persists the flag from the renderer, in
 *  `SettingsModal.startSlack`, not here.) */
ipcMain.handle('slack:stop', () => {
  writeConfig({ slackEnabled: false });
  stopSlackServer();
  return { ok: true };
});
/** Current connection state + last Request URL — lets Settings hydrate the
 *  "Connected" badge and re-show the persisted tunnel URL on reopen. */
ipcMain.handle('slack:status', () => ({ running: slackServer != null, url: lastSlackUrl }));
/** Absolute path to the bundled reply helper, for the prompt the office worker
 *  runs to post its summary back in-thread. No secret crosses this boundary. */
ipcMain.handle('slack:replyScriptPath', () => slackReplyScriptPath());
/** Renderer's immediate "queued" ack into the triggering Slack thread. The bot
 *  token stays in main — only channel/thread/text cross IPC. */
ipcMain.handle('slack:reply', (_evt, arg: unknown) => {
  const p = (arg ?? {}) as { channel?: unknown; thread_ts?: unknown; text?: unknown };
  const cfg = readConfig();
  // CLAUSE-3 (human: "stop posting into Slack by default"): this is the ONLY
  // app/voice-INITIATED proactive Slack post (the renderer's "queued" ack). It is
  // OFF unless the user opts in via Settings → Slack. The Slack-ORIGIN done-reply
  // round-trip (done-poller) and an agent's own direct /reply are NOT routed
  // through here, so they are unaffected and always stay on.
  if (!cfg.slackProactivePosting) return { ok: false, error: 'app-initiated Slack posting disabled (enable in Settings → Slack)' };
  const botToken = cfg.slackBotToken;
  if (!botToken) return { ok: false, error: 'no bot token' };
  if (typeof p.channel !== 'string' || typeof p.thread_ts !== 'string' || typeof p.text !== 'string') {
    return { ok: false, error: 'channel, thread_ts, text required' };
  }
  // CLAUSE-1 (fix-slack-integration): an app-initiated send must target an
  // EXPLICIT thread — reject a blank/whitespace channel or thread rather than
  // letting it fall through to an implicit destination (the channel root).
  if (!p.channel.trim() || !p.thread_ts.trim()) {
    return { ok: false, error: 'explicit channel + thread_ts required' };
  }
  return postSlackReply({ botToken, channel: p.channel, thread_ts: p.thread_ts, text: p.text });
});
ipcMain.handle('slack:setConfig', (_evt, patch: unknown) => {
  const p = (patch ?? {}) as {
    signingSecret?: unknown; botToken?: unknown; channelId?: unknown; port?: unknown; enabled?: unknown;
    proactivePosting?: unknown;
  };
  const next: Partial<HarnessConfig> = {};
  // Trim string fields; an emptied field clears back to undefined.
  if (typeof p.signingSecret === 'string') next.slackSigningSecret = p.signingSecret.trim() || undefined;
  if (typeof p.botToken === 'string') next.slackBotToken = p.botToken.trim() || undefined;
  if (typeof p.channelId === 'string') next.slackChannelId = p.channelId.trim() || undefined;
  if (typeof p.port === 'number' && Number.isFinite(p.port)) next.slackPort = p.port;
  if (typeof p.enabled === 'boolean') next.slackEnabled = p.enabled;
  if (typeof p.proactivePosting === 'boolean') next.slackProactivePosting = p.proactivePosting;
  writeConfig(next);
  // Reconcile the running server: disabling (or clearing the secret) stops it. We
  // deliberately do NOT auto-(re)start here — the user presses Start in Settings
  // to fetch the fresh (ephemeral) tunnel URL.
  const cfg = readConfig();
  if (!cfg.slackEnabled || !cfg.slackSigningSecret) stopSlackServer();
  return { ok: true };
});

// ─── IPC: Triggers — context (auto-compact / auto-clear) ────────────────────
ipcMain.handle('triggers:getContext', () => readConfig().contextTrigger ?? DEFAULT_CONTEXT_TRIGGER);
ipcMain.handle('triggers:setContext', (_evt, arg: unknown) => {
  const current = readConfig().contextTrigger ?? DEFAULT_CONTEXT_TRIGGER;
  const p = (arg ?? {}) as Partial<ContextTriggerConfig>;
  const next: ContextTriggerConfig = {
    compact: sanitizeContextRule(p.compact, current.compact),
    clear: sanitizeContextRule(p.clear, current.clear)
  };
  writeConfig({ contextTrigger: next });
  // The timers ARE the setting — a cadence saved but not re-armed would keep
  // firing on the old rhythm until the next boot.
  syncContextTriggers();
  return next;
});

/** Clamp one half of the context trigger. The renderer is not trusted with the
 *  arming maths: a zero/negative/NaN `everyMs` would arm a runaway timer, and an
 *  out-of-range percentage would silently disable (or permanently trip) the
 *  pressure gate. */
function sanitizeContextRule(patch: Partial<ContextRule> | undefined, current: ContextRule): ContextRule {
  const p = (patch ?? {}) as Partial<ContextRule>;
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : current.enabled,
    everyMs: num(p.everyMs, current.everyMs, 60_000, 86_400_000),
    minContextPct: num(p.minContextPct, current.minContextPct, 0, 100),
    minContextPctLargeWindow: num(p.minContextPctLargeWindow, current.minContextPctLargeWindow, 0, 100),
    message: typeof p.message === 'string' ? p.message : current.message
  };
}

// ─── IPC: Triggers — webhooks (many endpoints, one server, one tunnel) ──────
ipcMain.handle('webhooks:list', () => readConfig().webhookTriggers ?? []);
ipcMain.handle('webhooks:save', (_evt, arg: unknown) => {
  const incoming = Array.isArray(arg) ? arg : [];
  const existing = readConfig().webhookTriggers ?? [];
  const list: WebhookTrigger[] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    const t = sanitizeWebhookTrigger(raw, existing);
    if (!t || seen.has(t.id)) continue; // an id is a URL path segment — one owner each
    seen.add(t.id);
    list.push(t);
  }
  writeConfig({ webhookTriggers: list });
  reconcileWebhookServer();
  return list;
});
ipcMain.handle('webhooks:delete', (_evt, arg: unknown) => {
  const id = typeof arg === 'string' ? arg : '';
  const list = (readConfig().webhookTriggers ?? []).filter((t) => t.id !== id);
  writeConfig({ webhookTriggers: list });
  // Revoking one endpoint must not disturb the others: the live server is
  // re-pointed, not restarted, so every remaining caller's URL keeps working.
  reconcileWebhookServer();
  return list;
});
/** Mint a strong (256-bit) secret for the operator to paste into their caller.
 *  Not persisted here — it belongs to whichever endpoint the UI saves it onto. */
ipcMain.handle('webhooks:generateSecret', () => randomBytes(32).toString('hex'));
/** Server state + the tunnel root + one public URL per configured endpoint (the
 *  UI offers a copy button per webhook, so the root alone isn't enough). */
ipcMain.handle('webhooks:status', () => ({
  running: webhookServer != null,
  url: lastWebhookUrl,
  endpoints: webhookEndpointUrls()
}));

/** Normalise one endpoint coming back from the renderer. Unknown/blank fields
 *  fall back to what is already persisted, so a UI that round-trips a partially
 *  filled row can never blank a live secret or silently widen a mode. */
function sanitizeWebhookTrigger(raw: unknown, existing: WebhookTrigger[]): WebhookTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<WebhookTrigger>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  // The id is spliced into a public URL path. Restrict it to a boring charset
  // rather than escaping later: no slashes (which would forge a nested route),
  // no encoded traversal, nothing that could make two endpoints alias.
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) return null;
  const prior = existing.find((t) => t.id === id);
  const secret = typeof r.secret === 'string' && r.secret.trim() ? r.secret.trim() : prior?.secret ?? '';
  const mode = isTriggerMode(r.mode) ? r.mode : prior?.mode ?? DEFAULT_TRIGGER_MODE;
  return {
    id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : prior?.name ?? id,
    secret,
    // A secretless endpoint can never be enabled — it would be an open door.
    enabled: secret ? (typeof r.enabled === 'boolean' ? r.enabled : prior?.enabled ?? false) : false,
    mode,
    schema: typeof r.schema === 'string' && r.schema.trim() ? r.schema : prior?.schema ?? DEFAULT_WEBHOOK_SCHEMA,
    createdAt: typeof r.createdAt === 'number' && r.createdAt > 0 ? r.createdAt : prior?.createdAt ?? Date.now()
  };
}

function isTriggerMode(v: unknown): v is TriggerMode {
  return v === 'strict' || v === 'allow-all' || v === 'communication-only';
}

// ─── IPC: Triggers — organisation (persistence only; no transport yet) ──────
ipcMain.handle('org:getTrigger', () => readConfig().orgTrigger ?? DEFAULT_ORG_TRIGGER);
ipcMain.handle('org:setTrigger', (_evt, arg: unknown) => {
  const current = readConfig().orgTrigger ?? DEFAULT_ORG_TRIGGER;
  const p = (arg ?? {}) as Partial<OrgTriggerConfig>;
  // PERSIST ONLY — the peer messaging service does not exist yet, so nothing
  // reads `apiKey` beyond the settings surface that shows it. Deliberately no
  // start/stop, no network, no side effect of any kind.
  const next: OrgTriggerConfig = {
    apiKey: typeof p.apiKey === 'string' ? p.apiKey.trim() : current.apiKey,
    enabled: typeof p.enabled === 'boolean' ? p.enabled : current.enabled,
    mode: isTriggerMode(p.mode) ? p.mode : current.mode
  };
  writeConfig({ orgTrigger: next });
  return next;
});

// ─── IPC: Triggers — history ledger + the approval gate ─────────────────────
ipcMain.handle('triggerHistory:list', () => listTriggerHistory());
ipcMain.handle('triggerHistory:clear', (_evt, arg: unknown) => {
  const source = arg === 'webhook' || arg === 'org' ? arg : undefined;
  clearTriggerHistory(source);
  pruneHeldTokens();
  notifyTriggerHistoryUpdated();
  return { ok: true };
});
/**
 * The operator's verdict on a held message.
 *
 * 'approved' RELEASES it: it takes the identical path an auto-allowed message
 * would have taken (card + god request), then the entry flips. 'rejected' just
 * flips — nothing is ever dispatched.
 *
 * Idempotent by construction: only an entry still sitting at `pending` can be
 * decided, so a double-click (or two windows deciding at once) cannot dispatch
 * the same message twice.
 */
ipcMain.handle('triggerHistory:decide', (_evt, arg: unknown) => {
  const p = (arg ?? {}) as { id?: unknown; decision?: unknown };
  const id = typeof p.id === 'string' ? p.id : '';
  const decision = p.decision === 'approved' ? 'approved' : p.decision === 'rejected' ? 'rejected' : null;
  if (!id || !decision) return null;
  const entry: TriggerHistoryEntry | undefined = listTriggerHistory().find((e) => e.id === id);
  if (!entry) return null;
  if (entry.decision !== 'pending') return entry; // already decided → no-op, not a re-dispatch

  if (decision === 'rejected') {
    const next = updateTriggerHistory(id, { decision: 'rejected' });
    notifyTriggerHistoryUpdated();
    return next;
  }

  const taskId = `webhook-${randomBytes(8).toString('hex')}`;
  const tokenHash = heldTokenHashFor(id);
  const title = entry.title ?? (entry.body.length > 80 ? `${entry.body.slice(0, 79)}…` : entry.body);
  if (!dispatchWebhookWork({ taskId, title, message: entry.body, tokenHash, origin: entry.source })) {
    // The card is what the caller polls and what god works from. Leave the entry
    // pending so the operator can approve again once the hive is writable.
    return entry;
  }
  // The hash now lives on the card, so the caller's GET resolves through the
  // normal task lookup from here on.
  if (tokenHash) { heldTokens().delete(tokenHash); persistHeldTokens(); }
  const next = updateTriggerHistory(id, { decision: 'approved', taskId });
  pruneHeldTokens();
  notifyTriggerHistoryUpdated();
  return next;
});

// ─── IPC: Generic webhook (LEGACY single-endpoint channels) ─────────────────
// Kept alive for Settings → Webhook, which still speaks the one-secret shape.
// They are now THIN SHIMS over the multi-endpoint engine: the legacy secret and
// enabled flag map onto the `legacy` WebhookTrigger the config migration created,
// so the two surfaces can never disagree about whether the endpoint is live.
ipcMain.handle('webhook:start', () => startWebhookServer());
ipcMain.handle('webhook:stop', () => { stopWebhookServer(); return { ok: true }; });
/** Current state + last public endpoint URL, for the Settings badge/URL field. */
ipcMain.handle('webhook:status', () => ({ running: webhookServer != null, url: lastWebhookUrl }));
/** Mint a strong (256-bit) secret, persist it, and return it so Settings can show
 *  it for the user to copy into their client. The previous secret is replaced. */
ipcMain.handle('webhook:generateSecret', () => {
  const secret = randomBytes(32).toString('hex');
  writeConfig({ webhookSecret: secret });
  upsertLegacyWebhookTrigger({ secret });
  return { ok: true, secret };
});
ipcMain.handle('webhook:setConfig', (_evt, patch: unknown) => {
  const p = (patch ?? {}) as { secret?: unknown; port?: unknown; enabled?: unknown };
  const next: Partial<HarnessConfig> = {};
  if (typeof p.secret === 'string') next.webhookSecret = p.secret.trim() || undefined;
  if (typeof p.port === 'number' && Number.isFinite(p.port)) next.webhookPort = p.port;
  if (typeof p.enabled === 'boolean') next.webhookEnabled = p.enabled;
  writeConfig(next);
  upsertLegacyWebhookTrigger({
    secret: typeof p.secret === 'string' ? p.secret.trim() : undefined,
    enabled: typeof p.enabled === 'boolean' ? p.enabled : undefined
  });
  // Disabling (or clearing the secret) stops the public surface immediately; the
  // reconcile also picks up the case where OTHER endpoints are still enabled, in
  // which case the server stays up minus the legacy one.
  reconcileWebhookServer();
  return { ok: true };
});

/** Mirror a legacy `webhook:setConfig` / `webhook:generateSecret` edit onto the
 *  `legacy` WebhookTrigger. Creates the row only once a secret exists — an
 *  enabled endpoint without a secret would be an open door, so a bare "enable"
 *  against a never-configured webhook is deliberately a no-op. */
function upsertLegacyWebhookTrigger(patch: { secret?: string; enabled?: boolean }): void {
  const list = readConfig().webhookTriggers ?? [];
  const prior = list.find((t) => t.id === 'legacy');
  const secret = patch.secret !== undefined ? patch.secret : prior?.secret ?? '';
  if (!secret) return;
  const row: WebhookTrigger = {
    id: 'legacy',
    name: prior?.name ?? 'Default webhook',
    secret,
    enabled: patch.enabled !== undefined ? patch.enabled : prior?.enabled ?? false,
    mode: prior?.mode ?? DEFAULT_TRIGGER_MODE,
    schema: prior?.schema ?? DEFAULT_WEBHOOK_SCHEMA,
    createdAt: prior?.createdAt ?? Date.now()
  };
  writeConfig({
    webhookTriggers: prior ? list.map((t) => (t.id === 'legacy' ? row : t)) : [...list, row]
  });
}

// ─── IPC: Free Flow (voice dictation → message queue) ────────────────────────
// Entry point B is hold-Option-to-talk, handled entirely in the renderer
// (capture-phase key listeners) — no globalShortcut here. macOS doesn't deliver
// the Fn key to Electron (electron#16714) and a faithful native Fn helper
// (CGEventTap) is deferred; hold-Option is the human-chosen v1 activation.

ipcMain.handle('freeflow:setConfig', (_evt, patch: unknown) => {
  const p = (patch ?? {}) as { enabled?: unknown; apiKey?: unknown; model?: unknown };
  const next: Partial<HarnessConfig> = {};
  if (typeof p.enabled === 'boolean') next.freeflowEnabled = p.enabled;
  // Trim string fields; an emptied key clears back to undefined.
  if (typeof p.apiKey === 'string') next.groqApiKey = p.apiKey.trim() || undefined;
  if (typeof p.model === 'string') next.freeflowModel = p.model.trim() || DEFAULT_GROQ_MODEL;
  writeConfig(next);
  return { ok: true };
});

/** Transcribe one captured audio clip via Groq. Gated on the flag + a key being
 *  present, so a disabled feature can NEVER reach the network. The Groq key stays
 *  in main — only the audio bytes cross IPC inbound and the transcript outbound. */
ipcMain.handle('freeflow:transcribe', async (_evt, arg: unknown) => {
  const cfg = readConfig();
  // Voice is off in this build (SHOW_VOICE): no dictation either.
  if (!SHOW_VOICE) return { ok: false, error: 'Voice is off in this version.' };
  if (!cfg.freeflowEnabled) return { ok: false, error: 'Free Flow is disabled' };
  if (!cfg.groqApiKey) return { ok: false, error: 'no Groq API key set' };
  const a = (arg ?? {}) as { audio?: unknown; mimeType?: unknown; filename?: unknown; language?: unknown };
  if (!(a.audio instanceof ArrayBuffer) && !(a.audio instanceof Uint8Array)) {
    return { ok: false, error: 'no audio' };
  }
  const out = await transcribeWithGroq({
    apiKey: cfg.groqApiKey,
    audio: a.audio,
    mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
    filename: typeof a.filename === 'string' ? a.filename : undefined,
    model: cfg.freeflowModel || DEFAULT_GROQ_MODEL,
    language: typeof a.language === 'string' && a.language ? a.language : undefined
  });
  if (out.ok) analytics.trackFeature('voice_dictation');
  return out;
});

// ─── IPC: Realtime Michael (voice orchestrator — ephemeral token mint, rt-1) ──
// MAIN owns the BYOK OpenAI key (encrypted broker, apikey:openai) and mints a
// short-lived EPHEMERAL client secret; the real key never crosses IPC. All wiring
// lives in ./realtime so this stays a single registration line.
registerRealtimeIpc();

// ─── IPC: Realtime Michael voice ACTIONS (rt-5, Phase 2) ─────────────────────
// Thin adapters over the SAME main fns the god PTY already uses. ALL of the safety
// spine — soft-vs-destructive tiering, the two-step verbal echo-back confirm, the
// distinct-token rule, the hard allowlist (kill-god / mass-ops forbidden), and the
// michael-voice attribution — lives in ./realtimeActions. This site only injects
// the existing functions; it adds NO new orchestration logic.
// ─── IPC: Realtime Michael completion watcher (rt-12, Phase 2) ───────────────
// Jim's net-new engine (realtimeCompletionWatcher.ts) detects a voice-dispatched
// task finishing (card→done OR a done-reply in michael-voice's inbox) and EMITS it;
// I own the seam — inject the hive read deps, push completions to the live session
// (so Michael speaks them unprompted), and bridge waitFor / queue-drain over IPC.
const completionWatcher = initCompletionWatcher({
  readTasks: () => { const t = hive.tasks() as { tasks?: TaskCard[] }; return Array.isArray(t?.tasks) ? t.tasks : []; },
  // Voice dispatches go out as from:michael-voice, so assignee done-replies land here.
  readInbox: () => {
    // Voice dispatches go out from:michael-voice, so done-replies normally land in its
    // inbox — but an assignee may address god out of habit. Merge both inboxes (de-dupe
    // by id) so a god-addressed completion isn't missed; the detector filters by sender.
    try {
      const mv = hive.inbox('michael-voice') as unknown as InboxMessage[];
      const godId = hive.registry().godId;
      const god = godId ? (hive.inbox(godId) as unknown as InboxMessage[]) : [];
      const seen = new Set<string>();
      return [...mv, ...god].filter((m) => !!m?.id && !seen.has(m.id) && seen.add(m.id) !== undefined);
    } catch {
      return [];
    }
  },
  onNotify: (evt) => {
    try {
      if (!Notification.isSupported()) return;
      const reg = hive.registry();
      const title = resolveGodName(reg.agents[reg.godId ?? 'god']?.name);
      new Notification({ title, body: evt.summary }).show();
    } catch { /* best-effort */ }
  }
});

registerRealtimeActionIpc({
  hiveEnabled: () => hive.enabled(),
  hiveSend: (partial, from) => hive.send(partial, from),
  hiveTasks: () => hive.tasks(),
  hiveAddTask: (task) => hive.addTask(task as HiveTask),
  hivePatchTask: (id, patch) => hive.patchTask(id, patch as Partial<Omit<HiveTask, 'id'>>),
  hiveMoveTask: (id, status) => hive.ownerMoveTask(id, status),
  hiveCloseTask: (id, reason) => hive.ownerCloseTask(id, reason),
  hiveRegistry: () => hive.registry(),
  hiveLog: (event) => hive.appendLog(event),
  controlPause: (id, on) => control.pause(id, on),
  controlSteer: (id, text) => control.steer(id, text),
  controlHalt: (id) => control.halt(id),
  controlSnapshot: (id) => control.snapshot(id),
  killAgent: (id) => {
    const r = ptyManager.kill(id);
    teardownPty(id);
    // A voice (MAIN-initiated) kill: the renderer never removed the card itself
    // (unlike a UI kill), so tell the floor to archive it. Mirrors hive:agentSpawned.
    try { liveWebContents()?.send('hive:agentArchived', { id }); } catch { /* window torn down */ }
    return r;
  },
  spawnAgent: async (opts) => {
    const o = opts as AgentSpawnOptions;
    const res = await spawnAgentCore(o, null);
    // The renderer roster is only mutated by renderer-initiated hires (AddAgentModal),
    // so a MAIN-initiated spawn is invisible on the floor until we broadcast it. The
    // renderer (useHive) builds the Agent card from this descriptor; addAgent is
    // idempotent so a renderer-initiated hire is never double-carded.
    if (res.ok) {
      try {
        liveWebContents()?.send('hive:agentSpawned', {
          id: o.id,
          name: o.hive?.name ?? o.id,
          provider: o.provider ?? o.hive?.provider ?? 'claude',
          cwd: res.worktreePath ?? o.cwd,
          command: o.command,
          role: o.hive?.role,
          worktreePath: res.worktreePath
        });
      } catch { /* window torn down */ }
    }
    return res;
  },
  listMissions: () => readConfig().missions ?? [],
  // The spec carries lastFiredAt through from listMissions(), so a wholesale write
  // preserves the scheduler's stamps; edit_schedule is deliberate + rare.
  // Through the single writer, so a voice edit re-arms the timers and refreshes the UI.
  saveMissions: (missions) => {
    // A failed save throws, so the voice action says it failed instead of "done".
    const res = applyMissions(() => missions);
    if (!res.ok) throw new Error(res.error);
  },
  // rt-12: register each voice dispatch so the watcher can detect its completion.
  trackDispatch: (d) => { try { completionWatcher.track({ ...d, kind: 'dispatch' }); } catch { /* watcher unavailable */ } },
  // ── v0.3.4 full-control extensions ──
  controlResume: (id) => control.resume(id),
  controlAutoDelivery: (id, paused) => control.pauseAutoDelivery(id, paused),
  controlGateTool: (id, toolName, on) => control.gateTool(id, toolName, on),
  setArchived: (id, archived) => {
    if (!hive.enabled()) return { ok: false, error: 'hive disabled' };
    // The owner archiving an agent by voice is closing it on purpose, so its
    // schedules pause like a close from the panel (eng review R1).
    if (archived) closeAgentByOwner(id);
    // Bringing it back ends "closed by the owner" (its schedules stay paused
    // until the owner turns them on, design 6A).
    else hive.setClosedByOwner(id, false);
    hive.setArchived(id, archived);
    try { liveWebContents()?.send(archived ? 'hive:agentArchived' : 'hive:agentSpawned', { id }); } catch { /* window gone */ }
    return { ok: true };
  },
  // clear_context: hand the text to the renderer's queue so delivery rides every
  // existing gate (idle-only, boot grace, draft/picker safety).
  enqueueToAgent: (id, text) => {
    try { liveWebContents()?.send('realtime:enqueue', { agentId: id, text }); } catch { /* window gone */ }
  },
  getConfigValue: (key) => (readConfig() as unknown as Record<string, unknown>)[key],
  patchConfig: (patch) => { writeConfig(patch as Partial<HarnessConfig>); }
});

// rt-12 seam: push detected completions to the live floor; bridge live-flag, queue
// drain (closed-session warm-start), and wait_for over IPC. Then start polling.
completionWatcher.onCompletion((evt) => { try { liveWebContents()?.send('realtime:completion', evt); } catch { /* window gone */ } });
// v0.3.4: the floor delta watcher shares the session-live flag — while a voice
// session is open it pushes coalesced floor updates the renderer injects as
// silent conversation items (snapshot-at-connect + append-only deltas).
const floorWatcher = new RealtimeFloorWatcher({
  enabled: () => hive.enabled(),
  registry: () => hive.registry(),
  tasks: () => hive.tasks(),
  ptys: () => ptyManager.list().map((p) => ({ id: p.id, lastOutputAt: p.lastOutputAt })),
  push: (text) => { try { liveWebContents()?.send('realtime:floorDelta', { text }); } catch { /* window gone */ } }
});
floorWatcher.start();
ipcMain.handle('realtime:setSessionLive', (_e, live: unknown) => {
  completionWatcher.setSessionLive(live === true);
  floorWatcher.setSessionLive(live === true);
  return { ok: true };
});
// v0.3.4: app self-knowledge for the voice get_app_info tool — version + the
// newest CHANGELOG sections. Read-only; ships CHANGELOG.md with the app.
ipcMain.handle('app:info', () => {
  let changelog = '';
  for (const p of [join(app.getAppPath(), 'CHANGELOG.md'), join(process.cwd(), 'CHANGELOG.md')]) {
    try { changelog = readFileSync(p, 'utf8'); if (changelog) break; } catch { /* try next */ }
  }
  const top = changelog
    ? changelog.split(/\n## /).slice(1, 3).map((s) => `## ${s}`).join('\n').slice(0, 8000)
    : '';
  // `packaged`: only installed builds check for updates (updater.ts), so
  // Settings can say so instead of promising checks a dev build never runs.
  return { version: app.getVersion(), changelog: top, packaged: app.isPackaged };
});
ipcMain.handle('realtime:drainCompletions', () => completionWatcher.drainQueuedCompletions());
ipcMain.handle('realtime:waitFor', (_e, taskId: unknown, timeoutMs: unknown) =>
  typeof taskId === 'string'
    ? completionWatcher.waitFor(taskId, typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 120_000)
    : Promise.resolve({ timedOut: true as const, taskId: '' }));
completionWatcher.start();

// ─── god-triggered ephemeral Slack workers ──────────────────────────────────
// god drops a spawn-request JSON into HIVE_ROOT/spawn-requests/; MAIN polls that
// queue (same cadence + atomic-rename archival as the hive router — reliability
// over latency, no fs.watch/dedup needed), spins up a FRESH ISOLATED worker via
// the shared spawnAgentCore, dispatches the objective through the standard inbox
// path, then watches each worker for a terminal `act:"done"` (success → release)
// or excessive idleness (reap). All teardown flows through teardownPty's
// safety-gate, so a worker's worktree is never auto-removed while it holds
// unintegrated work. Every terminal failure informs god WITH the Slack coords so
// god closes the Slack loop; the success path is the worker replying in-thread.

/** A spawn-request god drops into HIVE_ROOT/spawn-requests/<id>.json. god authors
 *  these directly; `objective` and `cwd` are the only required fields. */
interface SpawnRequest {
  id?: string;
  objective?: string;
  command?: string;                                   // engine CLI; default = config.defaultCommand
  provider?: AgentProvider;                           // optional explicit provider
  model?: string;                                     // optional --model override (Claude)
  cwd?: string;                                        // repo the worker (and its worktree) runs in
  name?: string;                                       // display name
  slack?: { channel: string; thread_ts: string };     // reply target + where failures surface
  isolate?: boolean;                                   // default true (fresh worktree)
  tokenCap?: number;                                   // optional per-worker token cap (advisory P1)
  // Appearance on the office floor. Both optional and both validated renderer-side
  // against the real cast and accent lists, so a bad value degrades to the default
  // rather than breaking the card.
  //
  // Naming a worker after a cast member ALREADY gets you their avatar: the floor
  // card infers it from the name. These two exist for the case that inference
  // cannot express, an agent called something else that should still look like a
  // particular character, and picking the accent instead of taking the one hashed
  // from the worker id.
  character?: string;
  accent?: string;
}

/** Polling cadence — matches the hive router. */
const WORKER_TICK_MS = 1500;
let workerWatchTimer: ReturnType<typeof setInterval> | null = null;
/** Re-entrancy guard so a slow tick (await spawn / git checks) never overlaps. */
let workerTickRunning = false;

/** HIVE_ROOT/spawn-requests — the queue dir god drops requests into. */
function spawnRequestsDir(): string | null {
  const root = hive.root();
  return root ? join(root, 'spawn-requests') : null;
}

/** Move a processed request out of the queue so it's never reprocessed. */
function archiveRequest(filePath: string, sub: '.done' | '.failed'): void {
  const queue = spawnRequestsDir();
  try {
    if (!queue) throw new Error('no hive root');
    const dir = join(queue, sub);
    mkdirSync(dir, { recursive: true });
    renameSync(filePath, join(dir, basename(filePath)));
  } catch (e) {
    // Last resort: delete it so a poison file can't loop forever.
    try { unlinkSync(filePath); } catch { /* noop */ }
    console.error('[worker] archiveRequest failed:', e);
  }
}

/** Did this worker post a terminal `act:"done"` yet? Scans its own outbox AND
 *  outbox/.sent (the router archives delivered mail there ~every 1.5s), so the
 *  signal is caught whether or not it's been routed out yet.
 *
 *  Stale-done guard: agent dirs persist after teardown, so REUSING a reqId would
 *  leave a PRIOR worker's `done` sitting in this same dir. Without a guard that
 *  stale signal would release the new worker on its very first tick — before it
 *  does anything or replies — causing a silent Slack hang. So we only count a
 *  `done` authored AFTER this worker spawned: by its `created_at` (the message's
 *  own timestamp), falling back to the file's mtime when `created_at` is missing
 *  or unparseable. When neither yields a usable timestamp we DON'T count it
 *  (fail toward keeping the worker alive — the idle reaper is the backstop). */
function workerSignaledDone(workerId: string, spawnedAt: number): boolean {
  const root = hive.root();
  if (!root) return false;
  const base = join(root, 'agents', workerId, 'outbox');
  for (const dir of [base, join(base, '.sent')]) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fp = join(dir, f);
      try {
        const msg = JSON.parse(readFileSync(fp, 'utf8')) as { act?: string; created_at?: string };
        if (msg.act !== 'done') continue;
        let ts = Date.parse(msg.created_at ?? '');
        if (!Number.isFinite(ts)) {
          try { ts = statSync(fp).mtimeMs; } catch { ts = NaN; }
        }
        if (Number.isFinite(ts) && ts > spawnedAt) return true;
      } catch { /* skip unreadable/partial */ }
    }
  }
  return false;
}

/** Spin up one ephemeral worker from a spawn-request. Terminal failures (bad
 *  request, missing CLI, spawn error) archive to .failed and inform god WITH the
 *  Slack coords so god can post a 'couldn't start' reply. On success the worker is
 *  registered (for done-scan / reaping / safe teardown) and dispatched its
 *  objective via the standard inbox path. */
async function processSpawnRequest(filePath: string): Promise<void> {
  let raw: SpawnRequest;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8')) as SpawnRequest;
  } catch (e) {
    console.error('[worker] unparseable spawn-request:', filePath, e);
    informGod('[worker spawn rejected] unparseable request', `Could not parse spawn-request ${basename(filePath)} — ${String(e)}`);
    archiveRequest(filePath, '.failed');
    return;
  }
  const slack = raw.slack && typeof raw.slack.channel === 'string' && typeof raw.slack.thread_ts === 'string'
    ? { channel: raw.slack.channel, thread_ts: raw.slack.thread_ts } : undefined;
  const fail = (reason: string): void => {
    informGod(`[worker spawn rejected] ${reason}`, `Spawn-request ${basename(filePath)} rejected: ${reason}.`, slack);
    archiveRequest(filePath, '.failed');
  };

  const objective = typeof raw.objective === 'string' ? raw.objective.trim() : '';
  if (!objective) { fail('missing "objective"'); return; }

  const reqId = (typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : basename(filePath).replace(/\.json$/i, ''))
    .replace(/[^A-Za-z0-9._-]/g, '-');
  const workerId = `worker-${reqId}`;
  if (liveWorkers.has(workerId)) { fail(`worker "${workerId}" already running`); return; }

  // Worker request files are hand/LLM-authored, so `~/…` shows up here too — expand
  // before the existence check (Node reads `~` literally).
  const cwd = typeof raw.cwd === 'string' && raw.cwd.trim() ? expandTilde(raw.cwd) : '';
  if (!cwd || !existsSync(cwd)) { fail(`"cwd" missing or not found (${cwd || 'unset'})`); return; }

  // Request line → executable + argv (auto-mode inheritance, tokenization,
  // model-flag dedupe). Pure and unit-tested — see workerLaunch.ts for why this
  // translation earned a test.
  const cfgSpawn = readConfig();
  const launch = buildWorkerLaunch({
    requestCommand: raw.command,
    requestProvider: raw.provider,
    requestModel: raw.model,
    defaultCommand: cfgSpawn.defaultCommand,
    autoMode: !!cfgSpawn.autoMode
  });
  const bin = launch.bin;
  // Validate the executable name on the spawn path. A spawn-request file is
  // untrusted input (authored by the orchestrator, reachable by anything that can
  // write HIVE_ROOT/spawn-requests), so the bin must be a plain command token or
  // an absolute path — never a string a downstream shell `which`/`where` could
  // reinterpret. Rejected here, before any resolution; the resolver guards behind
  // it validate the same thing in depth.
  if (!isSafeCommandName(bin) && !isAbsolute(bin)) {
    fail(`refusing spawn: engine command "${bin}" is not a plain command name or an absolute path`);
    return;
  }
  // Missing-CLI → FAIL FAST. A headless worker has no human to watch an installer,
  // so we never run the cc49e1e install banner here — we reject and tell god.
  if (!ptyManager.isCommandAvailable(bin)) { fail(`engine CLI "${bin}" is not installed`); return; }

  const isolate = raw.isolate !== false; // default true
  // Base branch the worktree will be cut from (for the ahead-of-base safety check).
  let baseBranch = 'main';
  try { const br = await getBranch(cwd); if ('current' in br && br.current) baseBranch = br.current; } catch { /* keep default */ }

  const meta: AgentMeta = {
    id: workerId,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Worker ${reqId.slice(0, 12)}`,
    provider: raw.provider,
    role: 'worker',
    cwd
  };
  // Phase 2: grant this worker a broker capability over the currently-enabled
  // integrations and inject the broker URL + a per-worker capability TOKEN (a handle,
  // never a secret) into its env, so it can reach registered REST integrations through
  // the loopback secret broker without ever seeing a credential. Only when the broker
  // is up; the grant is revoked in teardownPty (and below if the spawn fails).
  const brokerEnv: Record<string, string> = {};
  if (integrationBroker.running()) {
    const token = integrationBroker.grant(workerId, integrations.enabledIds());
    brokerEnv.MD_BROKER_URL = integrationBroker.url();
    brokerEnv.MD_BROKER_TOKEN = token;
  }
  const spawnOpts: AgentSpawnOptions = {
    id: workerId, cwd, command: bin, cols: 120, rows: 32,
    args: launch.args,
    hive: meta, isolate, provider: raw.provider, env: brokerEnv
  };

  let res: { ok: boolean; error?: string; worktreePath?: string };
  try {
    res = await spawnAgentCore(spawnOpts, liveWebContents());
  } catch (e) {
    res = { ok: false, error: String(e) };
  }
  if (!res.ok) { integrationBroker.revoke(workerId); fail(`spawn failed — ${res.error ?? 'unknown error'}`); return; }

  // A god-hired worker is a MAIN-initiated spawn, so the renderer would never
  // card it on its own (same reason as the voice-spawn broadcast): without this
  // the worker is invisible on the floor, never enters the roster, and after a
  // restart nothing offers to restore it. The card rides the normal agent
  // lifecycle from here — teardownPty broadcasts the matching archive. A card
  // RESTORED after an app quit revives through the renderer's normal spawn path
  // and never re-enters liveWorkers: ephemerality is a property of the hiring,
  // not of the card, so a restored worker is a regular agent (no reaping).
  try {
    liveWebContents()?.send('hive:agentSpawned', {
      id: workerId,
      name: meta.name,
      provider: raw.provider ?? 'claude',
      cwd: res.worktreePath ?? cwd,
      command: launch.command,
      role: meta.role,
      worktreePath: res.worktreePath,
      character: typeof raw.character === 'string' ? raw.character : undefined,
      accent: typeof raw.accent === 'string' ? raw.accent : undefined
    });
  } catch { /* window torn down */ }

  // Register for done-scan / idle-reap / token-cap / safe teardown (pty id == workerId).
  // tokenCap is optional plumbing (default unlimited) — only a positive finite cap is kept.
  const tokenCap = typeof raw.tokenCap === 'number' && Number.isFinite(raw.tokenCap) && raw.tokenCap > 0
    ? raw.tokenCap : undefined;
  liveWorkers.set(workerId, { workerId, reqId, name: meta.name, slack, baseBranch, spawnedAt: Date.now(), tokenCap });

  // Dispatch the objective via the standard inbox path (zero new transport),
  // reusing the autonomous-request preamble so the worker gets the exact Slack
  // reply command + autonomy policy. `from: god` so the worker treats it as a god
  // dispatch per its protocol.
  try {
    const prefix = slack
      ? buildAutonomousRequestProtocol(slack.channel, slack.thread_ts, slackReplyScriptPath())
      : '[AUTONOMOUS WORKER TASK — no interactive human is watching. Work autonomously; do not ask interactive questions.] The task starts now: ';
    const suffix = `\n\n[CAPABILITIES] Before you start, consult your capability catalog — run the \`/capabilities\` skill (or read \`$AGENT_DIR/.claude/skills/capabilities/SKILL.md\`). It lists your temporal date-range skills (\`/today\`, \`/last30Days\`, \`/lastQuarter\`, …) and the integrations available to you (reached via the loopback broker) and how to call each. For any time-scoped work, resolve the dates with those skills instead of computing them by hand.\n\n[WORKER COMPLETION] When finished, signal done by sending ONE outbox message to god with "act":"done" and a short result summary — that releases this ephemeral worker (terminal closed; your branch is handed to god). Do NOT push to any remote; god is the sole integrator.`;
    hive.send({ to: workerId, conversation: `worker-${reqId}`, act: 'request', subject: meta.name, body: `${prefix}${objective}${suffix}` }, 'god');
  } catch (e) {
    console.error('[worker] dispatch send failed:', e);
  }

  console.log(`[worker] spawned ${workerId} (cwd=${cwd}, base=${baseBranch}${slack ? ', slack' : ''})`);
  archiveRequest(filePath, '.done');
}

/** Total tokens (input+output+cache) a worker has burned so far, from the usage
 *  provider — 0 when unknown. Mirrors the breaker's `tokensOf`. Used only by the
 *  (default-off) per-worker token cap. */
function workerTokensUsed(workerId: string): number {
  const s = usageProvider.getAgentUsage(workerId);
  return s ? s.input + s.output + s.cacheRead + s.cacheCreation : 0;
}

/** Throttle for the GC sweep — git checks are cheap but pointless every 1.5s tick. */
const GC_SWEEP_MS = 60_000;
let lastGcSweepAt = 0;
let gcSweepRunning = false;

/** Reclaim preserved worker worktrees (+ their scratch dirs) whose work is now
 *  integrated, or whose worktree was already removed by hand. Fail-safe: a worktree
 *  is removed ONLY when `worktreeIsGcSafe` proves it clean AND integrated; any doubt
 *  KEEPS it (never discards un-integrated work — god is the sole integrator). Runs
 *  inside the worker tick, throttled to GC_SWEEP_MS, and is a no-op when nothing is
 *  preserved (the common case → zero cost). */
async function gcPreservedWorktrees(): Promise<void> {
  if (gcSweepRunning || preservedWorktrees.size === 0) return;
  gcSweepRunning = true;
  try {
    for (const [key, e] of [...preservedWorktrees]) {
      // A worker id that is live again (reqId reuse) → never GC its worktree or
      // scratch out from under the new run; leave the stale entry for a later sweep.
      if (liveWorkers.has(e.workerId)) continue;
      // (a) Worktree already gone (removed at clean teardown, or god removed it by
      //     hand per the preserve note) → just reclaim the scratch dir + drop tracking.
      if (!existsSync(e.wtPath)) {
        removeWorkerScratch(e.workerId);
        preservedWorktrees.delete(key);
        console.log(`[worker gc] ${e.workerId}: worktree already gone — reclaimed scratch`);
        continue;
      }
      // (b) Still on disk → reclaim ONLY when provably integrated + clean.
      const deps = await unlinkWorktreeDeps(e.origCwd, e.wtPath);
      if (!deps.ok) { console.error('[worker gc] dependency unlink failed (keeping):', deps.error); continue; }
      let safe: { gc: boolean; detail: string };
      try { safe = await worktreeIsGcSafe(e.wtPath, e.baseBranch); }
      catch (err) { console.error('[worker gc] gc-safe check threw (keeping):', err); continue; }
      if (!safe.gc) continue; // keep — fail-safe
      const r = await removeWorktree(e.origCwd, e.wtPath);
      if (!r.ok) { console.error(`[worker gc] removeWorktree failed (keeping ${e.workerId}):`, r.error); continue; }
      removeWorkerScratch(e.workerId);
      preservedWorktrees.delete(key);
      console.log(`[worker gc] reclaimed ${e.workerId} (${safe.detail})`);
      informGod(
        `[worker worktree reclaimed] ${e.workerId}`,
        `The preserved worktree for ${e.workerId} is now integrated (${safe.detail}), so it and its scratch dir were garbage-collected.\nWorktree: ${e.wtPath}`,
        e.slack
      );
    }
  } finally {
    gcSweepRunning = false;
  }
}

/** One controller tick: (1) finish/reap live workers (frees slots), then (2) pull
 *  new requests up to the concurrency cap. Order matters so a freed slot is reused
 *  the same tick. */
async function ephemeralWorkerTick(): Promise<void> {
  if (workerTickRunning) return;
  workerTickRunning = true;
  try {
    const cfg = readConfig();
    const maxWorkers = Math.max(1, cfg.maxConcurrentWorkers ?? 4);
    const idleTimeoutMs = Math.max(1, cfg.workerIdleTimeoutMinutes ?? 20) * 60_000;
    // Per-worker token cap. 0 = UNLIMITED (the default — wired but never throttles
    // unless a positive cap is set per-request or via defaultWorkerTokenCap).
    const defaultTokenCap = typeof cfg.defaultWorkerTokenCap === 'number' && cfg.defaultWorkerTokenCap > 0
      ? cfg.defaultWorkerTokenCap : 0;

    // (1) Finish or reap. Each release calls teardownPty EXPLICITLY after the
    //     kill, like every other kill site: ptyManager.kill() deletes the session
    //     synchronously, so when node-pty's async onExit later fires it fails the
    //     session-identity guard and the global exit handler (→ teardownPty)
    //     never runs. Relying on onExit here left released workers un-torn-down:
    //     no hive archive, no hive:agentArchived, frozen floor cards, and god
    //     kept mailing dead agents (seen live 2026-08-16 with worker-business/
    //     worker-qa/worker-bizreview). A double teardown is a harmless no-op.
    for (const [workerId, rec] of [...liveWorkers]) {
      if (rec.releasing) continue;
      if (workerSignaledDone(workerId, rec.spawnedAt)) {
        // Success: the worker already replied in-thread; just release it.
        rec.releasing = true;
        console.log(`[worker] ${workerId} signaled done — releasing`);
        ptyManager.kill(workerId);
        teardownPty(workerId);
        continue;
      }
      // Token-cap reap (default-off plumbing). An effective cap > 0 → reap when the
      // worker's cumulative token use exceeds it; its committed work is preserved.
      const tokenCap = (rec.tokenCap && rec.tokenCap > 0) ? rec.tokenCap : defaultTokenCap;
      if (tokenCap > 0) {
        const used = workerTokensUsed(workerId);
        if (used > tokenCap) {
          rec.releasing = true;
          console.warn(`[worker] reaping ${workerId} — token cap (${used.toLocaleString()} > ${tokenCap.toLocaleString()})`);
          informGod(
            `[worker reaped — token cap] ${workerId}`,
            `Worker ${workerId} used ${used.toLocaleString()} tokens (> its cap of ${tokenCap.toLocaleString()}) and was reaped. Any committed work on its branch is preserved for you.`,
            rec.slack
          );
          ptyManager.kill(workerId);
          teardownPty(workerId);
          continue;
        }
      }
      const idleMs = ptyManager.idleFor(workerId);
      if (idleMs === undefined) continue; // PTY already gone; teardownPty cleans up
      if (idleMs > idleTimeoutMs) {
        rec.releasing = true;
        console.warn(`[worker] reaping idle ${workerId} (${Math.round(idleMs / 60000)}min idle)`);
        informGod(
          `[worker reaped — idle] ${workerId}`,
          `Worker ${workerId} produced no output for ${Math.round(idleMs / 60000)} min (> the ${Math.round(idleTimeoutMs / 60000)} min cap) and never signaled done, so it was reaped. Any committed work on its branch is preserved for you.`,
          rec.slack
        );
        ptyManager.kill(workerId);
        teardownPty(workerId);
      }
    }

    // (2) Process new requests, honoring the concurrency cap (backpressure: leave
    //     the rest in the queue for a later tick).
    //
    //     Gated on config.orchestratorMaySpawn (default OFF): letting the
    //     orchestrator spin up agents unprompted is a SPEND decision, so the
    //     operator opts in. The gate sits HERE, on intake, and not on the watcher
    //     itself, because step (1) above owns the lifecycle of workers that are
    //     already running — reaping, teardown, the Slack failure notice — and
    //     turning the toggle off mid-flight must not strand them.
    //
    //     Declining also means declining to CONSUME. A request dropped in while
    //     this is off stays in the queue and runs when it is turned on, rather
    //     than being eaten and failed for a reason god never asked about.
    // ALLOW_TEMP_WORKERS (buildFeatures.ts) switches the whole route off in this
    // build, whatever an older config file says.
    const dir = ALLOW_TEMP_WORKERS && readConfig().orchestratorMaySpawn ? spawnRequestsDir() : null;
    if (dir && existsSync(dir)) {
      let files: string[] = [];
      try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { /* dir vanished */ }
      for (const f of files) {
        if (liveWorkers.size >= maxWorkers) break;
        await processSpawnRequest(join(dir, f));
      }
    }

    // (3) GC preserved worktrees whose work has since integrated. Throttled to
    //     GC_SWEEP_MS and a no-op when nothing is preserved (the common case).
    const now = Date.now();
    if (preservedWorktrees.size > 0 && now - lastGcSweepAt >= GC_SWEEP_MS) {
      lastGcSweepAt = now;
      await gcPreservedWorktrees();
    }
  } catch (e) {
    console.error('[worker] tick error:', e);
  } finally {
    workerTickRunning = false;
  }
}

function startEphemeralWorkerWatcher(): void {
  if (workerWatchTimer || !hive.enabled()) return;
  const dir = spawnRequestsDir();
  if (dir) { try { mkdirSync(dir, { recursive: true }); } catch { /* noop */ } }
  workerWatchTimer = setInterval(() => { void ephemeralWorkerTick(); }, WORKER_TICK_MS);
}

function stopEphemeralWorkerWatcher(): void {
  if (workerWatchTimer) { clearInterval(workerWatchTimer); workerWatchTimer = null; }
}

/** Snapshot of one live ephemeral worker for the renderer Workers tab. */
interface WorkerSnapshot {
  workerId: string;
  reqId: string;
  name: string;
  baseBranch: string;
  spawnedAt: number;
  ageMs: number;
  idleMs: number | null;        // null = PTY already gone
  tokensUsed: number;
  tokenCap: number | null;      // effective cap (per-request or config default); null = unlimited
  hasSlack: boolean;
  releasing: boolean;
  status: 'releasing' | 'working';
}
/** Snapshot of a preserved-but-not-yet-GC'd worktree for the tab. */
interface PreservedSnapshot {
  workerId: string;
  wtPath: string;
  baseBranch: string;
  preservedAt: number;
}

/** List live ephemeral workers (+ preserved worktrees awaiting GC) for the tab. */
ipcMain.handle('workers:list', (): { live: WorkerSnapshot[]; preserved: PreservedSnapshot[]; maxWorkers: number } => {
  const cfg = readConfig();
  const defaultCap = typeof cfg.defaultWorkerTokenCap === 'number' && cfg.defaultWorkerTokenCap > 0
    ? cfg.defaultWorkerTokenCap : 0;
  const now = Date.now();
  const live: WorkerSnapshot[] = [...liveWorkers.values()].map((rec) => {
    const idle = ptyManager.idleFor(rec.workerId);
    const effCap = (rec.tokenCap && rec.tokenCap > 0) ? rec.tokenCap : (defaultCap > 0 ? defaultCap : 0);
    return {
      workerId: rec.workerId,
      reqId: rec.reqId,
      name: rec.name ?? rec.workerId,
      baseBranch: rec.baseBranch,
      spawnedAt: rec.spawnedAt,
      ageMs: Math.max(0, now - rec.spawnedAt),
      idleMs: idle === undefined ? null : idle,
      tokensUsed: workerTokensUsed(rec.workerId),
      tokenCap: effCap > 0 ? effCap : null,
      hasSlack: !!rec.slack,
      releasing: !!rec.releasing,
      status: rec.releasing ? 'releasing' : 'working'
    };
  });
  const preserved: PreservedSnapshot[] = [...preservedWorktrees.values()].map((e) => ({
    workerId: e.workerId, wtPath: e.wtPath, baseBranch: e.baseBranch, preservedAt: e.preservedAt
  }));
  return { live, preserved, maxWorkers: Math.max(1, cfg.maxConcurrentWorkers ?? 4) };
});

/** Manually stop a live ephemeral worker. Mirrors the done-release path: mark
 *  releasing, then kill + teardownPty runs the SAFETY-GATED worktree teardown
 *  (committed work is preserved, never force-discarded). Idempotent. teardownPty
 *  is called explicitly (D10) rather than left to the PTY's natural exit: kill()
 *  frees the manager's id slot synchronously, so by the time the process's real
 *  exit arrives the exit-handler's stale-id guard already misreads it as a
 *  reclaimed id and skips teardown — the worker would stay "live" in registry.json
 *  and fleet.json forever after this call. */
ipcMain.handle('workers:stop', (_evt, workerId: string): { ok: boolean; error?: string } => {
  if (typeof workerId !== 'string' || !workerId) return { ok: false, error: 'invalid worker id' };
  const rec = liveWorkers.get(workerId);
  if (!rec) return { ok: false, error: 'no such live worker' };
  if (rec.releasing) return { ok: true }; // already stopping
  rec.releasing = true;
  console.log(`[worker] manual stop requested for ${workerId}`);
  try { ptyManager.kill(workerId); } catch (e) { return { ok: false, error: String(e) }; }
  teardownPty(workerId);
  return { ok: true };
});

/** Start every hive-bound background service against the current harnessHome.
 *  Called on boot, and again to recover in place if a folder-change copy fails
 *  (config:changeHome tears these down before copying). No-op without a home. */
function bootstrapHiveServices(): void {
  if (!hive.enabled()) return;
  // A business office gets the plain PROTOCOL.md and no COMMANDS.md.
  hive.setBusinessOffice(!!(readConfig().businessFolder || readConfig().officeFolder));
  hive.onScheduleRequest(receiveScheduleRequest);
  hive.ensureHive();
  try { sweepOrphanAgentMcp(); } catch (e) { console.error('[mail] orphan agent-mcp sweep failed', e); }
  // Read the Claude account's connectors in the background (D11).
  void refreshClaudeConnectors('start');
  // Waiting schedule requests reach Michael, and ones he leaves undecided
  // reach the owner (sweepScheduleRequests).
  try { sweepScheduleRequests(); } catch (e) { console.error('[schedules] request sweep failed', e); }
  // Can send puts nothing on Ask me: cards filed before that rule go back to
  // their member with a notice that replaces an old note to propose.
  try {
    const cfg = readConfig();
    // Only where the member can send now: a paused grant keeps its cards on Ask me.
    mailApprovals.handBackCanSend((agentId, mailbox) => (memberPresent(agentId) && sendingFor(cfg, agentId, mailbox) === 'send' && mailAccess(cfg, agentId, mailbox, 'send', undefined, { present: memberPresent }).ok ? mailboxAddress(cfg, mailbox) : null));
  } catch (e) { console.error('[mail] Can send hand back failed', e); }
  if (scheduleSweepTimer) clearInterval(scheduleSweepTimer);
  scheduleSweepTimer = setInterval(() => {
    try { sweepScheduleRequests(); } catch (e) { console.error('[schedules] request sweep failed', e); }
    // Approved emails not sent within the hour go to Michael (send-on-approval.md).
    try { mailApprovals.sweep(); } catch (e) { console.error('[mail] approval sweep failed', e); }
  }, 30 * 60 * 1000);
  // Tell the hive what it is running inside, BEFORE anything spawns: the prompt
  // builder reads this, so an agent spawned earlier would never learn it.
  hive.setRuntimeInfo({ version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath() });
  hive.setOrchestratorMaySpawn(readConfig().orchestratorMaySpawn === true);
  // An app-start marker in the event log. log.jsonl had twelve event kinds and
  // none of them meant "the app restarted", so a relaunch, and more importantly a
  // switch between a packaged build and a local one, was invisible to every agent
  // reading the feed. That gap cost a multi-hour investigation whose answer was
  // exactly this: a local build inherits the launching shell's umask, a
  // Finder-launched app does not.
  hive.appendLog({
    kind: 'app-start',
    version: app.getVersion(),
    packaged: app.isPackaged,
    // WHICH bundle, not just which version. Version plus packaged is not enough
    // to tell two builds apart: a stale copy in /Applications and a fresh one in
    // dist/ can report the same version and both be packaged, and picking the
    // wrong one by habit looks exactly like the new build being broken. Cost us
    // twice before this line existed.
    appPath: app.getAppPath(),
    exePath: process.execPath,
    electron: process.versions.electron,
    platform: process.platform
  });
  // While the Auto / Pause switch is hidden (buildFeatures.ts), a pause saved
  // before it was hidden is cleared rather than restored: otherwise those
  // agents' queued messages would be held with no switch to release them.
  if (SHOW_DELIVERY_SWITCH) {
    control.replaceAutoDeliveryPauses(readConfig().autoDeliveryPausedAgents ?? []);
  } else if ((readConfig().autoDeliveryPausedAgents ?? []).length > 0) {
    writeConfig({ autoDeliveryPausedAgents: [] });
  }
  archiveOrphanedAgents(); // #57/#58: archive stale archived:false entries with no live PTY
  hive.startRouter();
  startEphemeralWorkerWatcher(); // poll HIVE_ROOT/spawn-requests → ephemeral workers
  // Phase 2: the loopback secret broker. Bind it BEFORE workers spawn so each spawn can
  // be granted a capability token + the broker URL in its env. Loopback-only, idempotent.
  void integrationBroker.start().then((r) => {
    if (r.ok) console.log('[broker] integration broker listening on', integrationBroker.url());
    else console.error('[broker] failed to start:', r.error);
  });
  migrateBusinessFolder(); // one-time: Michael's folder from the retired Office folder
  ensureDefaultMissions(); // one-time: seed the built-in hourly ops standup
  migrateMissionOwners(); // one-time: everyone rows to Michael, createdBy stamped
  syncMissions(); // arm recurring auto-dispatch missions now the router is live
  syncContextTriggers(); // …and the context trigger's own compact/clear cadences
  // Pair replies to inbound webhook messages in the ledger. Tied to the FEATURE
  // (any endpoint configured), not to the server: an approved message's card can
  // finish long after the operator switched the public surface back off, and its
  // reply still belongs in the history.
  if ((readConfig().webhookTriggers ?? []).length > 0) startWebhookDoneObserver();
  hookServer.start();
  // Bind the telemetry collector BEFORE the renderer spawns any agent, then point
  // the hive at it so every subsequent spawn is instrumented. Best-effort — a bind
  // failure just leaves telemetry off (transcript reconciler stays). No breaker.start():
  // the breaker is POLICY-only, ticked by the heartbeat beat (#1, ships disabled).
  void telemetry.start().then((r) => {
    if (r.ok && r.endpoint) { hive.setOtelEndpoint(r.endpoint); console.log('[telemetry] collector listening', r.endpoint); }
    else console.error('[telemetry] collector failed to start:', r.error);
  });
  memory.start(); // init shared palace + mine loop (no-op without mempalace)
  memoryTidy.start(); // tidy agents' memory notes into their index in the background

  armAlwaysOnBeats();
}

/** Cadence of the worker inbox-wake watchdog (#151). Well under the renderer's
 *  own nudge cooldown so a throttled window is caught within ~15s of a stall. */
const WORKER_WAKE_POLL_MS = 15_000;
let workerWakeTimer: ReturnType<typeof setInterval> | null = null;
let safeClearTimer: ReturnType<typeof setInterval> | null = null;

/** Type text into a terminal and submit it: text first, Enter a tick later (a
 *  single-chunk write would land the "\r" inside the input box). */
function typeIntoPty(ptyId: string, text: string): void {
  const wrote = ptyManager.write(ptyId, text);
  if (!wrote.ok) { console.warn(`[type] write failed for ${ptyId}: ${wrote.error}`); return; }
  setTimeout(() => { try { ptyManager.write(ptyId, '\r'); } catch (e) { console.error('[type] submit threw:', e); } }, 140);
}

/** Clears a team member's conversation only when worth it and safe, after a
 *  handoff, and undoably (safeClearer.ts, src/shared/safeClear.ts). Michael is
 *  never a candidate. */
const safeClearer = new SafeClearer({
  agents: () => {
    if (!hive.enabled()) return [];
    const reg = hive.registry();
    const out: ReturnType<SafeClearDeps['agents']> = [];
    for (const [id, a] of Object.entries(reg.agents ?? {})) {
      if (a?.archived) continue;
      const ptyId = ptyForAgent(id);
      if (!ptyId) continue;
      const snap = control.snapshot(id);
      // A conversation size recorded before the last clear is stale: the new
      // conversation hasn't reported its size yet.
      const ctx = hookServer.contextFor(id);
      const cleared = hive.clearedState(id);
      const tokens = ctx && (!cleared || ctx.ts > cleared.at) ? ctx.tokens : 0;
      out.push({
        id,
        ptyId,
        lastOutputAt: ptyManager.lastOutputAt(ptyId) ?? 0,
        facts: {
          isGod: id === reg.godId || !!a.isGod,
          isAssistant: !!a.isAssistant,
          isClaude: isClaudeProvider(a.provider ?? 'claude'),
          held: !!a.onHold,
          paused: snap.paused || snap.halted || snap.autoDeliveryPaused,
          contextTokens: tokens,
          openCards: hive.openCardsFor(id),
          inbox: hive.inbox(id).length,
          awaitingReplies: hive.awaitingReplies(id),
          openQuestions: hive.openQuestionsRaisedBy(id)
        }
      });
    }
    return out;
  },
  handoffPath: (id) => hive.handoffPath(id),
  memoryInboxPath: (id) => join(hive.root() ?? '', 'agents', id, 'memory', 'inbox.md'),
  lastSession: (id) => hive.lastSession(id),
  recordClear: (id, state) => hive.recordClear(id, state),
  type: typeIntoPty,
  log: (event) => { try { hive.appendLog(event); } catch { /* best-effort */ } }
});

/** Type the renderer's guarded nudge into one worker's PTY — text first, Enter a
 *  tick later (the exact submitToPty pattern: a single-chunk write would land the
 *  "\r" inside the input box and never submit). Best-effort + never throws. */
function nudgeWorker(ptyId: string, ids: string[] = []): void {
  // Same text the renderer queues (#187's inboxNudgeText), so the two wake paths
  // produce byte-identical nudges: the queue's one-pending rule recognises either
  // via isInboxNudge, and a watchdog nudge names its ids so the agent can still
  // tell "I filed this last turn" from "woken for nothing".
  const typedAt = Date.now();
  const wrote = ptyManager.write(ptyId, inboxNudgeText(ids));
  if (!wrote.ok) { console.warn(`[worker-wake] write failed for ${ptyId}: ${wrote.error}`); return; }
  setTimeout(() => {
    try {
      const submitted = ptyManager.write(ptyId, '\r');
      if (!submitted.ok) { console.warn(`[worker-wake] submit failed for ${ptyId}: ${submitted.error}`); return; }
      // A Claude agent says when it accepts a prompt: press Enter again if a
      // slow terminal took the first one as part of the text.
      const agentId = ptyToAgent.get(ptyId);
      const provider = agentId ? hive.registry().agents?.[agentId]?.provider : undefined;
      if (agentId && isClaudeProvider((provider ?? 'claude') as AgentProvider)) {
        // An extra Enter only while nothing else happened in that terminal:
        // nobody typed there and the agent asked for nothing (a permission
        // prompt or menu would take the Enter as a choice).
        let ours = ptyManager.writeCount(ptyId);
        void confirmSubmit({
          accepted: () => promptSubmits.since(agentId, typedAt),
          pressEnter: () => { const r = ptyManager.write(ptyId, '\r'); ours = ptyManager.writeCount(ptyId); return r; },
          stillSafe: () => ptyManager.writeCount(ptyId) === ours && !promptSubmits.attentionSince(agentId, typedAt)
        })
          .then((ok) => { if (!ok) console.warn(`[worker-wake] ${agentId} did not accept the nudge after retries`); });
      }
    } catch (e) { console.error('[worker-wake] submit threw:', e); }
  }, 140);
}

/** Main-process inbox-wake beat (issue #151, fix A): the renderer's idle nudge
 *  (useHive.ts) is the only path that wakes a worker parked on an undrained
 *  inbox — and it lives on a setInterval in the renderer, which a throttled or
 *  occluded window stops honoring. This beat is the renderer-INDEPENDENT fallback:
 *  it gathers live-worker facts (PTY quiescence, inbox depth, control flags) and
 *  lets WorkerWakeWatchdog.decide apply the exact renderer guards (idle-only,
 *  post-boot-grace, not paused/halted, no pending HITL, cooldown), then types the
 *  same nudge the renderer would have. God is never a candidate (its heartbeat
 *  path already re-engages it). */
function runWorkerWakeBeat(): void {
  if (!hive.enabled()) return;
  const reg = hive.registry();
  if (!reg?.agents || !reg.godId) return;
  const now = Date.now();
  const facts: WorkerWakeFacts[] = [];
  for (const [agentId, a] of Object.entries(reg.agents)) {
    if (agentId === reg.godId || a?.archived) continue;
    // Nothing types into a terminal the usage limit has stopped (issue 124).
    if (heldByBreak(officeBreak.view(), a?.provider)) continue;
    const ptyId = ptyForAgent(agentId);
    if (!ptyId) continue;
    const snap = control.snapshot(agentId);
    facts.push({
      agentId,
      isGod: agentId === reg.godId,
      ptyId,
      lastOutputAt: ptyManager.lastOutputAt(ptyId) ?? 0,
      inboxIds: hive.inbox(agentId).map((message) => message.id).filter(Boolean),
      autoDeliveryPaused: snap.autoDeliveryPaused,
      paused: snap.paused,
      halted: snap.halted
    });
  }
  for (const agentId of workerWake.decide(facts, now)) {
    const ptyId = ptyForAgent(agentId);
    if (!ptyId) continue;
    // Re-read at delivery time, not from the facts snapshot: the agent may have
    // drained the mail during the beat, and a nudge naming ids it already filed
    // is the exact staleness #187 exists to stop.
    const ids = hive.inbox(agentId).map((m) => m.id).filter(Boolean);
    if (!ids.length) { console.log(`[worker-wake] ${agentId} drained before delivery, skipping`); continue; }
    console.log(`[worker-wake] nudging ${agentId} on ${ptyId} (${ids.length} pending)`);
    nudgeWorker(ptyId, ids);
  }
}

/** (Re)arm the always-on beats (decoupled from the optional heartbeat): the live
 *  fleet snapshot Michael reads (~8s) + the breaker/cost-ledger beat (~30s).
 *  Guarded (clear-then-set) so a re-bootstrap (changeHome recovery) OR a
 *  powerMonitor resume can't stack duplicate timers — these are setInterval
 *  handles that freeze during true system sleep and must be re-armed on wake. */
function armAlwaysOnBeats(): void {
  if (fleetTimer) clearInterval(fleetTimer);
  // Michael's open requests from the owner ride the fleet tick
  // (docs/designs/card-lifecycle.md), so a prompt never scans his mail.
  const fleetBeat = (): void => {
    writeFleetSnapshot();
    try { if (hive.enabled()) hive.refreshOwnerRequests(); } catch (e) { console.error('[owner requests]', e); }
  };
  fleetBeat();
  fleetTimer = setInterval(fleetBeat, 8_000);
  if (breakerBeatTimer) clearInterval(breakerBeatTimer);
  breakerBeatTimer = setInterval(() => { try { runBreakerBeat(300_000); } catch (e) { console.error('[breaker beat]', e); } }, 30_000);
  if (workerWakeTimer) clearInterval(workerWakeTimer);
  workerWakeTimer = setInterval(() => { try { runWorkerWakeBeat(); } catch (e) { console.error('[worker-wake beat]', e); } }, WORKER_WAKE_POLL_MS);
  if (safeClearTimer) clearInterval(safeClearTimer);
  safeClearTimer = setInterval(() => { try { safeClearer.beat(); } catch (e) { console.error('[safe-clear beat]', e); } }, 60_000);
  runWorkerWakeBeat(); // catch-up on arm — power-resume re-arms and drains the backlog
  // A break's timer freezes in system sleep like the beats above.
  armOfficeBreak();
}

/** Wall-clock instant we last observed the machine suspend or lock, so a resume
 *  can report how long we were out. Best-effort context for the renderer follow-on
 *  (auto-revive); null until the first suspend/lock of the session. */
let lastSuspendAt: number | null = null;
/** Single pending post-resume PTY health check, so overlapping resume+unlock
 *  events collapse to ONE check (the latest) instead of stacking. */
let resumeHealthTimer: NodeJS.Timeout | null = null;

/** After the machine wakes, probe each live PTY for liveness and surface any that
 *  didn't survive. macOS can wedge a child `claude` process/socket across a long
 *  sleep while node-pty still holds the fd (its exit event never fired) — so a
 *  dead PTY can linger in our list. `process.kill(pid, 0)` is a pure existence
 *  probe (signal 0 never touches the process); ESRCH means the process is gone.
 *  We only LOG + NOTIFY here (no auto-kill/respawn — true revive is renderer-owned
 *  via pty:spawn) and emit `power:resume` as the integration point for the
 *  follow-on renderer auto-revive card. */
function healthCheckPtys(reason: string, awayMs: number | null): void {
  const ptys = ptyManager.list();
  const dead: string[] = [];
  for (const p of ptys) {
    if (typeof p.pid === 'number' && p.pid > 0) {
      try { process.kill(p.pid, 0); }   // liveness probe only — never kills
      catch { dead.push(p.id); }        // ESRCH: process gone but PTY still registered
    }
  }
  const away = awayMs != null ? ` (away ~${Math.round(awayMs / 1000)}s)` : '';
  if (dead.length) {
    console.warn(`[power] ${reason}${away}: ${dead.length}/${ptys.length} PTY(s) look wedged (process gone):`, dead.join(', '));
    ownerToast('Agents need a restart', `${dead.length} agent terminal(s) didn't survive sleep. Open them again to resume.`);
  } else {
    console.log(`[power] ${reason}${away}: ${ptys.length} PTY(s) healthy`);
  }
  // Single integration point for the (separate) renderer auto-revive card: it can
  // listen for 'power:resume' and respawn the `dead` PTYs with --resume.
  try { liveWebContents()?.send('power:resume', { reason, awayMs, dead, total: ptys.length }); } catch { /* window gone */ }
}

/** Re-arm everything that runs on a frozen libuv timer after the machine slept,
 *  and surface any PTY that didn't survive. macOS pauses setTimeout/setInterval
 *  during true system sleep (the monotonic clock halts) — on wake they resume
 *  where they paused, shifted by the whole sleep, so missions due during sleep
 *  never fired and never replay. We rebuild the scheduler (syncMissions reuses its
 *  remaining=max(0,…) semantics → each overdue mission fires exactly ONCE then
 *  re-settles, never N replays), re-arm the always-on beats, re-evaluate the
 *  power blocker, then — after a short grace for PTYs to wake their pipes —
 *  health-check the terminals. Idempotent: overlapping resume+unlock events
 *  collapse safely (clear-then-arm everywhere; at most one catch-up fire). */
function onSystemResume(reason: string): void {
  console.log(`[power] ${reason} — re-arming scheduler, beats, router, keep-awake`);
  try { syncMissions(); } catch (e) { console.error('[power] syncMissions on resume', e); }
  // Same freeze, same catch-up: the context timers honour elapsed-time-since-last-
  // run, so a compact/clear that came due while the machine slept fires ONCE here
  // rather than being lost or replayed N times.
  try { syncContextTriggers(); } catch (e) { console.error('[power] syncContextTriggers on resume', e); }
  try { armAlwaysOnBeats(); } catch (e) { console.error('[power] armAlwaysOnBeats on resume', e); }
  // The hive message router (outbox→inbox drain) is a setInterval that freezes
  // during true system sleep exactly like the beats above — but it was the one
  // always-on timer never re-armed on wake. Symptom: after a long sleep the
  // scheduler→god path recovered (it injects straight into god's inbox), while
  // every agent's outbox silently stopped draining, so god→worker and
  // worker↔worker mail piled up undelivered. Re-arm the poll loop (clear-then-set,
  // idempotent) and immediately drain the backlog that accrued while we were out
  // instead of waiting for the first post-wake tick. The renderer's idle inbox-wake
  // nudge (useHive.ts) then wakes each parked recipient once its mail lands.
  try {
    hive.stopRouter();
    hive.startRouter();
    const drained = hive.routeOnce();
    if (drained > 0) console.log(`[power] ${reason} — flushed ${drained} queued hive message(s)`);
  } catch (e) { console.error('[power] router re-arm on resume', e); }
  try { syncKeepAwake(); } catch (e) { console.error('[power] syncKeepAwake on resume', e); }
  const awayMs = lastSuspendAt != null ? Date.now() - lastSuspendAt : null;
  // Give PTYs a beat to resume their pipes before judging them wedged; reset any
  // pending check so a resume quickly followed by unlock runs the probe just once.
  if (resumeHealthTimer) clearTimeout(resumeHealthTimer);
  resumeHealthTimer = setTimeout(() => {
    resumeHealthTimer = null;
    healthCheckPtys(reason, awayMs);
  }, 15_000);
}

app.whenReady().then(() => {
  // Realtime Michael mic-gate hygiene (rt-8 / Pam rt-10 nit): the voice session
  // opens the mic permission gate by persisting realtimeVoiceEnabled=true and
  // closes it on disconnect — but a hard crash/reload mid-session skips that
  // teardown, leaving the flag stuck true so the gate would boot PRE-OPEN with no
  // live session. Force it closed at startup (a real session re-opens it via
  // setMicGate(true)); macOS TCC stays a second gate regardless.
  if (readConfig().realtimeVoiceEnabled) writeConfig({ realtimeVoiceEnabled: false });

  // Anonymous product analytics (PostHog) — the full contract lives in
  // TELEMETRY.md. Off entirely while COLLECT_USAGE_STATS (buildFeatures.ts) is
  // false. Otherwise a no-op unless a build-time key was injected (official
  // releases only), and gated on DO_NOT_TRACK + the telemetryEnabled config.
  analytics.init({
    stateDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    enabled: COLLECT_USAGE_STATS && readConfig().telemetryEnabled !== false
  });

  // Warm the model catalog cache before any picker opens. The renderer reads
  // the same cache over IPC on load; doing the network hop here means the file
  // is already fresh on disk by the time a modal is opened, and a failure is
  // silent by construction (the baked catalog is the floor).
  void loadModelCatalog(MODEL_CATALOG_CACHE()).catch(() => { /* never fatal */ });

  // A cold-start deep link (Windows/Linux) rides in on OUR argv.
  const startupHireLink = process.argv.find((a) => a.startsWith(`${APP_URL_SCHEME}://`));
  if (startupHireLink) void handleHireLink(startupHireLink);

  // Hand every spawned agent the path to the Slack reply discovery file via the
  // inherited env (pty merges process.env). The path is stable whether or not the
  // server is running; the FILE only exists while it is, so the helper degrades
  // to "endpoint not running" cleanly. NO secret is in the env — only the path.
  process.env.MD_SLACK_REPLY_CONFIG = slackReplyConfigPath();
  // Open the durable store first — createWindow() reads the saved window bounds.
  // Guarded: a DB failure (e.g. a bad native build) must degrade to defaults,
  // never block app startup.
  try { persist.open(); } catch (e) { console.error('[db] open failed:', e); }
  // A break saved before quitting is still on (issue 124).
  armOfficeBreak();
  // Auto-update from GitHub releases (installed builds only; always on since
  // 2026-10-02). Download-in-background + restart-to-apply toast;
  // never restarts on its own. Falls back to a notify-only releases/latest
  // check where native updating isn't possible (win-portable, dev-ish builds).
  initAutoUpdater(() => liveWebContents());
  // Bootstrap the hive (if harnessHome is configured) and start the message router,
  // but only when the office is really there. If the owner moved or deleted the
  // folder, bootstrapping would quietly rebuild an EMPTY office at the old path;
  // instead nothing touches it and the renderer asks where it went (homeFolder.ts).
  const homeReady = homeReadyAtLaunch(readConfig());
  if (homeReady) {
    bootstrapHiveServices();
    // An office set up before office.json existed gets one now, if the config's
    // team is really this office's team (officeFile.ts).
    backfillOfficeRecord(readConfig());
  }
  else console.warn('[home] office folder missing, waiting for the owner:', readConfig().harnessHome);
  // Survive sleep/lock. macOS freezes libuv timers during true system sleep, so a
  // locked/idle/slept Mac stops firing schedules and can wedge PTYs. On wake we
  // re-arm the scheduler (catching up missed missions ONCE) + beats + keep-awake,
  // then health-check terminals. App-lifetime listeners — powerMonitor outlives
  // every window, so there is nothing to tear down on quit.
  powerMonitor.on('resume', () => onSystemResume('resume'));
  powerMonitor.on('unlock-screen', () => onSystemResume('unlock-screen'));
  powerMonitor.on('suspend', () => { lastSuspendAt = Date.now(); console.log('[power] suspend — system sleeping'); });
  powerMonitor.on('lock-screen', () => { lastSuspendAt = Date.now(); console.log('[power] lock-screen'); });
  // The app's own menu, always: Electron's default carries Reload and the
  // developer tools, which are not for an office owner (owner, 2026-10-03).
  installAppMenu();
  createWindow();
  // Auto-start the Slack webhook server when configured. Best-effort: a tunnel
  // failure (offline) is logged, not fatal. The tunnel URL is ephemeral and
  // changes per restart, so the user re-pastes it via Settings → Start.
  const slackCfg = readConfig();
  // Slack and webhooks hand work to the hive, so they wait for the office too.
  if (homeReady && slackCfg.slackEnabled && slackCfg.slackSigningSecret) {
    void startSlackServer().then((r) => {
      if (!r.ok) console.error('[slack] auto-start failed:', r.error);
      else console.log('[slack] webhook listening', r.url ? `(tunnel: ${r.url})` : '(no tunnel)');
    });
  }
  // Auto-start the generic webhook only for endpoints the user has explicitly
  // enabled (each with its own secret) — never a default-on public surface.
  // Opt-in, like Slack; an install with no enabled endpoint opens no tunnel.
  if (homeReady && enabledWebhookEndpoints().length > 0) {
    void startWebhookServer().then((r) => {
      if (!r.ok) console.error('[webhook] auto-start failed:', r.error);
      else console.log('[webhook] listening', r.url ? `(tunnel: ${r.url})` : '(no tunnel)');
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// before-quit covers Cmd-Q / dock-quit; the per-window close handler covers
// the red close button. Both routes hit the same warning UX.
app.on('before-quit', (e) => {
  if (allowQuit) return;
  const count = ptyManager.list().length;
  if (count === 0) return;
  e.preventDefault();
  if (mainWindow) {
    mainWindow.focus();
    mainWindow.webContents.send('app:closeRequested', { ptyCount: count });
  }
});

// Every window loads the config once at start-up, so tell them all when a
// setting is saved — a floor left out would keep showing what it opened with.
onConfigWritten((config) => {
  for (const w of allWindows) {
    if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
    w.webContents.send('config:changed', config);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Full teardown, not a bare killAll: this path must also stop the proxy
    // sidecars and helper servers — on Windows a child is NOT killed when its
    // parent exits, so anything skipped here outlives the app.
    teardownAndQuit();
  }
});

// Final analytics flush (session_ended + drain the send queue), bounded so a
// hung network can never wedge quit: preventDefault ONCE, race the flush
// against a short timeout, then exit hard.
//
// finish MUST be app.exit(), not a re-entrant app.quit(): when the quit was
// initiated while a window was still open (the "kill all & quit" confirm path
// calls teardownAndQuit → app.quit() and the window closes DURING that quit),
// Electron is left with its internal is-quitting state set after this
// preventDefault, and the later app.quit() is silently a no-op — no before-quit,
// no will-quit, no quit; the main process idles forever with zero windows. On
// Windows that stranded the whole Electron process group (main + GPU + network
// service) after every agents-running quit. By this point teardown has already
// run and the flush has finished or timed out, so an unconditional exit is
// exactly what's left to do.
let analyticsFlushed = false;
app.on('will-quit', (e) => {
  if (analyticsFlushed) return;
  analyticsFlushed = true;
  e.preventDefault();
  const finish = (): void => app.exit(0);
  Promise.race([
    analytics.endSession(),
    new Promise<void>((r) => setTimeout(r, 1200))
  ]).then(finish, finish);
});
