declare const __APP_VERSION__: string | undefined;
declare const __BUILD_NUMBER__: string | undefined;
declare const __GIT_SHA__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

const desktopVersions = typeof window !== "undefined" ? window.mdcDesktop?.versions : undefined;

export const APP_NAME = "GD Markdown Composer";
export const APP_VERSION =
  desktopVersions?.app ||
  (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__ ? __APP_VERSION__ : "1.0.0");
export const BUILD_NUMBER =
  desktopVersions?.buildNumber ||
  (typeof __BUILD_NUMBER__ !== "undefined" && __BUILD_NUMBER__ ? __BUILD_NUMBER__ : "");
export const GIT_SHA = typeof __GIT_SHA__ !== "undefined" && __GIT_SHA__ ? __GIT_SHA__ : "";
export const BUILD_DATE =
  typeof __BUILD_DATE__ !== "undefined" && __BUILD_DATE__ ? __BUILD_DATE__ : "";
