import type { Point } from '../../domain/template';

/**
 * A projective map between two planes, as the nine numbers of a 3x3 matrix in
 * row order. It carries a point on the flat sheet to where a camera sees it,
 * or back.
 */
export type Homography = readonly number[];

/** Solves the linear system a·x = b in place by Gaussian elimination. Null when it has no single solution. */
function solve(a: number[][], b: number[]): number[] | null {
  const size = b.length;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-10) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    [b[column], b[pivot]] = [b[pivot], b[column]];
    for (let row = column + 1; row < size; row++) {
      const factor = a[row][column] / a[column][column];
      for (let k = column; k < size; k++) a[row][k] -= factor * a[column][k];
      b[row] -= factor * b[column];
    }
  }
  const x = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < size; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/**
 * The map that takes each of four source points to its destination point.
 * Null when the points do not define one (three of them in a line).
 */
export function homographyFromPoints(
  source: readonly Point[],
  destination: readonly Point[]
): Homography | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let index = 0; index < 4; index++) {
    const { x, y } = source[index];
    const { x: u, y: v } = destination[index];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const solution = solve(a, b);
  return solution ? [...solution, 1] : null;
}

export function applyHomography(h: Homography, point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / w,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / w,
  };
}
