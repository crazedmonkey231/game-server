/** Utility functions related to date and time calculations */

export const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export type DayName = typeof dayNames[number];

/** Gets the name of the current day of the week */
export function getCurrentDayName(): DayName {
  const day = new Date().getDay();
  return dayNames[day];
}

export const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
export type MonthName = typeof monthNames[number];

/** Gets the name of the current month */
export function getCurrentMonthName(): MonthName {
  const month = new Date().getMonth();
  return monthNames[month];
}

export const seasonNames = ["Spring", "Summer", "Autumn", "Winter"];
export type SeasonName = typeof seasonNames[number];

/** Gets the current season based on the month of the year */
export function getCurrentSeason(): SeasonName {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) {
    return "Spring";
  }
  if (month >= 5 && month <= 7) {
    return "Summer";
  }
  if (month >= 8 && month <= 10) {
    return "Autumn";
  }
  return "Winter";
}

/** Converts a length in milliseconds to the equivalent number of days, rounding up to the nearest whole day */
export function millisecondsToDays(length: number): number {
  return Math.ceil(length / (24 * 60 * 60 * 1000));
}

/** Checks if the current day is Monday */
export function isMonday(): boolean {
  const day = new Date().getDay();
  return day === 1;
}

/** Checks if the current day is Tuesday */
export function isTuesday(): boolean {
  const day = new Date().getDay();
  return day === 2;
}

/** Checks if the current day is Wednesday */
export function isWednesday(): boolean {
  const day = new Date().getDay();
  return day === 3;
}

/** Checks if the current day is Thursday */
export function isThursday(): boolean {
  const day = new Date().getDay();
  return day === 4;
}

/** Checks if the current day is Friday */
export function isFriday(): boolean {
  const day = new Date().getDay();
  return day === 5;
}

/** Checks if the current day is Saturday */
export function isSaturday(): boolean {
  const day = new Date().getDay();
  return day === 6;
}

/** Checks if the current day is Sunday */
export function isSunday(): boolean {
  const day = new Date().getDay();
  return day === 0;
}

/** Checks if the current day is part of the weekend (Saturday to Sunday) */
export function isWeekend(): boolean {
  const day = new Date().getDay(); 
  return isSaturday() || isSunday();
}

/** A mapping of day check function names to their implementations for easy access */
export const dayCheckFunctions: Record<string, () => boolean> = {
  "isMonday": isMonday,
  "isTuesday": isTuesday,
  "isWednesday": isWednesday,
  "isThursday": isThursday,
  "isFriday": isFriday,
  "isSaturday": isSaturday,
  "isSunday": isSunday,
  "isWeekend": isWeekend
};
export type DayCheckFunctionName = keyof typeof dayCheckFunctions;

/** Checks if the specified day condition is currently true by looking up the corresponding function and executing it */
export function checkDayCondition(condition: DayCheckFunctionName): boolean {
  const checkFunction = dayCheckFunctions[condition];
  if (!checkFunction) {
    throw new Error(`Invalid day condition: ${condition}`);
  }
  return checkFunction();
}

/** Generates a function that checks if any of the specified day conditions are currently true */
export function generateDayCheck(conditions: DayCheckFunctionName[]): () => boolean {
  return () => conditions.some(checkDayCondition);
}