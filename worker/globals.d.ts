/**
 * Ambient browser globals for the Worker TypeScript project.
 *
 * The worker imports seed data from src/utils/mockData.ts, which touches
 * window/localStorage behind `typeof window === 'undefined'` guards. The
 * Workers runtime has no DOM, but declaring these (as `any`) keeps the shared
 * module type-checkable in both projects without changing any runtime
 * behavior — the guards still prevent any access on the server.
 */

declare const window: any;
declare const localStorage: any;
