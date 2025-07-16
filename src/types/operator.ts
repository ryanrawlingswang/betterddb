export enum Operator {
  EQ = "==",
  NE = "!=",
  LT = "<",
  LTE = "<=",
  GT = ">",
  GTE = ">=",
  BEGINS_WITH = "begins_with",
  BETWEEN = "between",
  CONTAINS = "contains",
}

export function getOperatorExpression(
  operator: Operator,
  nameKey: string,
  valueKey: string,
  secondValueKey?: string,
): string {
  switch (operator) {
    case Operator.EQ:
      return `${nameKey} = ${valueKey}`;
    case Operator.NE:
      return `${nameKey} <> ${valueKey}`;
    case Operator.LT:
      return `${nameKey} < ${valueKey}`;
    case Operator.LTE:
      return `${nameKey} <= ${valueKey}`;
    case Operator.GT:
      return `${nameKey} > ${valueKey}`;
    case Operator.GTE:
      return `${nameKey} >= ${valueKey}`;
    case Operator.BEGINS_WITH:
      return `begins_with(${nameKey}, ${valueKey})`;
    case Operator.BETWEEN:
      if (!secondValueKey) {
        throw new Error("The 'between' operator requires two value keys");
      }
      return `${nameKey} BETWEEN ${valueKey} AND ${secondValueKey}`;
    case Operator.CONTAINS:
      return `contains(${nameKey}, ${valueKey})`;
    default:
      throw new Error("Unsupported operator");
  }
}
