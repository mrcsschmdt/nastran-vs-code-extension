/**
 * Opt-in blue hover highlight for themes whose hover highlight is a neutral
 * gray that blends with the field shading (VS Code's 2026 default themes).
 *
 * The hover highlight is the theme color `editor.hoverHighlightBackground`,
 * which extensions cannot restyle per language. These commands write (or
 * remove) a theme-scoped `workbench.colorCustomizations` entry in the user's
 * settings, only when the user asks for it.
 */
import * as vscode from 'vscode';

const KEY = 'editor.hoverHighlightBackground';

/** Themes known to use a neutral (gray) hover highlight. */
export const NEUTRAL_HOVER_THEMES = new Set(['Dark 2026', 'Light 2026']);

/** Blue hover color per theme kind. */
export function blueHoverColor(kind: vscode.ColorThemeKind): string {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return '#3994BC26';
    case vscode.ColorThemeKind.HighContrast:
      return '#3994BC55';
    default:
      return '#3994BC33';
  }
}

/**
 * Name of the active color theme as used in `[Theme Name]` keys of
 * workbench.colorCustomizations, honoring the OS-dependent auto-detect settings.
 */
export function activeThemeName(): string | undefined {
  const workbench = vscode.workspace.getConfiguration('workbench');
  const win = vscode.workspace.getConfiguration('window');
  const kind = vscode.window.activeColorTheme.kind;
  const hc = kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight;
  if (hc && win.get<boolean>('autoDetectHighContrast', true)) {
    const name = workbench.get<string>(kind === vscode.ColorThemeKind.HighContrastLight ? 'preferredHighContrastLightColorTheme' : 'preferredHighContrastColorTheme');
    if (name) {
      return name;
    }
  }
  if (!hc && win.get<boolean>('autoDetectColorScheme', false)) {
    const name = workbench.get<string>(kind === vscode.ColorThemeKind.Light ? 'preferredLightColorTheme' : 'preferredDarkColorTheme');
    if (name) {
      return name;
    }
  }
  return workbench.get<string>('colorTheme');
}

type Customizations = Record<string, unknown>;

function userCustomizations(): Customizations {
  const v = vscode.workspace.getConfiguration('workbench').inspect<Customizations>('colorCustomizations')?.globalValue;
  return v ? JSON.parse(JSON.stringify(v)) : {};
}

async function writeCustomizations(value: Customizations): Promise<void> {
  const empty = Object.keys(value).length === 0;
  await vscode.workspace
    .getConfiguration('workbench')
    .update('colorCustomizations', empty ? undefined : value, vscode.ConfigurationTarget.Global);
}

/** Current user-level hover highlight override for a theme, if any. */
export function hoverOverride(theme: string): string | undefined {
  const scoped = userCustomizations()[`[${theme}]`] as Record<string, string> | undefined;
  return scoped?.[KEY];
}

export async function useBlueHoverHighlight(): Promise<boolean> {
  const theme = activeThemeName();
  if (!theme) {
    void vscode.window.showWarningMessage('Could not determine the active color theme.');
    return false;
  }
  const color = blueHoverColor(vscode.window.activeColorTheme.kind);
  const existing = hoverOverride(theme);
  if (existing && existing.toLowerCase() !== color.toLowerCase()) {
    const pick = await vscode.window.showWarningMessage(
      `Your settings already set a hover highlight color (${existing}) for the "${theme}" theme. Replace it with ${color}?`,
      { modal: true },
      'Replace',
    );
    if (pick !== 'Replace') {
      return false;
    }
  }
  const all = userCustomizations();
  const key = `[${theme}]`;
  const scoped = { ...((all[key] as Record<string, string>) ?? {}), [KEY]: color };
  all[key] = scoped;
  await writeCustomizations(all);
  void vscode.window
    .showInformationMessage(`Hover highlight for the "${theme}" theme is now a subtle blue (${color}). It applies to all files in this theme.`, 'Undo')
    .then((a) => (a === 'Undo' ? removeBlueHoverHighlight(true) : undefined));
  return true;
}

export async function removeBlueHoverHighlight(silent = false): Promise<void> {
  const theme = activeThemeName();
  if (!theme) {
    return;
  }
  const all = userCustomizations();
  const key = `[${theme}]`;
  const scoped = all[key] as Record<string, string> | undefined;
  if (!scoped || !(KEY in scoped)) {
    if (!silent) {
      void vscode.window.showInformationMessage(`No hover highlight override is set for the "${theme}" theme.`);
    }
    return;
  }
  delete scoped[KEY];
  if (Object.keys(scoped).length === 0) {
    delete all[key];
  }
  await writeCustomizations(all);
  if (!silent) {
    void vscode.window.showInformationMessage(`Removed the hover highlight override for the "${theme}" theme.`);
  }
}

/**
 * Offer the blue hover highlight once per affected theme. Never writes
 * settings without the user clicking the button.
 */
export function registerHoverHint(context: vscode.ExtensionContext): vscode.Disposable {
  let showing = false;
  const maybeShow = async () => {
    const theme = activeThemeName();
    if (showing || !theme || !NEUTRAL_HOVER_THEMES.has(theme)) {
      return;
    }
    if (!vscode.workspace.getConfiguration('nastran').get<boolean>('fieldShading.enabled', true)) {
      return;
    }
    const flag = `hoverHintShown:${theme}`;
    if (context.globalState.get<boolean>(flag) || hoverOverride(theme)) {
      return;
    }
    showing = true;
    await context.globalState.update(flag, true);
    const pick = await vscode.window.showInformationMessage(
      `The "${theme}" theme highlights hovered text in gray, which blends with the Nastran field shading. Use a subtle blue hover highlight for this theme instead?`,
      'Use Blue Hover',
      "Don't Show Again",
    );
    showing = false;
    if (pick === 'Use Blue Hover') {
      await useBlueHoverHighlight();
    }
  };
  void maybeShow();
  return vscode.window.onDidChangeActiveColorTheme(() => void maybeShow());
}
