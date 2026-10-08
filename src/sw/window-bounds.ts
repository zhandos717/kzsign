export interface Bounds { left?: number; top?: number; width?: number; height?: number }

const WIDTH = 400;
const HEIGHT = 600;
const MARGIN_RIGHT = 16;
// ниже строки вкладок и адресной строки, примерно там, где Chrome показывает свои всплывающие окна
const OFFSET_TOP = 72;

export function confirmWindowBounds(parent: Bounds | undefined): { width: number; height: number; left?: number; top?: number } {
  if (!parent || parent.left === undefined || parent.top === undefined || parent.width === undefined) return { width: WIDTH, height: HEIGHT };
  return {
    width: WIDTH,
    height: HEIGHT,
    left: Math.max(parent.left, parent.left + parent.width - WIDTH - MARGIN_RIGHT),
    top: parent.top + OFFSET_TOP,
  };
}
