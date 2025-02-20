import { QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { BetterDDB } from '../betterddb';
import { PaginatedResult } from '../types/paginated-result';

export class ListBuilder<T> {
  private limit?: number;
  private lastKey?: Record<string, any>;
  private ascending: boolean = true;

  constructor(private parent: BetterDDB<T>, private key: Partial<T>) {}

  public sortAscending(): this {
    this.ascending = true;
    return this;
  }

  public sortDescending(): this {
    this.ascending = false;
    return this;
  }

  public limitResults(limit: number): this {
    this.limit = limit;
    return this;
  }

  public page(lastKey: Record<string, any>): this {
    this.lastKey = lastKey;
    return this;
  }

  /**
   * Executes the query and returns a Promise that resolves with an array of items.
   */
  public async execute(): Promise<PaginatedResult<T>> {
    let keyConditionExpression = `#pk = :pk_value`;
    let filterExpression: string | undefined;
    let expressionAttributeNames: Record<string, string> = {};
    let expressionAttributeValues: Record<string, any> = {};

    const keys = this.parent.getKeys();
    let pkName = keys.primary.name;
    let skName = keys.sort?.name;
    let builtKey = skName ? this.parent.buildIndexes({...this.key, [skName]: ""}) : this.parent.buildKey(this.key);
  
    expressionAttributeNames['#pk'] = pkName;
    expressionAttributeValues[':pk_value'] = builtKey[pkName];

    if (skName && builtKey[skName]) {
      keyConditionExpression = `#pk = :pk_value AND begins_with(#sk, :sk_value)`;
      expressionAttributeNames['#sk'] = skName;
      expressionAttributeValues[':sk_value'] = builtKey[skName];
    }

    if (this.parent.getEntityType()) {
      filterExpression = `#entity = :entity_value`;
      expressionAttributeNames['#entity'] = 'entityType';
      expressionAttributeValues[':entity_value'] = this.parent.getEntityType();
    }
    
    const params: QueryCommandInput = {
      TableName: this.parent.getTableName(),
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: this.ascending,
      Limit: this.limit,
      ExclusiveStartKey: this.lastKey,
    };

    const result = await this.parent.getClient().send(new QueryCommand(params));
    return {items: this.parent.getSchema().array().parse(result.Items) as T[], lastKey: result.LastEvaluatedKey ?? undefined};
  }
}
