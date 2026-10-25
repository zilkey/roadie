/** The gas math, frozen onto expenses. priceMilli = $/gal × 1000. */

export const tripMiles = (oneWayMiles: number, roundTrip: boolean): number => (roundTrip ? oneWayMiles * 2 : oneWayMiles);

/** cents = round(miles ÷ mpg × priceMilli ÷ 10) */
export const gasCents = (miles: number, mpg: number, priceMilli: number): number => Math.round(((miles / mpg) * priceMilli) / 10);
