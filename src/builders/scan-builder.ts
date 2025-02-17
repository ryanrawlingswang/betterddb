import { ScanCommand, ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import { BetterDDB } from '../betterddb';
import { getOperatorExpression, Operator } from '../operator';
import { PaginatedResult } from '../types/paginated-result';

export class ScanBuilder<T> {
  private filters: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, any> = {};
  private limit?: number;
  private lastKey?: Record<string, any>;

  constructor(private parent: BetterDDB<T>) {}

  public where(
    attribute: keyof T,
    operator: Operator,
    values: any | [any, any]
  ): this {
    const attrStr = String(attribute);
    const nameKey = `#attr_${attrStr}`;
    this.expressionAttributeNames[nameKey] = attrStr;

    if (operator === 'between') {
      if (!Array.isArray(values) || values.length !== 2) {
        throw new Error(
          `For 'between' operator, values must be a tuple of two items`
        );
      }
      const valueKeyStart = `:val_start_${attrStr}`;
      const valueKeyEnd = `:val_end_${attrStr}`;
      this.expressionAttributeValues[valueKeyStart] = values[0];
      this.expressionAttributeValues[valueKeyEnd] = values[1];
      this.filters.push(
        `${nameKey} BETWEEN ${valueKeyStart} AND ${valueKeyEnd}`
      );
    } else if (operator === 'begins_with' || operator === 'contains') {
      const valueKey = `:val_${attrStr}`;
      this.expressionAttributeValues[valueKey] = values;
      this.filters.push(`${operator}(${nameKey}, ${valueKey})`);
    } else {
      const valueKey = `:val_${attrStr}`;
      this.expressionAttributeValues[valueKey] = values;
      const condition = getOperatorExpression(operator, nameKey, valueKey);
      this.filters.push(condition);
    }
    return this;
  }

  public limitResults(limit: number): this {
    this.limit = limit;
    return this;
  }

  public startFrom(lastKey: Record<string, any>): this {
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
      ExclusiveStartKey: this.lastKey
    };

    if (this.filters.length > 0) {
      params.FilterExpression = this.filters.join(' AND ');
    }

    const result = await this.parent.getClient().send(new ScanCommand(params));

    return {items: this.parent.getSchema().array().parse(result.Items) as T[], lastKey: result.LastEvaluatedKey ?? undefined};
  }
}
