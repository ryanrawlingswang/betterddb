export type Operator =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "begins_with"
  | "between"
  | "contains";

export function getOperatorExpression(
  operator: Operator,
  nameKey: string,
  valueKey: string,
  secondValueKey?: string,
): string {
  switch (operator) {
    case "==":
      return `${nameKey} = ${valueKey}`;
    case "!=":
      return `${nameKey} <> ${valueKey}`;
    case "<":
      return `${nameKey} < ${valueKey}`;
    case "<=":
      return `${nameKey} <= ${valueKey}`;
    case ">":
      return `${nameKey} > ${valueKey}`;
    case ">=":
      return `${nameKey} >= ${valueKey}`;
    case "begins_with":
      return `begins_with(${nameKey}, ${valueKey})`;
    case "between":
      if (!secondValueKey) {
        throw new Error("The 'between' operator requires two value keys");
      }
      return `${nameKey} BETWEEN ${valueKey} AND ${secondValueKey}`;
    case "contains":
      return `contains(${nameKey}, ${valueKey})`;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}
