export function installE2eGlobals(args: { controlUrl: string; pick: string }): void;
export function scrollMainContent(): void;
export type PixelCompare = { sizeMismatch: string } | { percent: number; side: string };
export function comparePixels(args: {
  imgA: string;
  imgB: string;
  threshold: number;
  mask: { width: number; height: number };
}): Promise<PixelCompare>;
export function chipStartsWith(prefix: string): boolean;
