import * as vscode from "vscode";
import * as os from "os";
import { canonicalKey } from "./pathCanonical";

const SECTION = "claudeConductor";

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function getClaudeCommand(): string {
  return getConfig().get<string>("claudeCommand", "claude");
}

export function getReuseTerminal(): boolean {
  return getConfig().get<boolean>("reuseExistingTerminal", true);
}

export function getEnableNotifications(): boolean {
  return getConfig().get<boolean>("enableNotifications", true);
}

export function getExtraFolders(): string[] {
  return getConfig()
    .get<string[]>("extraFolders", [])
    .map((f) => f.replace(/^~/, os.homedir()));
}

export async function removeExtraFolder(folderPath: string): Promise<void> {
  const config = getConfig();
  const current = config.get<string[]>("extraFolders", []);
  const targetKey = canonicalKey(folderPath);
  const filtered = current.filter((folder) => {
    const expanded = folder.replace(/^~/, os.homedir());
    return canonicalKey(expanded) !== targetKey;
  });

  if (filtered.length === current.length) {
    return;
  }

  await config.update(
    "extraFolders",
    filtered,
    vscode.ConfigurationTarget.Global
  );
}

export function getFolderAliases(): Record<string, string> {
  return getConfig().get<Record<string, string>>("folderAliases", {});
}

export function getFolderAlias(folderPath: string): string | undefined {
  return getFolderAliases()[canonicalKey(folderPath)];
}

export async function setFolderAlias(
  folderPath: string,
  alias: string
): Promise<void> {
  const config = getConfig();
  const aliases = {
    ...config.get<Record<string, string>>("folderAliases", {}),
    [canonicalKey(folderPath)]: alias,
  };
  await config.update(
    "folderAliases",
    aliases,
    vscode.ConfigurationTarget.Global
  );
}

export async function removeFolderAlias(folderPath: string): Promise<void> {
  const config = getConfig();
  const aliases = { ...config.get<Record<string, string>>("folderAliases", {}) };
  delete aliases[canonicalKey(folderPath)];
  await config.update(
    "folderAliases",
    aliases,
    vscode.ConfigurationTarget.Global
  );
}

export function getLaunchDelayMs(): number {
  const raw = getConfig().get<number>("launchDelayMs", 500);
  return Math.max(0, raw);
}

export function getDebugLogging(): boolean {
  return getConfig().get<boolean>("debugLogging", false);
}
