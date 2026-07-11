/**
 * Preload bridge — exposes the full frozen Api (src/shared/api.ts) as
 * window.api, each method a plain ipcRenderer.invoke on the shared channel
 * constants. No logic here: main validates and decides everything.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from './shared/api';
import { IPC } from './shared/api';

const api: Api = {
  decks: {
    list: () => ipcRenderer.invoke(IPC.decksList),
    import: () => ipcRenderer.invoke(IPC.decksImport),
    export: (deckId) => ipcRenderer.invoke(IPC.decksExport, deckId),
    remove: (deckId) => ipcRenderer.invoke(IPC.decksRemove, deckId),
    updateSettings: (deckId, settings) =>
      ipcRenderer.invoke(IPC.decksUpdateSettings, deckId, settings),
    archive: (deckId) => ipcRenderer.invoke(IPC.decksArchive, deckId),
    unarchive: (deckId) => ipcRenderer.invoke(IPC.decksUnarchive, deckId),
  },
  session: {
    start: (deckId, opts) => ipcRenderer.invoke(IPC.sessionStart, deckId, opts),
    answer: (sessionId, req) => ipcRenderer.invoke(IPC.sessionAnswer, sessionId, req),
    abort: (sessionId) => ipcRenderer.invoke(IPC.sessionAbort, sessionId),
  },
  stats: {
    deck: (deckId) => ipcRenderer.invoke(IPC.statsDeck, deckId),
    cards: (deckId) => ipcRenderer.invoke(IPC.statsCards, deckId),
    attempts: (filter) => ipcRenderer.invoke(IPC.statsAttempts, filter),
    trophies: () => ipcRenderer.invoke(IPC.statsTrophies),
  },
};

contextBridge.exposeInMainWorld('api', api);
