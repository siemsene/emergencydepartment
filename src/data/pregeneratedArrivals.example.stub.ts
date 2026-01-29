import { HourlyArrivals } from '../types';

// Example pre-generated arrivals dataset (empty by default).
// Copy this file to `pregeneratedArrivals.ts` and customize as needed.
export const PREGENERATED_ARRIVALS: HourlyArrivals[] = [];

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