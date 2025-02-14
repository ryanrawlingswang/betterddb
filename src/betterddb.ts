// src/dynamo-dal.ts
import { z, ZodSchema } from 'zod';
import { DynamoDB } from 'aws-sdk';

export type PrimaryKeyValue = string | number;

/**
 * A key definition can be either a simple key (a property name)
 * or an object containing a build function that computes the value.
 * (In this design, the attribute name is provided separately.)
 */
export type KeyDefinition<T> =
  | keyof T
  | {
      build: (rawKey: Partial<T>) => string;
    };

/**
 * Configuration for a primary (partition) key.
 */
export interface PrimaryKeyConfig<T> {
  /** The attribute name for the primary key in DynamoDB */
  name: string;
  /** How to compute the key value; if a keyof T, then the raw value is used;
   * if an object, the build function is used.
   */
  definition: KeyDefinition<T>;
}

/**
 * Configuration for a sort key.
 */
export interface SortKeyConfig<T> {
  /** The attribute name for the sort key in DynamoDB */
  name: string;
  /** How to compute the sort key value */
  definition: KeyDefinition<T>;
}

/**
 * Configuration for a Global Secondary Index (GSI).
 */
export interface GSIConfig<T> {
  primary: PrimaryKeyConfig<T>;
  sort?: SortKeyConfig<T>;
}

/**
 * Keys configuration for the table.
 */
export interface KeysConfig<T> {
  primary: PrimaryKeyConfig<T>;
  sort?: SortKeyConfig<T>;
  gsis?: {
    [gsiName: string]: GSIConfig<T>;
  };
}

/**
 * Options for initializing BetterDDB.
 */
export interface BetterDDBOptions<T> {
  schema: ZodSchema<T>;
  tableName: string;
  keys: KeysConfig<T>;
  client: DynamoDB.DocumentClient;
  /**
   * If true, automatically inject timestamp fields:
   * - On create, sets both `createdAt` and `updatedAt`
   * - On update, sets `updatedAt`
   *
   * (T should include these fields if enabled.)
   */
  autoTimestamps?: boolean;
}

/**
 * BetterDDB is a definition-based DynamoDB wrapper library.
 */
export class BetterDDB<T> {
  protected schema: ZodSchema<T>;
  protected tableName: string;
  protected client: DynamoDB.DocumentClient;
  protected keys: KeysConfig<T>;
  protected autoTimestamps: boolean;

  constructor(options: BetterDDBOptions<T>) {
    this.schema = options.schema;
    this.tableName = options.tableName;
    this.keys = options.keys;
    this.client = options.client;
    this.autoTimestamps = options.autoTimestamps ?? false;
  }

  // Helper: Retrieve the key value from a KeyDefinition.
  protected getKeyValue(def: KeyDefinition<T>, rawKey: Partial<T>): string {
    if (typeof def === 'string' || typeof def === 'number' || typeof def === 'symbol') {
      return String(rawKey[def]);
    } else {
      return def.build(rawKey);
    }
  }

  /**
   * Build the primary key from a raw key object.
   */
  protected buildKey(rawKey: Partial<T>): Record<string, any> {
    const keyObj: Record<string, any> = {};
  
    // For primary (partition) key:
    const pkConfig = this.keys.primary;
    keyObj[pkConfig.name] =
      (typeof pkConfig.definition === 'string' ||
       typeof pkConfig.definition === 'number' ||
       typeof pkConfig.definition === 'symbol')
        ? String((rawKey as any)[pkConfig.definition])
        : pkConfig.definition.build(rawKey);
  
    // For sort key, if defined:
    if (this.keys.sort) {
      const skConfig = this.keys.sort;
      keyObj[skConfig.name] =
        (typeof skConfig.definition === 'string' ||
         typeof skConfig.definition === 'number' ||
         typeof skConfig.definition === 'symbol')
          ? String((rawKey as any)[skConfig.definition])
          : skConfig.definition.build(rawKey);
    }
    return keyObj;
  }
  
  /**
   * Build index attributes for each defined GSI.
   */
  protected buildIndexes(rawItem: Partial<T>): Record<string, any> {
    const indexAttributes: Record<string, any> = {};
    if (this.keys.gsis) {
      for (const gsiName in this.keys.gsis) {
        const gsiConfig = this.keys.gsis[gsiName];
  
        // Compute primary index attribute.
        const primaryConfig = gsiConfig.primary;
        indexAttributes[primaryConfig.name] =
          (typeof primaryConfig.definition === 'string' ||
           typeof primaryConfig.definition === 'number' ||
           typeof primaryConfig.definition === 'symbol')
            ? String((rawItem as any)[primaryConfig.definition])
            : primaryConfig.definition.build(rawItem);
  
        // Compute sort index attribute if provided.
        if (gsiConfig.sort) {
          const sortConfig = gsiConfig.sort;
          indexAttributes[sortConfig.name] =
            (typeof sortConfig.definition === 'string' ||
             typeof sortConfig.definition === 'number' ||
             typeof sortConfig.definition === 'symbol')
              ? String((rawItem as any)[sortConfig.definition])
              : sortConfig.definition.build(rawItem);
        }
      }
    }
    return indexAttributes;
  }
  
  /**
   * Create an item:
   * - Computes primary key and index attributes,
   * - Optionally injects timestamps,
   * - Validates the item and writes it to DynamoDB.
   */
  async create(item: T): Promise<T> {
    if (this.autoTimestamps) {
        const now = new Date().toISOString();
        item = { ...item, createdAt: now, updatedAt: now } as T;
    }

    const validated = this.schema.parse(item);
    let finalItem = { ...validated };
  
    // Compute and merge primary key.
    const computedKeys = this.buildKey(validated);
    finalItem = { ...finalItem, ...computedKeys };
  
    // Compute and merge index attributes.
    const indexAttributes = this.buildIndexes(validated);
    finalItem = { ...finalItem, ...indexAttributes };

    try {
      await this.client.put({ TableName: this.tableName, Item: finalItem as DynamoDB.DocumentClient.PutItemInputAttributeMap }).promise();
      return validated;
    } catch (error) {
      console.error('Error during create operation:', error);
      throw error;
    }
  }
  
  async get(rawKey: Partial<T>): Promise<T | null> {
    const Key = this.buildKey(rawKey);
    try {
      const result = await this.client.get({ TableName: this.tableName, Key }).promise();
      if (!result.Item) return null;
      return this.schema.parse(result.Item);
    } catch (error) {
      console.error('Error during get operation:', error);
      throw error;
    }
  }
  
  async update(
    rawKey: Partial<T>,
    update: Partial<T>,
    options?: { expectedVersion?: number }
  ): Promise<T> {
    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, any> = {};
    const UpdateExpressionParts: string[] = [];
    const ConditionExpressionParts: string[] = [];
  
    // Exclude key fields from update.
    const keyFieldNames = [
      this.keys.primary.name,
      this.keys.sort ? this.keys.sort.name : undefined
    ].filter(Boolean) as string[];
  
    for (const [attr, value] of Object.entries(update)) {
      if (keyFieldNames.includes(attr)) continue;
      const attributeKey = `#${attr}`;
      const valueKey = `:${attr}`;
      ExpressionAttributeNames[attributeKey] = attr;
      ExpressionAttributeValues[valueKey] = value;
      UpdateExpressionParts.push(`${attributeKey} = ${valueKey}`);
    }
  
    if (this.autoTimestamps) {
      const now = new Date().toISOString();
      ExpressionAttributeNames['#updatedAt'] = 'updatedAt';
      ExpressionAttributeValues[':updatedAt'] = now;
      UpdateExpressionParts.push('#updatedAt = :updatedAt');
    }
  
    if (options?.expectedVersion !== undefined) {
      ExpressionAttributeNames['#version'] = 'version';
      ExpressionAttributeValues[':expectedVersion'] = options.expectedVersion;
      ExpressionAttributeValues[':newVersion'] = options.expectedVersion + 1;
      UpdateExpressionParts.push('#version = :newVersion');
      ConditionExpressionParts.push('#version = :expectedVersion');
    }
  
    if (UpdateExpressionParts.length === 0) {
      throw new Error('No attributes provided to update');
    }
  
    const UpdateExpression = 'SET ' + UpdateExpressionParts.join(', ');
    const params: DynamoDB.DocumentClient.UpdateItemInput = {
      TableName: this.tableName,
      Key: this.buildKey(rawKey),
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
  
    if (ConditionExpressionParts.length > 0) {
      params.ConditionExpression = ConditionExpressionParts.join(' AND ');
    }
  
    try {
      const result = await this.client.update(params).promise();
      if (!result.Attributes) {
        throw new Error('No attributes returned after update');
      }
      return this.schema.parse(result.Attributes);
    } catch (error) {
      console.error('Error during update operation:', error);
      throw error;
    }
  }
  
  async delete(rawKey: Partial<T>): Promise<void> {
    const Key = this.buildKey(rawKey);
    try {
      await this.client.delete({ TableName: this.tableName, Key }).promise();
    } catch (error) {
      console.error('Error during delete operation:', error);
      throw error;
    }
  }
  
  async queryByGsi(
    gsiName: string,
    key: Partial<T>,
    sortKeyCondition?: { operator: 'eq' | 'begins_with' | 'between'; values: any | [any, any] }
  ): Promise<T[]> {
    if (!this.keys.gsis || !this.keys.gsis[gsiName]) {
      throw new Error(`GSI "${gsiName}" is not configured`);
    }
    const indexConfig = this.keys.gsis[gsiName];
    const ExpressionAttributeNames: Record<string, string> = {
      [`#${indexConfig.primary.name}`]: indexConfig.primary.name
    };
    const ExpressionAttributeValues: Record<string, any> = {
      [`:${indexConfig.primary.name}`]:
        (typeof indexConfig.primary.definition === 'string' ||
         typeof indexConfig.primary.definition === 'number' ||
         typeof indexConfig.primary.definition === 'symbol')
          ? String((key as any)[indexConfig.primary.definition])
          : indexConfig.primary.definition.build(key)
    };
    let KeyConditionExpression = `#${indexConfig.primary.name} = :${indexConfig.primary.name}`;
  
    if (indexConfig.sort && sortKeyCondition) {
      const skFieldName = indexConfig.sort.name;
      ExpressionAttributeNames['#gsiSk'] = skFieldName;
      switch (sortKeyCondition.operator) {
        case 'eq':
          ExpressionAttributeValues[':gsiSk'] = sortKeyCondition.values;
          KeyConditionExpression += ' AND #gsiSk = :gsiSk';
          break;
        case 'begins_with':
          ExpressionAttributeValues[':gsiSk'] = sortKeyCondition.values;
          KeyConditionExpression += ' AND begins_with(#gsiSk, :gsiSk)';
          break;
        case 'between':
          if (!Array.isArray(sortKeyCondition.values) || sortKeyCondition.values.length !== 2) {
            throw new Error("For 'between' operator, values must be a tuple of two items");
          }
          ExpressionAttributeValues[':gsiSkStart'] = sortKeyCondition.values[0];
          ExpressionAttributeValues[':gsiSkEnd'] = sortKeyCondition.values[1];
          KeyConditionExpression += ' AND #gsiSk BETWEEN :gsiSkStart AND :gsiSkEnd';
          break;
        default:
          throw new Error(`Unsupported sort key operator: ${sortKeyCondition.operator}`);
      }
    }
    try {
      const result = await this.client
        .query({
          TableName: this.tableName,
          IndexName: gsiName,
          KeyConditionExpression,
          ExpressionAttributeNames,
          ExpressionAttributeValues
        })
        .promise();
      return (result.Items || []).map(item => this.schema.parse(item));
    } catch (error) {
      console.error('Error during queryByGsi operation:', error);
      throw error;
    }
  }
  
  /**
   * Query by primary key (using the computed primary key) and an optional sort key condition.
   */
  async queryByPrimaryKey(
    rawKey: Partial<T>,
    sortKeyCondition?: { operator: 'eq' | 'begins_with' | 'between'; values: any | [any, any] },
    options?: { limit?: number; lastKey?: Record<string, any> }
  ): Promise<{ items: T[]; lastKey?: Record<string, any> }> {
    const pkAttrName = this.keys.primary.name;
    const pkValue =
      (typeof this.keys.primary.definition === 'string' ||
       typeof this.keys.primary.definition === 'number' ||
       typeof this.keys.primary.definition === 'symbol')
        ? String((rawKey as any)[this.keys.primary.definition])
        : this.keys.primary.definition.build(rawKey);
  
    const ExpressionAttributeNames: Record<string, string> = {
      [`#${pkAttrName}`]: pkAttrName
    };
    const ExpressionAttributeValues: Record<string, any> = {
      [`:${pkAttrName}`]: pkValue
    };
  
    let KeyConditionExpression = `#${pkAttrName} = :${pkAttrName}`;
  
    if (this.keys.sort && sortKeyCondition) {
      const skAttrName = this.keys.sort.name;
      ExpressionAttributeNames[`#${skAttrName}`] = skAttrName;
      switch (sortKeyCondition.operator) {
        case 'eq':
          ExpressionAttributeValues[':skValue'] = sortKeyCondition.values;
          KeyConditionExpression += ` AND #${skAttrName} = :skValue`;
          break;
        case 'begins_with':
          ExpressionAttributeValues[':skValue'] = sortKeyCondition.values;
          KeyConditionExpression += ` AND begins_with(#${skAttrName}, :skValue)`;
          break;
        case 'between':
          if (!Array.isArray(sortKeyCondition.values) || sortKeyCondition.values.length !== 2) {
            throw new Error("For 'between' operator, values must be a tuple of two items");
          }
          ExpressionAttributeValues[':skStart'] = sortKeyCondition.values[0];
          ExpressionAttributeValues[':skEnd'] = sortKeyCondition.values[1];
          KeyConditionExpression += ` AND #${skAttrName} BETWEEN :skStart AND :skEnd`;
          break;
        default:
          throw new Error(`Unsupported sort key operator: ${sortKeyCondition.operator}`);
      }
    }
  
    const queryParams: DynamoDB.DocumentClient.QueryInput = {
      TableName: this.tableName,
      KeyConditionExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues
    };
  
    if (options?.limit) {
      queryParams.Limit = options.limit;
    }
    if (options?.lastKey) {
      queryParams.ExclusiveStartKey = options.lastKey;
    }
  
    const result = await this.client.query(queryParams).promise();
    const items = (result.Items || []).map(item => this.schema.parse(item));
    return { items, lastKey: result.LastEvaluatedKey };
  }
  
  // ───── Transaction Helpers ─────────────────────────────
  
  buildTransactPut(item: T): DynamoDB.DocumentClient.TransactWriteItem {
    const computedKeys = this.buildKey(item);
    const indexAttributes = this.buildIndexes(item);
    const finalItem = { ...item, ...computedKeys, ...indexAttributes };
    const validated = this.schema.parse(finalItem);
    return {
      Put: {
        TableName: this.tableName,
        Item: validated as DynamoDB.DocumentClient.PutItemInputAttributeMap
      }
    };
  }
  
  buildTransactUpdate(
    rawKey: Partial<T>,
    update: Partial<T>,
    options?: { expectedVersion?: number }
  ): DynamoDB.DocumentClient.TransactWriteItem {
    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, any> = {};
    const UpdateExpressionParts: string[] = [];
    const ConditionExpressionParts: string[] = [];
  
    const keyFieldNames = [
      this.keys.primary.name,
      this.keys.sort ? this.keys.sort.name : undefined
    ].filter(Boolean) as string[];
  
    for (const [attr, value] of Object.entries(update)) {
      if (keyFieldNames.includes(attr)) continue;
      const attributeKey = `#${attr}`;
      const valueKey = `:${attr}`;
      ExpressionAttributeNames[attributeKey] = attr;
      ExpressionAttributeValues[valueKey] = value;
      UpdateExpressionParts.push(`${attributeKey} = ${valueKey}`);
    }
  
    if (this.autoTimestamps) {
      const now = new Date().toISOString();
      ExpressionAttributeNames['#updatedAt'] = 'updatedAt';
      ExpressionAttributeValues[':updatedAt'] = now;
      UpdateExpressionParts.push('#updatedAt = :updatedAt');
    }
  
    if (options?.expectedVersion !== undefined) {
      ExpressionAttributeNames['#version'] = 'version';
      ExpressionAttributeValues[':expectedVersion'] = options.expectedVersion;
      ExpressionAttributeValues[':newVersion'] = options.expectedVersion + 1;
      UpdateExpressionParts.push('#version = :newVersion');
      ConditionExpressionParts.push('#version = :expectedVersion');
    }
  
    if (UpdateExpressionParts.length === 0) {
      throw new Error('No attributes provided to update in transactUpdate');
    }
  
    const UpdateExpression = 'SET ' + UpdateExpressionParts.join(', ');
    const updateItem: DynamoDB.DocumentClient.Update = {
      TableName: this.tableName,
      Key: this.buildKey(rawKey),
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues
    };
    if (ConditionExpressionParts.length > 0) {
      updateItem.ConditionExpression = ConditionExpressionParts.join(' AND ');
    }
    return { Update: updateItem };
  }
  
  buildTransactDelete(rawKey: Partial<T>): DynamoDB.DocumentClient.TransactWriteItem {
    return {
      Delete: {
        TableName: this.tableName,
        Key: this.buildKey(rawKey)
      }
    };
  }
  
  async transactWrite(
    operations: DynamoDB.DocumentClient.TransactWriteItemList
  ): Promise<void> {
    try {
      await this.client.transactWrite({ TransactItems: operations }).promise();
    } catch (error) {
      console.error('Error during transactWrite operation:', error);
      throw error;
    }
  }
  
  async transactGetByKeys(rawKeys: Partial<T>[]): Promise<T[]> {
    const getItems = rawKeys.map(key => ({ TableName: this.tableName, Key: this.buildKey(key) }));
    return this.transactGet(getItems);
  }
  
  async transactGet(
    getItems: { TableName: string; Key: any }[]
  ): Promise<T[]> {
    try {
      const response = await this.client
        .transactGet({
          TransactItems: getItems.map(item => ({ Get: item }))
        })
        .promise();
      return (response.Responses || [])
        .filter(r => r.Item)
        .map(r => this.schema.parse(r.Item));
    } catch (error) {
      console.error('Error during transactGet operation:', error);
      throw error;
    }
  }
  
  // ───── Batch Write Support ─────────────────────────────
  
  async batchWrite(ops: { puts?: T[]; deletes?: Partial<T>[] }): Promise<void> {
    const putRequests = (ops.puts || []).map(item => {
      const computedKeys = this.buildKey(item);
      const indexAttributes = this.buildIndexes(item);
      const finalItem = { ...item, ...computedKeys, ...indexAttributes };
      const validated = this.schema.parse(finalItem);
      return { PutRequest: { Item: validated } };
    });
  
    const deleteRequests = (ops.deletes || []).map(rawKey => {
      const key = this.buildKey(rawKey);
      return { DeleteRequest: { Key: key } };
    });
  
    const allRequests = [...putRequests, ...deleteRequests];
  
    for (let i = 0; i < allRequests.length; i += 25) {
      const chunk = allRequests.slice(i, i + 25);
      let unprocessed = await this.batchWriteChunk(chunk as DynamoDB.DocumentClient.WriteRequest[]);
      while (unprocessed && Object.keys(unprocessed).length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        unprocessed = await this.retryBatchWrite(unprocessed);
      }
    }
  }
  
  private async batchWriteChunk(chunk: DynamoDB.DocumentClient.WriteRequest[]): Promise<DynamoDB.DocumentClient.BatchWriteItemOutput['UnprocessedItems']> {
    const params = {
      RequestItems: {
        [this.tableName]: chunk
      }
    };
    const result = await this.client.batchWrite(params as DynamoDB.DocumentClient.BatchWriteItemInput).promise();
    return result.UnprocessedItems;
  }
  
  private async retryBatchWrite(unprocessed: DynamoDB.DocumentClient.BatchWriteItemOutput['UnprocessedItems']): Promise<DynamoDB.DocumentClient.BatchWriteItemOutput['UnprocessedItems']> {
    const params = { RequestItems: unprocessed };
    const result = await this.client.batchWrite(params as DynamoDB.DocumentClient.BatchWriteItemInput).promise();
    return result.UnprocessedItems;
  }
  
  // ───── Batch Get Support ─────────────────────────────
  
  async batchGet(rawKeys: Partial<T>[]): Promise<T[]> {
    const keys = rawKeys.map(key => this.buildKey(key));
    const results: T[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const params = {
        RequestItems: {
          [this.tableName]: {
            Keys: chunk
          }
        }
      };
      const result = await this.client.batchGet(params).promise();
      const items = result.Responses ? result.Responses[this.tableName] : [];
      results.push(...items.map(item => this.schema.parse(item)));
    }
    return results;
  }
}
