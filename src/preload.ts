/**
 * IPC bridge. Owned by the Backend agent.
 *
 * Phase 0 deliberately exposes NOTHING: src/renderer/api.ts falls back to the
 * mock whenever window.api is absent, so `npm start` works end-to-end before
 * the backend exists. Milestone B4 replaces this with
 * contextBridge.exposeInMainWorld('api', ...) mapping every method of the
 * shared Api interface (src/shared/api.ts) onto ipcRenderer.invoke calls using
 * the IPC channel constants from the same file.
 */
export {};
