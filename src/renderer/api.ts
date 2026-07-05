/**
 * The swap point between mock and real backend. ALL renderer code imports
 * `api` from here — nothing else ever touches window.api directly.
 *
 * Mock is used when forced (`npm run start:mock`) or when the real bridge
 * isn't exposed yet (Phase 0 preload exposes nothing). Once Backend milestone
 * B4 lands, plain `npm start` picks up window.api with zero renderer changes.
 */
import type { Api } from '../shared/api';
import { createMockApi } from './mock-api';

declare global {
  interface Window {
    api?: Api;
  }
}

export const usingMock: boolean = Boolean(import.meta.env.VITE_FORCE_MOCK) || !window.api;

export const api: Api = usingMock ? createMockApi() : (window.api as Api);
