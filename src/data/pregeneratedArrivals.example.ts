import { HourlyArrivals } from '../types';

// Example pre-generated arrivals dataset.
// Copy this file to `pregeneratedArrivals.ts` and customize as needed.
export const PREGENERATED_ARRIVALS: HourlyArrivals[] = [
  { hour: 1, A: 0, B: 1, C: 1 },
  { hour: 2, A: 1, B: 0, C: 2 },
  { hour: 3, A: 0, B: 1, C: 2 },
  { hour: 4, A: 0, B: 2, C: 4 },
  { hour: 5, A: 2, B: 1, C: 2 },
  { hour: 6, A: 1, B: 1, C: 3 },
  { hour: 7, A: 1, B: 3, C: 2 },
  { hour: 8, A: 2, B: 1, C: 4 },
  { hour: 9, A: 1, B: 2, C: 4 },
  { hour: 10, A: 3, B: 4, C: 3 },
  { hour: 11, A: 1, B: 2, C: 3 },
  { hour: 12, A: 0, B: 1, C: 1 },
  { hour: 13, A: 1, B: 2, C: 2 },
  { hour: 14, A: 0, B: 2, C: 2 },
  { hour: 15, A: 2, B: 3, C: 2 },
  { hour: 16, A: 0, B: 3, C: 1 },
  { hour: 17, A: 1, B: 1, C: 0 },
  { hour: 18, A: 2, B: 2, C: 1 },
  { hour: 19, A: 1, B: 2, C: 1 },
  { hour: 20, A: 0, B: 1, C: 0 },
  { hour: 21, A: 1, B: 1, C: 0 },
  { hour: 22, A: 0, B: 1, C: 1 },
  { hour: 23, A: 1, B: 0, C: 0 },
  { hour: 24, A: 0, B: 1, C: 0 }
];

export const getTotalPregenerated = () => {
  return PREGENERATED_ARRIVALS.reduce(
    (acc, h) => ({
      A: acc.A + h.A,
      B: acc.B + h.B,
      C: acc.C + h.C
    }),
    { A: 0, B: 0, C: 0 }
  );
};
