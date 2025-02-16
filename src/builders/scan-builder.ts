import { ScanCommand, ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import { BetterDDB } from '../betterddb';

export class ScanBuilder<T> {
  private filters: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, any> = {};
  private limit?: number;
  private lastKey?: Record<string, any>;

  constructor(private parent: BetterDDB<T>) {}

  public where(
    attribute: keyof T,
    operator: 'eq' | 'begins_with' | 'between',
    values: any | [any, any]
  ): this {
    const attrStr = String(attribute);
    const nameKey = `#attr_${attrStr}`;
    this.expressionAttributeNames[nameKey] = attrStr;

    if (operator === 'eq') {
      const valueKey = `:val_${attrStr}`;
      this.expressionAttributeValues[valueKey] = values;
      this.filters.push(`${nameKey} = ${valueKey}`);
    } else if (operator === 'begins_with') {
      const valueKey = `:val_${attrStr}`;
      this.expressionAttributeValues[valueKey] = values;
      this.filters.push(`begins_with(${nameKey}, ${valueKey})`);
    } else if (operator === 'between') {
      if (!Array.isArray(values) || values.length !== 2) {
        throw new Error(`For 'between' operator, values must be a tuple of two items`);
      }
      const valueKeyStart = `:val_start_${attrStr}`;
      const valueKeyEnd = `:val_end_${attrStr}`;
      this.expressionAttributeValues[valueKeyStart] = values[0];
      this.expressionAttributeValues[valueKeyEnd] = values[1];
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

  /**
   * Executes the scan and returns a Promise that resolves with an array of items.
   */
  public async execute(): Promise<T[]> {
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
    return this.parent.getSchema().array().parse(result.Items) as T[];
  }

  // Thenable implementation.
  public then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  public catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T[] | TResult> {
    return this.execute().catch(onrejected);
  }
  public finally(onfinally?: (() => void) | null): Promise<T[]> {
    return this.execute().finally(onfinally);
  }
}
