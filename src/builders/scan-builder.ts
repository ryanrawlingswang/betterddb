import { ScanCommand, type ScanCommandInput, type NativeAttributeValue } from "@aws-sdk/lib-dynamodb";
import { type BetterDDB } from "../betterddb";
import { getOperatorExpression, type Operator } from "../operator";
import { type PaginatedResult } from "../types/paginated-result";

export class ScanBuilder<T> {
  private filters: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, NativeAttributeValue> = {};
  private limit?: number;
  private lastKey?: Record<string, NativeAttributeValue>;

  constructor(private parent: BetterDDB<T>) {}

  public where(
    attribute: keyof T,
    operator: Operator,
    values: unknown,
  ): this {
    const attrStr = String(attribute);
    const nameKey = `#attr_${attrStr}`;
    this.expressionAttributeNames[nameKey] = attrStr;
    if (operator === "between") {
      if (!Array.isArray(values) || values.length !== 2) {
        throw new Error(
          `For 'between' operator, values must be a tuple of two items`,
        );
      }
      const valueKeyStart = `:val_start_${attrStr}`;
      const valueKeyEnd = `:val_end_${attrStr}`;
      this.expressionAttributeValues[valueKeyStart] = values[0] as Record<string, NativeAttributeValue>;
      this.expressionAttributeValues[valueKeyEnd] = values[1] as Record<string, NativeAttributeValue>;
      this.filters.push(
        `${nameKey} BETWEEN ${valueKeyStart} AND ${valueKeyEnd}`,
      );
    } else if (operator === "begins_with" || operator === "contains") {
      const valueKey = `:val_${attrStr}`;
      this.expressionAttributeValues[valueKey] = values as Record<string, NativeAttributeValue>;
      this.filters.push(`${operator}(${nameKey}, ${valueKey})`);
    } else {
      const valueKey = `:val_${attrStr}`;
      this.expressionAttributeValues[valueKey] = values as Record<string, NativeAttributeValue>;
      const condition = getOperatorExpression(operator, nameKey, valueKey);
      this.filters.push(condition);
    }
    return this;
  }

  public limitResults(limit: number): this {
    this.limit = limit;
    return this;
  }

  public startFrom(lastKey: Record<string, NativeAttributeValue>): this {
    this.lastKey = lastKey;
    return this;
  }

  /**
   * Executes the scan and returns a Promise that resolves with an array of items.
   */
  public async execute(): Promise<PaginatedResult<T>> {
    const params: ScanCommandInput = {
      TableName: this.parent.getTableName(),
      ExpressionAttributeNames: this.expressionAttributeNames,
      ExpressionAttributeValues: this.expressionAttributeValues,
      Limit: this.limit,
      ExclusiveStartKey: this.lastKey,
    };

    if (this.parent.getEntityType()) {
      this.filters.push(`#entity = :entity_value`);
      this.expressionAttributeNames["#entity"] = "entityType";
      this.expressionAttributeValues[":entity_value"] =
        this.parent.getEntityType();
    }
    params.FilterExpression = this.filters.join(" AND ");

    const result = await this.parent.getClient().send(new ScanCommand(params));

    return {
      items: this.parent.getSchema().array().parse(result.Items) as T[],
      lastKey: result.LastEvaluatedKey ?? undefined,
    };
  }
}
