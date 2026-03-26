/**
 * formateDate
 * @param date - string in this format: 2022-01-01
 * @returns string in this format: January 1, 2022
 */
export const formatDate = (date: string) => {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};
