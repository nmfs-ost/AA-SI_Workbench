/**
 * Shell-level dialogs — modal surfaces that belong to the application chrome
 * rather than to any one dock panel (About, environment update, feedback).
 *
 * The id lives in types/ so `menus.ts` and any other chrome can point at a
 * dialog without importing the component registry (which would invert the
 * dependency: types must not depend on components).
 */
export type DialogId = 'about' | 'environment' | 'feedback';
