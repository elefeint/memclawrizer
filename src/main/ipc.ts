/**
 * Thin ipcMain handlers wiring db/sessions/packs/stats to the frozen contract
 * channels (src/shared/api.ts IPC constants). All game/schedule logic lives in
 * the pure modules; this file is Electron glue only.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { AnswerRequest, AttemptFilter, DeckSettings } from '../shared/api';
import { IPC } from '../shared/api';
import type { Db } from './db';
import { importPack, exportPack } from './packs';
import { removeDeck, updateDeckSettings } from './queries';
import { SessionManager } from './sessions';
import { attemptRows, cardStats, deckStats, deckSummaries, trophyViews } from './stats';

export function registerIpc(db: Db, sessions: SessionManager): void {
  const conn = db.conn;

  ipcMain.handle(IPC.decksList, () => deckSummaries(conn, new Date()));

  ipcMain.handle(IPC.decksImport, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Import deck pack',
      filters: [{ name: 'Deck packs', extensions: ['deckpack', 'zip'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return importPack(conn, picked.filePaths[0], new Date());
  });

  ipcMain.handle(IPC.decksExport, async (event, deckId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Export deck pack',
      defaultPath: `${deckId}.deckpack`,
      filters: [{ name: 'Deck packs', extensions: ['deckpack'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    await exportPack(conn, deckId, picked.filePath);
    return picked.filePath;
  });

  ipcMain.handle(IPC.decksRemove, (_e, deckId: string) => removeDeck(conn, deckId));

  ipcMain.handle(IPC.decksUpdateSettings, (_e, deckId: string, settings: DeckSettings) =>
    updateDeckSettings(conn, deckId, settings),
  );

  ipcMain.handle(IPC.sessionStart, (_e, deckId: string, opts?: { tags?: string[] }) =>
    sessions.start(deckId, opts ?? {}),
  );

  ipcMain.handle(IPC.sessionAnswer, (_e, sessionId: string, req: AnswerRequest) =>
    sessions.answer(sessionId, req),
  );

  ipcMain.handle(IPC.sessionAbort, (_e, sessionId: string) => sessions.abort(sessionId));

  ipcMain.handle(IPC.statsDeck, (_e, deckId: string) => deckStats(conn, deckId, new Date()));

  ipcMain.handle(IPC.statsCards, (_e, deckId: string) => cardStats(conn, deckId));

  ipcMain.handle(IPC.statsAttempts, (_e, filter: AttemptFilter) => attemptRows(conn, filter ?? {}));

  ipcMain.handle(IPC.statsTrophies, () => trophyViews(conn));
}
