import { QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { BetterDDB, GSIConfig } from '../betterddb';

export class QueryBuilder<T> {
  private filters: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, any> = {};
  private index?: GSIConfig<T>;
  private sortKeyCondition?: string;
  private limit?: number;
  private lastKey?: Record<string, any>;
  private ascending: boolean = true;

  constructor(private parent: BetterDDB<T>, private key: Partial<T>) {}

  public usingIndex(indexName: string): this {
    if (!this.parent.getKeys().gsis) {
      throw new Error('No global secondary indexes defined for this table');
    }
    if (!(indexName in this.parent.getKeys().gsis!)) {
      throw new Error('index does not exist')
    }
    
    this.index = this.parent.getKeys().gsis![indexName];
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
    const keys = this.parent.getKeys();
    let pkName = keys.primary.name;
    let builtKey = this.parent.buildKey(this.key) as Record<string, any>;
    if (this.index) {
      pkName = this.index.primary.name;
      builtKey = this.parent.buildIndexes(this.key);
    }
    this.expressionAttributeNames['#pk'] = pkName;

    let keyConditionExpression = `#pk = :pk_value`;
    if (this.sortKeyCondition) {
      keyConditionExpression += ` AND ${this.sortKeyCondition}`;
    }

    this.expressionAttributeValues[':pk_value'] = builtKey[pkName];

    const params: QueryCommandInput = {
      TableName: this.parent.getTableName(),
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: this.expressionAttributeNames,
      ExpressionAttributeValues: this.expressionAttributeValues,
      ScanIndexForward: this.ascending,
      Limit: this.limit,
      ExclusiveStartKey: this.lastKey,
      IndexName: this.index?.name ?? undefined
    };

    if (this.filters.length > 0) {
      params.FilterExpression = this.filters.join(' AND ');
    }

    const result = await this.parent.getClient().send(new QueryCommand(params));
    return this.parent.getSchema().array().parse(result.Items) as T[];
  }
}
