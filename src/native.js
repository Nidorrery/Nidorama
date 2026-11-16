// Bridge to the Android shell (Capacitor). Everything degrades gracefully in a plain browser.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

export const isNative = Capacitor.isNativePlatform();
const Native = isNative ? registerPlugin('Nidorama') : null;

export async function openHomeAssistantApp(fallbackUrl) {
  if (Native) {
    try { await Native.openHomeAssistant({ fallbackUrl }); return; } catch (e) { console.warn(e); }
  }
  if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener');
}

/** Open another app by its Android package name (falls back to a web address). */
export async function openApp(pkg, fallbackUrl) {
  if (Native) { try { await Native.openApp({ package: pkg, fallbackUrl }); return; } catch (e) { console.warn(e); } }
  if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener');
}

export async function getLauncherState() {
  if (!Native) return null;
  try { return await Native.getLauncherState(); } catch { return null; }
}

export async function setLauncherMode(enabled) {
  if (Native) await Native.setLauncherMode({ enabled });
}

export async function openDefaultLauncherSettings() {
  if (Native) await Native.openHomeSettings();
}

export async function setKeepScreenOn(enabled) {
  if (Native) await Native.setKeepScreenOn({ enabled });
}

/** Android back button: `handler` returns true when it consumed the press. */
export function onBackButton(handler, isLauncher) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (handler()) return;
    if (!isLauncher()) App.minimizeApp();
  });
}

/** Save text to a file the user chooses (Android's "save to" picker). Resolves true if saved. */
export async function saveTextFile(name, text) {
  if (!Native) return false;
  try { await Native.saveTextFile({ name, text }); return true; } catch (e) { console.warn(e); return false; }
}

/**
 * Download an APK and open Android's installer. onProgress gets 0..1.
 * Resolves 'installing', or 'needs-permission' when the user must first allow installs from Nidorama
 * (the settings screen for that has been opened).
 */
export async function installUpdate(url, token, onProgress, { save = false, name = '' } = {}) {
  if (!Native) return 'unsupported';
  const sub = await Native.addListener('updateProgress', (e) => onProgress?.(e.fraction));
  try { return (await Native.installUpdate({ url, token, save, name })).status; } finally { sub.remove(); }
}
/** Ask Android to remove this app (used when going back to an older build, which cannot install over a newer one). */
export async function uninstallSelf() {
  if (Native) try { await Native.uninstallSelf(); } catch (e) { console.warn(e); }
}

/** Turn the background update check and its notification on or off (asks for permission once). */
export async function setUpdateNotifications(enabled, token, channels = '') {
  if (Native) try { await Native.setUpdateNotifications({ enabled, token, channels }); } catch (e) { console.warn(e); }
}
/** Show "Update available. Would you like to install?" now. */
export async function notifyUpdate(version, build) {
  if (Native) try { await Native.notifyUpdate({ version, build }); } catch (e) { console.warn(e); }
}
/** What the app was opened for (e.g. 'install_update' from the notification), once. */
export async function takeLaunchAction() {
  if (!Native) return null;
  try { return (await Native.takeLaunchAction()).action || null; } catch { return null; }
}
/** Open the Scaniverse scanning app (or its store page if it is not installed). Resolves false outside the Android app. */
export async function openScanner() {
  if (!Native) return false;
  try { await Native.openScanner(); return true; } catch (e) { console.warn(e); return false; }
}
const sharedBlob = async (f) => (f?.path ? { name: f.name || 'scan.glb', blob: await (await fetch(Capacitor.convertFileSrc(f.path))).blob() } : null);
/** A file another app shared into Nidorama (a scan exported from Scaniverse), once. */
export async function takeSharedFile() {
  if (!Native) return null;
  try { return await sharedBlob(await Native.takeSharedFile()); } catch { return null; }
}
export function onSharedFile(fn) {
  if (Native) Native.addListener('sharedFile', async (f) => { const s = await sharedBlob(f).catch(() => null); if (s) { Native.takeSharedFile().catch(() => {}); fn(s); } });
}
export function onLaunchAction(fn) {
  if (Native) Native.addListener('launchAction', (e) => fn(e.action));
}

/** Hide (or show) Android's status and navigation bars. They still come back for a moment with a swipe from the very edge. */
export async function setFullscreen(enabled, pin = false) {
  if (Native) try { await Native.setFullscreen({ enabled, pin }); } catch (e) { console.warn(e); }
}
/** Pull down Android's notification tray. */
export async function showNotifications() {
  if (Native) try { await Native.showNotifications(); } catch (e) { console.warn(e); }
}

/** One of the user's own alerts, as an ordinary notification on this device. */
export async function notifyAlert(title, text, id = 1) {
  if (Native) try { await Native.notifyAlert({ title, text, id }); } catch (e) { console.warn(e); }
}
/** Ask Android for permission to show notifications (asked when the first alert is made, not at install). */
export async function askNotifications() {
  if (Native) try { await Native.askNotifications(); } catch (e) { console.warn(e); }
}

/** Write a file straight into the device's Downloads folder. Resolves true if saved. */
export async function saveToDownloads(name, text) {
  if (!Native) return false;
  try { await Native.saveToDownloads({ name, text }); return true; } catch (e) { console.warn(e); return false; }
}
/** Hand a file to another app through Android's share screen. Resolves true if the screen opened. */
export async function shareTextFile(name, text) {
  if (!Native) return false;
  try { await Native.shareTextFile({ name, text }); return true; } catch (e) { console.warn(e); return false; }
}
