export type CalendarMonthPeriod = {
  start: string;
  end: string;
  dayCount: number;
  days: number[];
};

export function calendarMonthPeriod(month: string): CalendarMonthPeriod {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(month);
  if (!match) throw new Error('INVALID_MONTH');

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const isLeapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const dayCount = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][monthNumber - 1];

  return {
    start: `${month}-01`,
    end: `${month}-${String(dayCount).padStart(2, '0')}`,
    dayCount,
    days: Array.from({ length: dayCount }, (_, index) => index + 1),
  };
}
