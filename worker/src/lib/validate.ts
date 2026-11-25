/** True only for absolute http: or https: URLs (blocks javascript:, data:, etc.). */
export const httpUrl = (x: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(x).protocol);
  } catch {
    return false;
  }
};
