/** Round to 2 decimal places — safe for financial calculations */
export const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
