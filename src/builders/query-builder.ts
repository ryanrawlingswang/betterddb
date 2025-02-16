import { QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { BetterDDB } from '../betterddb';

export class QueryBuilder<T> {
  private filters: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, any> = {};
  private indexName?: string;
  private sortKeyCondition?: string; // You can extend this to support a fluent sort builder.
  private limit?: number;
  private lastKey?: Record<string, any>;
  private ascending: boolean = true;

  constructor(private parent: BetterDDB<T>, private key: Partial<T>) {}

  public usingIndex(indexName: string): this {
    this.indexName = indexName;
    return this;
  }

  public sortAscending(): this {
    this.ascending = true;
    return this;
  }

  public sortDescending(): this {
    this.ascending = false;
    return this;
  }

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
   * Executes the query and returns a Promise that resolves with an array of items.
   */
  public async execute(): Promise<T[]> {
    // Build a simple key condition for the partition key.
    const keys = this.parent.getKeys();
    const pkName = keys.primary.name;
    this.expressionAttributeNames['#pk'] = pkName;

    // Cast the built key to a record so that we can index by string.
    const builtKey = this.parent.buildKey(this.key) as Record<string, any>;
    this.expressionAttributeValues[':pk_value'] = builtKey[pkName];

    let keyConditionExpression = `#pk = :pk_value`;
    // If a sortKeyCondition was set via another fluent method, append it.
    if (this.sortKeyCondition) {
      keyConditionExpression += ` AND ${this.sortKeyCondition}`;
    }

    // If any filters were added, set them as FilterExpression.
    const params: QueryCommandInput = {
      TableName: this.parent.getTableName(),
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: this.expressionAttributeNames,
      ExpressionAttributeValues: this.expressionAttributeValues,
      ScanIndexForward: this.ascending,
      Limit: this.limit,
      ExclusiveStartKey: this.lastKey,
      IndexName: this.indexName
    };

    if (this.filters.length > 0) {
      params.FilterExpression = this.filters.join(' AND ');
    }

    const result = await this.parent.getClient().send(new QueryCommand(params));
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
