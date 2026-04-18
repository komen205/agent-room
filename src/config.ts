import { readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import * as YAML from 'yaml';

export type RoleKind = 'executor' | 'reviewer' | 'scout';

export type Role = {
  name: string;
  kind: RoleKind;
  cwd: string;
  nextSpeaker: string; // peer name, "sender", or any external clientId (e.g. "operator")
  system: string;
  opener: string | null;
  /**
   * Optional extra rooms to SUBSCRIBE to (read-only). The agent's own messages
   * are always published to its primary `room`. Use this for observer / bridge
   * roles that watch one room and report in another.
   */
  readRooms: string[];
};

export type LoadedConfig = {
  room: string;
  roles: Record<string, Role>;
};

type RawRole = {
  kind: RoleKind;
  cwd: string;
  nextSpeaker: string;
  systemPromptFile: string;
  openerPromptFile?: string;
  readRooms?: string[];
};

type RawConfig = {
  room?: string;
  agents: Record<string, RawRole>;
};

export function loadConfig(configPath: string): LoadedConfig {
  const absPath = resolve(configPath);
  const raw = readFileSync(absPath, 'utf8');
  const cfg = YAML.parse(raw) as RawConfig;
  if (!cfg?.agents || typeof cfg.agents !== 'object') {
    throw new Error(`Invalid config at ${absPath}: missing 'agents' map`);
  }

  const configDir = dirname(absPath);
  const peerNames = Object.keys(cfg.agents);
  const roles: Record<string, Role> = {};

  for (const [name, rawRole] of Object.entries(cfg.agents)) {
    if (!rawRole.kind || !['executor', 'reviewer', 'scout'].includes(rawRole.kind)) {
      throw new Error(`Role '${name}' has invalid kind: ${rawRole.kind}. Expected executor | reviewer | scout.`);
    }
    if (!rawRole.nextSpeaker) {
      throw new Error(`Role '${name}' missing required field: nextSpeaker`);
    }
    // nextSpeaker is 'sender' (reply-to), a known peer name, or any string
    // representing a client that isn't configured here (e.g. "operator" for the
    // chat.ts / notify.ts script). We don't validate unknown names — if nobody
    // responds, that's visible in the log and easy to debug.
    if (rawRole.nextSpeaker !== 'sender' && !peerNames.includes(rawRole.nextSpeaker)) {
      // No-op: allow arbitrary addressees like "operator".
    }

    const peers = peerNames.filter((p) => p !== name);
    const vars: Record<string, string> = {
      name,
      peers: peers.join(', '),
      cwd: rawRole.cwd,
    };

    const system = renderTemplate(readPromptFile(rawRole.systemPromptFile, configDir), vars);
    const opener = rawRole.openerPromptFile
      ? renderTemplate(readPromptFile(rawRole.openerPromptFile, configDir), vars)
      : null;

    roles[name] = {
      name,
      kind: rawRole.kind,
      cwd: rawRole.cwd,
      nextSpeaker: rawRole.nextSpeaker,
      system,
      opener,
      readRooms: rawRole.readRooms ?? [],
    };
  }

  return {
    room: cfg.room ?? 'agent-room',
    roles,
  };
}

function readPromptFile(filePath: string, baseDir: string): string {
  const abs = isAbsolute(filePath) ? filePath : join(baseDir, filePath);
  return readFileSync(abs, 'utf8');
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (key in vars ? vars[key] : `{{${key}}}`));
}
