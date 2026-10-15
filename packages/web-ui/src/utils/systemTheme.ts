export const isLinuxDesktop = (): boolean =>
  /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
