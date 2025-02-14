// src/scan-builder.ts
import { DynamoDB } from 'aws-sdk';
import { BetterDDB } from './betterddb';

export class ScanBuilder<T> {
  private filters: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, any> = {};
  private limit?: number;
  private lastKey?: Record<string, any>;

  constructor(private parent: BetterDDB<T>) {}

  public where(attribute: keyof T, operator: 'eq' | 'begins_with' | 'between', values: any | [any, any]): this {
    const nameKey = `#attr_${String(attribute)}`;
    this.expressionAttributeNames[nameKey] = attribute as string;

    if (operator === 'eq') {
      const valueKey = `:val_${String(attribute)}`;
      this.expressionAttributeValues[valueKey] = values;
      this.filters.push(`${nameKey} = ${valueKey}`);
    } else if (operator === 'begins_with') {
      const valueKey = `:val_${String(attribute)}`;
      this.expressionAttributeValues[valueKey] = values;
      this.filters.push(`begins_with(${nameKey}, ${valueKey})`);
    } else if (operator === 'between' && Array.isArray(values) && values.length === 2) {
      const [start, end] = values;
      const valueKeyStart = `:val_start_${String(attribute)}`;
      const valueKeyEnd = `:val_end_${String(attribute)}`;
      this.expressionAttributeValues[valueKeyStart] = start;
      this.expressionAttributeValues[valueKeyEnd] = end;
      this.filters.push(`${nameKey} BETWEEN ${valueKeyStart} AND ${valueKeyEnd}`);
    } else {
      throw new Error(`Unsupported operator: ${operator}`);
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

  private async execute(): Promise<T[]> {
    const params: DynamoDB.DocumentClient.ScanInput = {
      TableName: this.parent.getTableName(),
      ExpressionAttributeNames: this.expressionAttributeNames,
      ExpressionAttributeValues: this.expressionAttributeValues,
      Limit: this.limit,
      ExclusiveStartKey: this.lastKey
    };

    if (this.filters.length > 0) {
      params.FilterExpression = this.filters.join(' AND ');
    }

    const result = await this.parent.getClient().scan(params).promise();
    return (result.Items || []).map(item => this.parent.getSchema().parse(item));
  }

  public then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
