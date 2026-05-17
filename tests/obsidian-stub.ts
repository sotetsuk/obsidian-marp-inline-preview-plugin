export const normalizePath = (p: string): string => {
  let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
};
export class TFile {}
export class App {}
